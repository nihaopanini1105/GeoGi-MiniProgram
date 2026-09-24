const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE_PRICE_FEN = 19900;

function dataRoot() {
  return process.env.GEOGI_CHANNEL_DATA_ROOT || path.join(__dirname, '../../data/channels');
}

function channelsPath() {
  return path.join(dataRoot(), 'channels.json');
}

function commissionsPath() {
  return path.join(dataRoot(), 'commissions.json');
}

async function ensureRoot() {
  await fs.promises.mkdir(dataRoot(), { recursive: true, mode: 0o700 });
  await fs.promises.chmod(dataRoot(), 0o700);
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await ensureRoot();
  const temp = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fs.promises.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temp, filePath);
  await fs.promises.chmod(filePath, 0o600);
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizeCode(value) {
  return cleanText(value, 40).replace(/\s+/g, '').toUpperCase();
}

function normalizePhones(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[、,，;；\s]+/);
  return [...new Set(rows.map((item) => cleanText(item, 40)).filter(Boolean))].slice(0, 20);
}

function normalizeIso(value) {
  const text = cleanText(value, 80);
  if (!text) return '';
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error('CHANNEL_DATE_INVALID');
  return new Date(ms).toISOString();
}

function publicChannel(channel) {
  return {
    channelId: channel.channelId,
    name: channel.name,
    code: channel.code,
    discountType: channel.discountType,
    discountRateBps: channel.discountRateBps,
    commissionRateBps: channel.commissionRateBps,
    active: channel.active,
    startsAt: channel.startsAt,
    endsAt: channel.endsAt,
    ownerPhones: [...channel.ownerPhones],
    notes: channel.notes || '',
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}

async function listChannels() {
  const rows = await readJson(channelsPath(), []);
  return Array.isArray(rows) ? rows.map(publicChannel) : [];
}

function validateDiscount({ discountType, discountRateBps }) {
  if (!['percent', 'free'].includes(discountType)) throw new Error('CHANNEL_DISCOUNT_TYPE_INVALID');
  if (discountType === 'free') return 0;
  const bps = Number(discountRateBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('CHANNEL_DISCOUNT_RATE_INVALID');
  return bps;
}

async function upsertChannel(input = {}) {
  const now = new Date().toISOString();
  const rows = await listChannels();
  const channelId = cleanText(input.channelId, 120) || 'channel_' + crypto.randomUUID();
  const existingIndex = rows.findIndex((item) => item.channelId === channelId);
  const existing = existingIndex >= 0 ? rows[existingIndex] : null;
  const name = cleanText(input.name !== undefined ? input.name : existing && existing.name, 120);
  const code = normalizeCode(input.code !== undefined ? input.code : existing && existing.code);
  const discountType = cleanText(input.discountType !== undefined ? input.discountType : existing && existing.discountType, 20) || 'percent';
  const discountRateBps = validateDiscount({
    discountType,
    discountRateBps: input.discountRateBps !== undefined ? Number(input.discountRateBps) : Number(existing && existing.discountRateBps)
  });
  const commissionRateBps = Number(input.commissionRateBps !== undefined ? input.commissionRateBps : existing && existing.commissionRateBps || 0);
  if (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 10000) {
    throw new Error('CHANNEL_COMMISSION_RATE_INVALID');
  }
  if (!name) throw new Error('CHANNEL_NAME_REQUIRED');
  if (!code || !/^[A-Z0-9_-]{2,40}$/.test(code)) throw new Error('CHANNEL_CODE_INVALID');
  const duplicate = rows.find((item) => item.code === code && item.channelId !== channelId);
  if (duplicate) throw new Error('CHANNEL_CODE_DUPLICATE');

  const startsAt = normalizeIso(input.startsAt !== undefined ? input.startsAt : existing && existing.startsAt);
  const endsAt = normalizeIso(input.endsAt !== undefined ? input.endsAt : existing && existing.endsAt);
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw new Error('CHANNEL_EFFECTIVE_PERIOD_INVALID');

  const row = {
    channelId,
    name,
    code,
    discountType,
    discountRateBps,
    commissionRateBps,
    active: input.active !== undefined ? Boolean(input.active) : (existing ? Boolean(existing.active) : true),
    startsAt,
    endsAt,
    ownerPhones: normalizePhones(input.ownerPhones !== undefined ? input.ownerPhones : existing && existing.ownerPhones),
    notes: cleanText(input.notes !== undefined ? input.notes : existing && existing.notes, 1000),
    createdAt: existing && existing.createdAt || now,
    updatedAt: now
  };
  if (existingIndex >= 0) rows[existingIndex] = row;
  else rows.push(row);
  await writeJson(channelsPath(), rows);
  return publicChannel(row);
}

async function quoteChannelCode(code, now = new Date()) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return {
      applied: false,
      listPriceFen: BASE_PRICE_FEN,
      payableFen: BASE_PRICE_FEN,
      discountFen: 0,
      discountType: '',
      discountRateBps: 10000,
      promotionCode: '',
      channelId: '',
      channelName: '',
      commissionRateBps: 0
    };
  }
  const rows = await listChannels();
  const channel = rows.find((item) => item.code === normalized);
  if (!channel) {
    const error = new Error('CHANNEL_CODE_NOT_FOUND');
    error.code = 'CHANNEL_CODE_NOT_FOUND';
    throw error;
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!channel.active) {
    const error = new Error('CHANNEL_CODE_INACTIVE');
    error.code = 'CHANNEL_CODE_INACTIVE';
    throw error;
  }
  if (channel.startsAt && nowMs < Date.parse(channel.startsAt)) {
    const error = new Error('CHANNEL_CODE_NOT_STARTED');
    error.code = 'CHANNEL_CODE_NOT_STARTED';
    throw error;
  }
  if (channel.endsAt && nowMs >= Date.parse(channel.endsAt)) {
    const error = new Error('CHANNEL_CODE_EXPIRED');
    error.code = 'CHANNEL_CODE_EXPIRED';
    throw error;
  }
  const payableFen = channel.discountType === 'free'
    ? 0
    : Math.max(0, Math.min(BASE_PRICE_FEN, Math.round(BASE_PRICE_FEN * Number(channel.discountRateBps) / 10000)));
  return {
    applied: true,
    listPriceFen: BASE_PRICE_FEN,
    payableFen,
    discountFen: BASE_PRICE_FEN - payableFen,
    discountType: channel.discountType,
    discountRateBps: channel.discountType === 'free' ? 0 : Number(channel.discountRateBps),
    promotionCode: channel.code,
    channelId: channel.channelId,
    channelName: channel.name,
    commissionRateBps: Number(channel.commissionRateBps || 0)
  };
}

