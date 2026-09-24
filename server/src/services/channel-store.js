const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE_PRICE_FEN = 19900;
const SOURCE_TYPES = new Set(['website', 'official_account', 'business_card', 'channel']);

function dataRoot() {
  if (process.env.GEOGI_CHANNEL_DATA_ROOT) return process.env.GEOGI_CHANNEL_DATA_ROOT;
  if (process.env.GEOGI_PAYMENT_DATA_ROOT) {
    return path.join(path.dirname(process.env.GEOGI_PAYMENT_DATA_ROOT), 'channels');
  }
  return path.join(__dirname, '../../data/channels');
}

function channelsPath() { return path.join(dataRoot(), 'channels.json'); }
function sourcesPath() { return path.join(dataRoot(), 'sources.json'); }
function visitsPath() { return path.join(dataRoot(), 'source-visits.json'); }
function commissionsPath() { return path.join(dataRoot(), 'commissions.json'); }

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

const mutationQueues = new Map();

async function mutateJson(filePath, fallback, mutator) {
  const previous = mutationQueues.get(filePath) || Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const current = await readJson(filePath, fallback);
    const result = await mutator(current);
    if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, 'value')) {
      throw new Error('CHANNEL_MUTATION_RESULT_INVALID');
    }
    if (result.write !== false) {
      await writeJson(filePath, result.next);
    }
    return result.value;
  });
  mutationQueues.set(filePath, run);
  try {
    return await run;
  } finally {
    if (mutationQueues.get(filePath) === run) mutationQueues.delete(filePath);
  }
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizePhones(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[、,，;；\s]+/);
  return [...new Set(rows.map((item) => cleanText(item, 40)).filter(Boolean))].slice(0, 20);
}

function normalizeRedeemCode(value) {
  return cleanText(value, 40).replace(/\s+/g, '').toUpperCase();
}

function channelError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeIso(value) {
  const text = cleanText(value, 80);
  if (!text) return '';
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw channelError('CHANNEL_DATE_INVALID');
  return new Date(ms).toISOString();
}

