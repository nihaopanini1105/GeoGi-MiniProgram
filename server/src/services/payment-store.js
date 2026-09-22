const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRODUCT_CODE = 'diagnostic_report_199';
const PRODUCT_NAME = 'GeoGi 品牌 GEO 诊断报告';
const PRODUCT_PRICE_FEN = 19900;
const PRODUCT_PRICE_YUAN = 199;
const CURRENCY = 'CNY';

const PAYMENT_STATUSES = new Set([
  'unpaid', 'paying', 'paid', 'payment_failed', 'closed',
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
  if (Number(row.amountTotal) !== PRODUCT_PRICE_FEN) throw new Error('PAYMENT_AMOUNT_INVALID');
  if (row.currency !== CURRENCY) throw new Error('PAYMENT_CURRENCY_INVALID');
  if (row.productCode !== PRODUCT_CODE) throw new Error('PAYMENT_PRODUCT_INVALID');
  if (!row.projectId || !row.clientId || !row.outTradeNo) throw new Error('PAYMENT_SCOPE_REQUIRED');
  row.refunds = Array.isArray(row.refunds) ? row.refunds : [];
  return row;
}

async function writeOrder(order) {
  const normalized = canonicalOrder(order);
  await fs.promises.mkdir(paymentRoot(), { recursive: true, mode: 0o700 });
  await fs.promises.chmod(paymentRoot(), 0o700);
  const target = orderPath(normalized.outTradeNo);
  const temp = target + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fs.promises.writeFile(
    temp,
    JSON.stringify(normalized, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 }
  );
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
  const digest = crypto.createHash('sha256').update(project).digest('hex').toUpperCase();
  return ('GG199' + digest.slice(0, 27)).slice(0, 32);
}

async function createOrGetPaymentOrder(input) {
  const existing = await findPaymentByProject(input.projectId);
  if (existing) return { created: false, order: existing };
  const now = new Date().toISOString();
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
    amountTotal: PRODUCT_PRICE_FEN,
    amountYuan: PRODUCT_PRICE_YUAN,
    currency: CURRENCY,
    provider: 'wechat_pay',
    status: 'unpaid',
    providerTradeState: '',
    transactionId: '',
    prepayId: '',
    payerOpenidHash: '',
    createdAt: now,
    updatedAt: now,
    paidAt: '',
    closedAt: '',
    refundableAmount: PRODUCT_PRICE_FEN,
    refundedAmount: 0,
    refunds: []
  });
  await writeOrder(order);
  return { created: true, order };
}

async function updatePaymentOrder(outTradeNo, patch) {
  const existing = await findPaymentByOutTradeNo(outTradeNo);
  if (!existing) throw new Error('PAYMENT_ORDER_NOT_FOUND');
  const next = canonicalOrder({
    ...existing,
    ...(patch || {}),
    outTradeNo: existing.outTradeNo,
    clientId: existing.clientId,
    projectId: existing.projectId,
    productCode: existing.productCode,
    amountTotal: existing.amountTotal,
    currency: existing.currency,
    updatedAt: new Date().toISOString()
  });
  await writeOrder(next);
  return next;
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
    amountTotal: order.amountTotal,
    amountYuan: order.amountYuan,
    currency: order.currency,
    provider: order.provider,
    status: order.status,
    providerTradeState: order.providerTradeState,
    transactionId: order.transactionId || '',
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt || '',
    refundableAmount: Number(order.refundableAmount || 0),
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

function paymentSummary(orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const paidRows = rows.filter((row) => ['paid', 'refund_processing', 'partially_refunded', 'refunded'].includes(row.status));
  const gross = paidRows.reduce((sum, row) => sum + Number(row.amountTotal || 0), 0);
  const refunded = rows.reduce((sum, row) => sum + Number(row.refundedAmount || 0), 0);
  const paidEverRows = rows.filter((row) => (
    Boolean(row.paidAt || row.transactionId)
    || ['paid', 'refund_processing', 'partially_refunded', 'refunded'].includes(row.status)
  ));
  const paymentConversionRate = rows.length ? paidEverRows.length / rows.length : 0;
  return {
    orderCount: rows.length,
    unpaidCount: rows.filter((row) => ['unpaid', 'paying', 'payment_failed'].includes(row.status)).length,
    paidCount: rows.filter((row) => row.status === 'paid').length,
    paidEverCount: paidEverRows.length,
    paymentConversionRate,
    refundProcessingCount: rows.filter((row) => row.status === 'refund_processing').length,
    partiallyRefundedCount: rows.filter((row) => row.status === 'partially_refunded').length,
    refundedCount: rows.filter((row) => row.status === 'refunded').length,
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
  PAYMENT_STATUSES,
  createOrGetPaymentOrder,
  findPaymentByProject,
  findPaymentByOutTradeNo,
  listPaymentOrders,
  updatePaymentOrder,
  publicPaymentView,
  paymentSummary
};