async function listCommissionRecords() {
  const rows = await readJson(commissionsPath(), []);
  return Array.isArray(rows) ? rows : [];
}

async function reconcileCommission({ order, releasedAt = '' }) {
  if (!order || !order.projectId || !order.channelId) return null;
  const rows = await listCommissionRecords();
  const index = rows.findIndex((item) => item.projectId === order.projectId);
  const existing = index >= 0 ? rows[index] : null;
  const effectiveReleasedAt = releasedAt || existing && existing.reportReleasedAt || '';
  if (!effectiveReleasedAt) return existing || null;
  const now = new Date().toISOString();
  const rateBps = Number(order.commissionRateBps || 0);
  const netPaidFen = Math.max(0, Number(order.amountTotal || 0) - Number(order.refundedAmount || 0));
  const earnedFen = Math.max(0, Math.round(netPaidFen * rateBps / 10000));
  const payoutFen = Number(existing && existing.payoutFen || 0);
  const dueFen = Math.max(0, earnedFen - payoutFen);
  const overpaidFen = Math.max(0, payoutFen - earnedFen);
  const record = {
    commissionId: existing && existing.commissionId || 'commission_' + crypto.randomUUID(),
    channelId: order.channelId,
    channelName: order.channelName || '',
    promotionCode: order.promotionCode || '',
    projectId: order.projectId,
    clientId: order.clientId,
    outTradeNo: order.outTradeNo,
    brandName: order.brandName || '',
    commissionRateBps: rateBps,
    listPriceFen: Number(order.listPriceFen || BASE_PRICE_FEN),
    paidAmountFen: Number(order.amountTotal || 0),
    refundedAmountFen: Number(order.refundedAmount || 0),
    netPaidFen,
    earnedFen,
    payoutFen,
    dueFen,
    overpaidFen,
    reportReleasedAt: effectiveReleasedAt,
    period: String(effectiveReleasedAt).slice(0, 7),
    payoutStatus: earnedFen <= 0 ? 'not_applicable' : (dueFen > 0 ? 'pending' : 'paid'),
    payoutAt: existing && existing.payoutAt || '',
    payoutReference: existing && existing.payoutReference || '',
    payoutOperatorId: existing && existing.payoutOperatorId || '',
    createdAt: existing && existing.createdAt || now,
    updatedAt: now
  };
  if (index >= 0) rows[index] = record;
  else rows.push(record);
  await writeJson(commissionsPath(), rows);
  return record;
}

async function settleChannelPeriod({ channelId, period, operatorId = '', payoutReference = '' }) {
  const rows = await listCommissionRecords();
  let changed = 0;
  let payoutFen = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    if (row.channelId !== channelId || row.period !== period) continue;
    const due = Number(row.dueFen || 0);
    if (due <= 0) continue;
    row.payoutFen = Number(row.payoutFen || 0) + due;
    row.dueFen = 0;
    row.overpaidFen = Math.max(0, Number(row.payoutFen || 0) - Number(row.earnedFen || 0));
    row.payoutStatus = 'paid';
    row.payoutAt = now;
    row.payoutReference = cleanText(payoutReference, 300);
    row.payoutOperatorId = cleanText(operatorId, 120);
    row.updatedAt = now;
    changed += 1;
    payoutFen += due;
  }
  await writeJson(commissionsPath(), rows);
  return { ok: true, channelId, period, settledRecords: changed, payoutFen, payoutYuan: payoutFen / 100, payoutAt: now };
}

module.exports = {
  BASE_PRICE_FEN,
  normalizeCode,
  listChannels,
  upsertChannel,
  quoteChannelCode,
  listCommissionRecords,
  reconcileCommission,
  settleChannelPeriod
};
