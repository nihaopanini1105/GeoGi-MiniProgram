const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRODUCT_CODE = 'diagnostic_report_199';
const PRODUCT_NAME = 'GeoGi 品牌 GEO 诊断报告';
const PRODUCT_PRICE_FEN = 19900;
const PRODUCT_PRICE_YUAN = 199;
const CURRENCY = 'CNY';
const PAYMENT_ORDER_TTL_MINUTES = 30;
const PAYMENT_ORDER_TTL_MS = PAYMENT_ORDER_TTL_MINUTES * 60 * 1000;

const PAYMENT_STATUSES = new Set([
  'unpaid', 'paying', 'paid', 'free', 'payment_failed', 'closed',
  'refund_processing', 'partially_refunded', 'refunded'
]);

function paymentRoot() {
  return process.env.GEOGI_PAYMENT_DATA_ROOT || path.join(__dirname, '../../data/payments');
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function orderPath(outTradeNo) {
  return path.join(paymentRoot(), safeName(outTradeNo) + '.json');
}

function canonicalOrder(order) {
  const row = { ...order };
  if (!PAYMENT_STATUSES.has(row.status)) throw new Error('PAYMENT_STATUS_INVALID');
  const amountTotal = Number(row.amountTotal);
  if (!Number.isInteger(amountTotal) || amountTotal < 0 || amountTotal > PRODUCT_PRICE_FEN) throw new Error('PAYMENT_AMOUNT_INVALID');
  row.listPriceFen = Number.isInteger(Number(row.listPriceFen)) ? Number(row.listPriceFen) : PRODUCT_PRICE_FEN;
  if (row.listPriceFen !== PRODUCT_PRICE_FEN) throw new Error('PAYMENT_LIST_PRICE_INVALID');
  if (row.currency !== CURRENCY) throw new Error('PAYMENT_CURRENCY_INVALID');
  if (row.productCode !== PRODUCT_CODE) throw new Error('PAYMENT_PRODUCT_INVALID');
  if (!row.projectId || !row.clientId || !row.outTradeNo) throw new Error('PAYMENT_SCOPE_REQUIRED');
  row.refunds = Array.isArray(row.refunds) ? row.refunds : [];
  row.closedReason = String(row.closedReason || '');
  row.sourceId = String(row.sourceId || '').trim().slice(0, 120);
  row.sourceToken = String(row.sourceToken || '').trim().slice(0, 40);
  row.sourceName = String(row.sourceName || '').trim().slice(0, 160);
  row.sourceType = String(row.sourceType || '').trim().slice(0, 40);
  row.sourceOwnerName = String(row.sourceOwnerName || '').trim().slice(0, 120);
  row.sourceOwnerPhone = String(row.sourceOwnerPhone || '').trim().slice(0, 40);
  row.sourceCapturedAt = String(row.sourceCapturedAt || '').trim().slice(0, 80);
  row.channelId = String(row.channelId || '').trim().slice(0, 120);
  row.channelName = String(row.channelName || '').trim().slice(0, 120);
  row.discountType = String(row.discountType || '').trim().slice(0, 20);
  row.discountRateBps = Number(row.discountRateBps || 0);
  row.commissionRateBps = Number(row.commissionRateBps || 0);
  row.reportReleasedAt = String(row.reportReleasedAt || '').trim().slice(0, 80);
  if (!row.expiresAt) {
    const createdMs = Date.parse(row.createdAt || '');
    row.expiresAt = new Date((Number.isFinite(createdMs) ? createdMs : Date.now()) + PAYMENT_ORDER_TTL_MS).toISOString();
  }
  return row;
}

function isPaymentOrderExpired(order, nowMs = Date.now()) {
  if (!order || !['unpaid', 'paying', 'payment_failed'].includes(String(order.status || ''))) return false;
  const expiresAtMs = Date.parse(order.expiresAt || '');
  return Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs;
}

async function writeOrder(order) {
  const normalized = canonicalOrder(order);
  await fs.promises.mkdir(paymentRoot(), { recursive: true, mode: 0o700 });
  await fs.promises.chmod(paymentRoot(), 0o700);
  const target = orderPath(normalized.outTradeNo);
  const temp = target + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fs.promises.writeFile(temp, JSON.stringify(normalized, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temp, target);
  await fs.promises.chmod(target, 0o600);
  return normalized;
}

async function readOrderFile(filePath) {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  return canonicalOrder(JSON.parse(raw));
}

async function listPaymentOrders() {
  let files = [];
  try {
    files = await fs.promises.readdir(paymentRoot());
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const name of files.filter((item) => item.endsWith('.json')).sort()) {
    try {
      rows.push(await readOrderFile(path.join(paymentRoot(), name)));
    } catch (error) {
      console.error('invalid payment record skipped', name, error);
    }
  }
  return rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function findPaymentByProject(projectId) {
  const value = String(projectId || '').trim();
  if (!value) return null;
  return (await listPaymentOrders()).find((row) => row.projectId === value) || null;
}

async function findPaymentByOutTradeNo(outTradeNo) {
  const value = String(outTradeNo || '').trim();
  if (!value) return null;
  try {
    return await readOrderFile(orderPath(value));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function makeOutTradeNo(projectId) {
  const project = String(projectId || '').trim();
  if (!project) throw new Error('PAYMENT_PROJECT_REQUIRED');
  const digest = crypto.createHash('sha256').update(project + ':' + crypto.randomUUID()).digest('hex').toUpperCase();
  return ('GG199' + digest.slice(0, 27)).slice(0, 32);
}

async function createOrGetPaymentOrder(input) {
  const existing = await findPaymentByProject(input.projectId);
  if (existing && existing.status !== 'closed') return { created: false, order: existing };
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const amountTotal = Number.isInteger(Number(input.amountTotal)) ? Number(input.amountTotal) : PRODUCT_PRICE_FEN;
  const order = canonicalOrder({
    paymentOrderId: 'payment_' + crypto.randomUUID(),
    outTradeNo: makeOutTradeNo(input.projectId),
    clientId: String(input.clientId || '').trim(),
    projectId: String(input.projectId || '').trim(),
    submissionId: String(input.submissionId || '').trim(),
    brandName: String(input.brandName || '').trim().slice(0, 120),
    phoneNumber: String(input.phoneNumber || '').trim().slice(0, 40),
    productCode: PRODUCT_CODE,
    productName: PRODUCT_NAME,
    listPriceFen: PRODUCT_PRICE_FEN,
    amountTotal,
    amountYuan: amountTotal / 100,
    currency: CURRENCY,
    provider: amountTotal === 0 ? 'channel_offer' : 'wechat_pay',
    status: amountTotal === 0 ? 'free' : 'unpaid',
    providerTradeState: '',
    transactionId: '',
    prepayId: '',
    payerOpenidHash: '',
    sourceId: input.sourceId,
    sourceToken: input.sourceToken,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    sourceOwnerName: input.sourceOwnerName,
    sourceOwnerPhone: input.sourceOwnerPhone,
    sourceCapturedAt: input.sourceCapturedAt,
    channelId: input.channelId,
    channelName: input.channelName,
    discountType: input.discountType,
    discountRateBps: Number(input.discountRateBps || 0),
    discountFen: Math.max(0, PRODUCT_PRICE_FEN - amountTotal),
    commissionRateBps: Number(input.commissionRateBps || 0),
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(nowMs + PAYMENT_ORDER_TTL_MS).toISOString(),
    paidAt: amountTotal === 0 ? now : '',
    closedAt: '',
    closedReason: '',
    refundableAmount: 0,
    refundedAmount: 0,
    refunds: [],
    reportReleasedAt: ''
  });
  await writeOrder(order);
  return { created: true, order };
}

async function updatePaymentOrder(outTradeNo, patch) {
  const existing = await findPaymentByOutTradeNo(outTradeNo);
  if (!existing) throw new Error('PAYMENT_ORDER_NOT_FOUND');
  const immutable = {
    outTradeNo: existing.outTradeNo,
    clientId: existing.clientId,
    projectId: existing.projectId,
    productCode: existing.productCode,
    listPriceFen: existing.listPriceFen,
    amountTotal: existing.amountTotal,
    sourceId: existing.sourceId,
    sourceToken: existing.sourceToken,
    sourceName: existing.sourceName,
    sourceType: existing.sourceType,
    sourceOwnerName: existing.sourceOwnerName,
    sourceOwnerPhone: existing.sourceOwnerPhone,
    sourceCapturedAt: existing.sourceCapturedAt,
    channelId: existing.channelId,
    channelName: existing.channelName,
    discountType: existing.discountType,
    discountRateBps: existing.discountRateBps,
    discountFen: existing.discountFen,
    commissionRateBps: existing.commissionRateBps,
    currency: existing.currency
  };
  const next = canonicalOrder({
    ...existing,
    ...(patch || {}),
    ...immutable,
    updatedAt: new Date().toISOString()
  });
  await writeOrder(next);
  return next;
}

async function markProjectReportReleased(projectId, releasedAt) {
  const order = await findPaymentByProject(projectId);
  if (!order) return null;
  if (order.reportReleasedAt) return order;
  return updatePaymentOrder(order.outTradeNo, {
    reportReleasedAt: String(releasedAt || new Date().toISOString())
  });
}

function maskContact(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^1\d{10}$/.test(text)) return text.slice(0, 3) + '****' + text.slice(-4);
  return text.length > 5 ? text.slice(0, 2) + '***' + text.slice(-2) : '***';
}

function publicPaymentView(order) {
  if (!order) return null;
  return {
    paymentOrderId: order.paymentOrderId,
    outTradeNo: order.outTradeNo,
    clientId: order.clientId,
    projectId: order.projectId,
    submissionId: order.submissionId || '',
    brandName: order.brandName,
    customerContactMasked: maskContact(order.phoneNumber),
    productCode: order.productCode,
    productName: order.productName,
    listPriceFen: order.listPriceFen || PRODUCT_PRICE_FEN,
    listPriceYuan: Number(order.listPriceFen || PRODUCT_PRICE_FEN) / 100,
    amountTotal: order.amountTotal,
    amountYuan: Number(order.amountTotal || 0) / 100,
    discountFen: Number(order.discountFen || 0),
    discountYuan: Number(order.discountFen || 0) / 100,
    sourceId: order.sourceId || '',
    sourceName: order.sourceName || '',
    sourceType: order.sourceType || '',
    channelId: order.channelId || '',
    channelName: order.channelName || '',
    discountType: order.discountType || '',
    discountRateBps: Number(order.discountRateBps || 0),
    currency: order.currency,
    provider: order.provider,
    status: order.status,
    providerTradeState: order.providerTradeState,
    transactionId: order.transactionId || '',
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt || '',
    expiresAt: order.expiresAt || '',
    closedAt: order.closedAt || '',
    closedReason: order.closedReason || '',
    reportReleasedAt: order.reportReleasedAt || '',
    orderValidityMinutes: PAYMENT_ORDER_TTL_MINUTES,
    canCancel: ['unpaid', 'paying', 'payment_failed'].includes(order.status) && !isPaymentOrderExpired(order),
    refundableAmount: ['paid', 'refund_processing', 'partially_refunded'].includes(order.status)
      ? Number(order.refundableAmount || 0)
      : 0,
    refundedAmount: Number(order.refundedAmount || 0),
    refunds: (order.refunds || []).map((refund) => ({
      refundId: refund.refundId,
      outRefundNo: refund.outRefundNo,
      providerRefundId: refund.providerRefundId || '',
      amount: refund.amount,
      amountYuan: Number(refund.amount || 0) / 100,
      status: refund.status,
      reason: refund.reason || '',
      requestedAt: refund.requestedAt || '',
      successAt: refund.successAt || '',
      operatorId: refund.operatorId || ''
    }))
  };
}

function operationsPaymentView(order) {
  const view = publicPaymentView(order);
  if (!view) return null;
  return {
    ...view,
    sourceToken: order.sourceToken || '',
    sourceCapturedAt: order.sourceCapturedAt || '',
    commissionRateBps: Number(order.commissionRateBps || 0)
  };
}

function paymentSummary(orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const latestByProject = new Map();
  for (const row of rows) {
    if (!latestByProject.has(row.projectId)) latestByProject.set(row.projectId, row);
  }
  const latestRows = [...latestByProject.values()];
  const paidRows = rows.filter((row) => ['paid', 'free', 'refund_processing', 'partially_refunded', 'refunded'].includes(row.status));
  const gross = paidRows.reduce((sum, row) => sum + Number(row.amountTotal || 0), 0);
  const refunded = rows.reduce((sum, row) => sum + Number(row.refundedAmount || 0), 0);
  const paidProjectIds = new Set(rows.filter((row) => (
    Boolean(row.paidAt || row.transactionId)
    || ['paid', 'free', 'refund_processing', 'partially_refunded', 'refunded'].includes(row.status)
  )).map((row) => row.projectId));
  return {
    orderCount: latestRows.length,
    paymentAttemptCount: rows.length,
    unpaidCount: latestRows.filter((row) => ['unpaid', 'paying', 'payment_failed'].includes(row.status)).length,
    paidCount: latestRows.filter((row) => ['paid', 'free'].includes(row.status)).length,
    freeCount: latestRows.filter((row) => row.status === 'free').length,
    paidEverCount: paidProjectIds.size,
    paymentConversionRate: latestRows.length ? paidProjectIds.size / latestRows.length : 0,
    refundProcessingCount: latestRows.filter((row) => row.status === 'refund_processing').length,
    partiallyRefundedCount: latestRows.filter((row) => row.status === 'partially_refunded').length,
    refundedCount: latestRows.filter((row) => row.status === 'refunded').length,
    closedCount: latestRows.filter((row) => row.status === 'closed').length,
    grossPaidAmount: gross,
    grossPaidYuan: gross / 100,
    refundedAmount: refunded,
    refundedYuan: refunded / 100,
    netPaidAmount: gross - refunded,
    netPaidYuan: (gross - refunded) / 100,
    currency: CURRENCY
  };
}

module.exports = {
  PRODUCT_CODE,
  PRODUCT_NAME,
  PRODUCT_PRICE_FEN,
  PRODUCT_PRICE_YUAN,
  CURRENCY,
  PAYMENT_ORDER_TTL_MINUTES,
  PAYMENT_ORDER_TTL_MS,
  PAYMENT_STATUSES,
  isPaymentOrderExpired,
  createOrGetPaymentOrder,
  findPaymentByProject,
  findPaymentByOutTradeNo,
  listPaymentOrders,
  updatePaymentOrder,
  markProjectReportReleased,
  publicPaymentView,
  operationsPaymentView,
  paymentSummary
};