function publicChannel(channel) {
  return {
    channelId: channel.channelId,
    name: channel.name,
    redeemCode: normalizeRedeemCode(channel.redeemCode),
    discountType: channel.discountType,
    discountRateBps: Number(channel.discountRateBps || 0),
    commissionRateBps: Number(channel.commissionRateBps || 0),
    active: Boolean(channel.active),
    startsAt: channel.startsAt || '',
    endsAt: channel.endsAt || '',
    ownerPhones: [...(channel.ownerPhones || [])],
    notes: channel.notes || '',
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}

function publicSource(source) {
  return {
    sourceId: source.sourceId,
    token: source.token,
    name: source.name,
    sourceType: source.sourceType,
    channelId: source.channelId || '',
    active: Boolean(source.active),
    startsAt: source.startsAt || '',
    endsAt: source.endsAt || '',
    notes: source.notes || '',
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
  };
}

async function listChannels() {
  const rows = await readJson(channelsPath(), []);
  return Array.isArray(rows) ? rows.map(publicChannel) : [];
}

async function listSources() {
  const rows = await readJson(sourcesPath(), []);
  return Array.isArray(rows) ? rows.map(publicSource) : [];
}

async function ensureDefaultOfficialSources() {
  const defaults = [
    { sourceId: 'source_official_website', name: 'GeoGi 官网', sourceType: 'website', notes: 'auto_official_source:website' },
    { sourceId: 'source_official_account', name: 'GeoGi 公众号', sourceType: 'official_account', notes: 'auto_official_source:official_account' },
    { sourceId: 'source_official_business_card', name: 'GeoGi 官方名片', sourceType: 'business_card', notes: 'auto_official_source:business_card' }
  ];
  const rows = await listSources();
  const created = [];
  for (const item of defaults) {
    let existing = rows.find((row) => row.notes === item.notes);
    if (!existing) {
      existing = await upsertSource({ ...item, active: true });
    }
    created.push(existing);
  }
  return created;
}

async function ensureOfficialDistributionSources() {
  const official = await ensureDefaultOfficialSources();
  const rows = await listSources();
  const personalDefaults = [
    {
      sourceId: 'source_business_card_liaohuafeng',
      name: 'GeoGi · 廖华锋名片',
      sourceType: 'business_card',
      notes: 'official_business_card:liaohuafeng'
    },
    {
      sourceId: 'source_business_card_lishasha',
      name: 'GeoGi · 李沙沙名片',
      sourceType: 'business_card',
      notes: 'official_business_card:lishasha'
    }
  ];
  const personal = [];
  for (const item of personalDefaults) {
    let existing = rows.find((row) => row.notes === item.notes);
    if (!existing) existing = await upsertSource({ ...item, active: true });
    personal.push(existing);
  }
  return {
    website: official.find((item) => item.sourceType === 'website') || null,
    officialAccount: official.find((item) => item.sourceType === 'official_account') || null,
    officialBusinessCard: official.find((item) => item.sourceType === 'business_card') || null,
    liaoHuafengBusinessCard: personal.find((item) => item.notes === 'official_business_card:liaohuafeng') || null,
    liShashaBusinessCard: personal.find((item) => item.notes === 'official_business_card:lishasha') || null
  };
}

function validateDiscount({ discountType, discountRateBps }) {
  if (!['percent', 'free'].includes(discountType)) throw channelError('CHANNEL_DISCOUNT_TYPE_INVALID');
  if (discountType === 'free') return 0;
  const bps = Number(discountRateBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw channelError('CHANNEL_DISCOUNT_RATE_INVALID');
  return bps;
}

function generateSourceToken() {
  return 's_' + crypto.randomBytes(8).toString('hex');
}

function effectiveAt(record, nowMs) {
  if (!record || record.active === false) return false;
  if (record.startsAt && nowMs < Date.parse(record.startsAt)) return false;
  if (record.endsAt && nowMs >= Date.parse(record.endsAt)) return false;
  return true;
}

async function upsertSource(input = {}) {
  const requestedId = cleanText(input.sourceId, 120);
  return mutateJson(sourcesPath(), [], async (currentRows) => {
    const rows = Array.isArray(currentRows) ? currentRows.slice() : [];
    const now = new Date().toISOString();
    const sourceId = requestedId || 'source_' + crypto.randomUUID();
    const index = rows.findIndex((item) => item.sourceId === sourceId);
    const existing = index >= 0 ? rows[index] : null;
    const name = cleanText(input.name !== undefined ? input.name : existing && existing.name, 160);
    const sourceType = cleanText(input.sourceType !== undefined ? input.sourceType : existing && existing.sourceType, 40);
    const channelId = cleanText(input.channelId !== undefined ? input.channelId : existing && existing.channelId, 120);
    if (!name) throw channelError('SOURCE_NAME_REQUIRED');
    if (!SOURCE_TYPES.has(sourceType)) throw channelError('SOURCE_TYPE_INVALID');
    if (sourceType === 'channel' && !channelId) throw channelError('SOURCE_CHANNEL_REQUIRED');
    if (channelId) {
      const channels = await listChannels();
      if (!channels.some((item) => item.channelId === channelId)) throw channelError('CHANNEL_NOT_FOUND');
    }
    const startsAt = normalizeIso(input.startsAt !== undefined ? input.startsAt : existing && existing.startsAt);
    const endsAt = normalizeIso(input.endsAt !== undefined ? input.endsAt : existing && existing.endsAt);
    if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw channelError('SOURCE_EFFECTIVE_PERIOD_INVALID');
    const row = {
      sourceId,
      token: existing && existing.token || generateSourceToken(),
      name,
      sourceType,
      channelId,
      active: input.active !== undefined ? Boolean(input.active) : (existing ? Boolean(existing.active) : true),
      startsAt,
      endsAt,
      notes: cleanText(input.notes !== undefined ? input.notes : existing && existing.notes, 1000),
      createdAt: existing && existing.createdAt || now,
      updatedAt: now
    };
    if (index >= 0) rows[index] = row;
    else rows.push(row);
    return { next: rows, value: publicSource(row) };
  });
}

async function ensureChannelShareSource(channel) {
  const sources = await listSources();
  const existing = sources.find((item) => item.sourceType === 'channel' && item.channelId === channel.channelId && item.notes === 'auto_channel_share');
  if (existing) return existing;
  return upsertSource({
    sourceId: 'source_channel_share_' + channel.channelId,
    name: channel.name + ' · 微信分享',
    sourceType: 'channel',
    channelId: channel.channelId,
    active: true,
    notes: 'auto_channel_share'
  });
}

async function upsertChannel(input = {}) {
  const requestedId = cleanText(input.channelId, 120) || 'channel_' + crypto.randomUUID();
  const channel = await mutateJson(channelsPath(), [], async (currentRows) => {
    const rows = Array.isArray(currentRows) ? currentRows.slice() : [];
    const now = new Date().toISOString();
    const channelId = requestedId;
    const index = rows.findIndex((item) => item.channelId === channelId);
    const existing = index >= 0 ? rows[index] : null;
    const name = cleanText(input.name !== undefined ? input.name : existing && existing.name, 120);
    const redeemCode = normalizeRedeemCode(input.redeemCode !== undefined ? input.redeemCode : existing && existing.redeemCode);
    const discountType = cleanText(input.discountType !== undefined ? input.discountType : existing && existing.discountType, 20) || 'percent';
    const discountRateBps = validateDiscount({
      discountType,
      discountRateBps: input.discountRateBps !== undefined ? Number(input.discountRateBps) : Number(existing && existing.discountRateBps)
    });
    const commissionRateBps = Number(input.commissionRateBps !== undefined ? input.commissionRateBps : existing && existing.commissionRateBps || 0);
    if (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 10000) {
      throw channelError('CHANNEL_COMMISSION_RATE_INVALID');
    }
    if (!name) throw channelError('CHANNEL_NAME_REQUIRED');
    if (redeemCode && !/^[A-Z0-9_-]{2,40}$/.test(redeemCode)) throw channelError('CHANNEL_REDEEM_CODE_INVALID');
    if (redeemCode && rows.some((item) => item.channelId !== channelId && normalizeRedeemCode(item.redeemCode) === redeemCode)) {
      throw channelError('CHANNEL_REDEEM_CODE_DUPLICATE');
    }
    const startsAt = normalizeIso(input.startsAt !== undefined ? input.startsAt : existing && existing.startsAt);
    const endsAt = normalizeIso(input.endsAt !== undefined ? input.endsAt : existing && existing.endsAt);
    if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw channelError('CHANNEL_EFFECTIVE_PERIOD_INVALID');

    const row = {
      channelId,
      name,
      redeemCode,
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
    if (index >= 0) rows[index] = row;
    else rows.push(row);
    return { next: rows, value: publicChannel(row) };
  });
  const shareSource = await ensureChannelShareSource(channel);
  return { ...channel, shareSource };
}

async function resolveSourceToken(token, now = new Date()) {
  const cleanToken = cleanText(token, 40);
  if (!cleanToken) return {
    applied: false,
    sourceId: '',
    sourceToken: '',
    sourceName: '直接访问',
    sourceType: 'direct',
    sourceActive: true,
    channelId: '',
    channelName: '',
    channelBenefitActive: false,
    listPriceFen: BASE_PRICE_FEN,
    payableFen: BASE_PRICE_FEN,
    discountFen: 0,
    discountType: '',
    discountRateBps: 10000,
    commissionRateBps: 0
  };
  const sources = await listSources();
  const source = sources.find((item) => item.token === cleanToken);
  if (!source) throw channelError('SOURCE_TOKEN_NOT_FOUND');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const sourceActive = effectiveAt(source, nowMs);
  let channel = null;
  if (source.channelId) {
    const channels = await listChannels();
    channel = channels.find((item) => item.channelId === source.channelId) || null;
  }
  return {
    applied: true,
    sourceId: source.sourceId,
    sourceToken: source.token,
    sourceName: source.name,
    sourceType: source.sourceType,
    sourceActive,
    channelId: channel && channel.channelId || '',
    channelName: channel && channel.name || '',
    channelBenefitActive: false,
    listPriceFen: BASE_PRICE_FEN,
    payableFen: BASE_PRICE_FEN,
    discountFen: 0,
    discountType: '',
    discountRateBps: 10000,
    commissionRateBps: 0
  };
}

async function quoteRedeemCode(code, now = new Date()) {
  const redeemCode = normalizeRedeemCode(code);
  if (!redeemCode) throw channelError('REDEEM_CODE_REQUIRED');
  const channels = await listChannels();
  const channel = channels.find((item) => normalizeRedeemCode(item.redeemCode) === redeemCode);
  if (!channel) throw channelError('REDEEM_CODE_NOT_FOUND');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!effectiveAt(channel, nowMs)) {
    if (channel.startsAt && nowMs < Date.parse(channel.startsAt)) throw channelError('REDEEM_CODE_NOT_STARTED');
    if (channel.endsAt && nowMs >= Date.parse(channel.endsAt)) throw channelError('REDEEM_CODE_EXPIRED');
    throw channelError('REDEEM_CODE_INACTIVE');
  }
  const discountType = channel.discountType;
  const discountRateBps = discountType === 'free' ? 0 : Number(channel.discountRateBps || 10000);
  const payableFen = discountType === 'free'
    ? 0
    : Math.max(0, Math.min(BASE_PRICE_FEN, Math.round(BASE_PRICE_FEN * discountRateBps / 10000)));
  return {
    applied: true,
    redeemCode,
    channelId: channel.channelId,
    channelName: channel.name,
    listPriceFen: BASE_PRICE_FEN,
    payableFen,
    discountFen: BASE_PRICE_FEN - payableFen,
    discountType,
    discountRateBps,
    commissionRateBps: Number(channel.commissionRateBps || 0)
  };
}

async function recordSourceVisit({ attribution, visitorId = '', capturedAt = '' }) {
  if (!attribution || !attribution.sourceId) return null;
  return mutateJson(visitsPath(), [], async (currentRows) => {
    const rows = Array.isArray(currentRows) ? currentRows : [];
    const now = capturedAt || new Date().toISOString();
    const cleanVisitorId = cleanText(visitorId, 120);
    const last = rows.findLast && rows.findLast((item) => (
      item.sourceId === attribution.sourceId
      && item.visitorId === cleanVisitorId
      && Date.parse(now) - Date.parse(item.capturedAt || '') < 30 * 60 * 1000
    ));
    if (last) return { write: false, value: last };
    const record = {
      visitId: 'visit_' + crypto.randomUUID(),
      sourceId: attribution.sourceId,
      sourceToken: attribution.sourceToken,
      sourceName: attribution.sourceName,
      sourceType: attribution.sourceType,
      channelId: attribution.channelId || '',
      visitorId: cleanVisitorId,
      capturedAt: now
    };
    const next = rows.concat(record).slice(-20000);
    return { next, value: record };
  });
}

async function listSourceVisits() {
  const rows = await readJson(visitsPath(), []);
  return Array.isArray(rows) ? rows : [];
}

async function listCommissionRecords() {
  const rows = await readJson(commissionsPath(), []);
  return Array.isArray(rows) ? rows : [];
}

async function reconcileCommission({ order, releasedAt = '' }) {
  if (!order || !order.projectId || !order.channelId) return null;
  return mutateJson(commissionsPath(), [], async (currentRows) => {
    const rows = Array.isArray(currentRows) ? currentRows.slice() : [];
    const index = rows.findIndex((item) => item.projectId === order.projectId);
    const existing = index >= 0 ? rows[index] : null;
    const effectiveReleasedAt = releasedAt || order.reportReleasedAt || existing && existing.reportReleasedAt || '';
    if (!effectiveReleasedAt) return { write: false, value: existing || null };
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
      sourceId: order.sourceId || '',
      sourceName: order.sourceName || '',
      sourceType: order.sourceType || '',
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
      payoutStatus: overpaidFen > 0
        ? 'adjustment_required'
        : (earnedFen <= 0 ? 'not_applicable' : (dueFen > 0 ? 'pending' : 'paid')),
      payoutAt: existing && existing.payoutAt || '',
      payoutReference: existing && existing.payoutReference || '',
      payoutOperatorId: existing && existing.payoutOperatorId || '',
      createdAt: existing && existing.createdAt || now,
      updatedAt: now
    };
    if (index >= 0) rows[index] = record;
    else rows.push(record);
    return { next: rows, value: record };
  });
}

async function settleChannelPeriod({ channelId, period, operatorId = '', payoutReference = '' }) {
  const cleanChannelId = cleanText(channelId, 120);
  const cleanPeriod = cleanText(period, 20);
  if (!cleanChannelId) throw channelError('CHANNEL_ID_REQUIRED');
  if (!/^\d{4}-\d{2}$/.test(cleanPeriod)) throw channelError('CHANNEL_SETTLEMENT_PERIOD_INVALID');
  const channels = await listChannels();
  if (!channels.some((item) => item.channelId === cleanChannelId)) throw channelError('CHANNEL_NOT_FOUND');
  return mutateJson(commissionsPath(), [], async (currentRows) => {
    const rows = Array.isArray(currentRows) ? currentRows.slice() : [];
    let changed = 0;
    let payoutFen = 0;
    const now = new Date().toISOString();
    for (const row of rows) {
      if (row.channelId !== cleanChannelId || row.period !== cleanPeriod) continue;
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
    if (!changed) throw channelError('CHANNEL_SETTLEMENT_NOTHING_DUE');
    return {
      next: rows,
      value: { ok: true, channelId: cleanChannelId, period: cleanPeriod, settledRecords: changed, payoutFen, payoutYuan: payoutFen / 100, payoutAt: now }
    };
  });
}

module.exports = {
  BASE_PRICE_FEN,
  SOURCE_TYPES,
  listChannels,
  listSources,
  ensureDefaultOfficialSources,
  ensureOfficialDistributionSources,
  upsertChannel,
  upsertSource,
  resolveSourceToken,
  quoteRedeemCode,
  normalizeRedeemCode,
  recordSourceVisit,
  listSourceVisits,
  listCommissionRecords,
  reconcileCommission,
  settleChannelPeriod
};
