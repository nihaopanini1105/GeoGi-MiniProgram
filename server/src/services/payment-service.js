const {
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord
} = require('./feishu');
const {
  PRODUCT_NAME,
  PRODUCT_PRICE_FEN,
  PRODUCT_PRICE_YUAN,
  createOrGetPaymentOrder,
  findPaymentByProject,
  findPaymentByOutTradeNo,
  listPaymentOrders,
  publicPaymentView,
  paymentSummary
} = require('./payment-store');
const {
  createJsapiPayment,
  syncPaymentOrder,
  requestRefund
} = require('./wechat-pay');

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

async function findProjectContext({ clientId, projectId }) {
  const tenantToken = await getTenantAccessToken();
  const [leads, projects] = await Promise.all([
    listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      pageSize: 100
    }),
    listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      pageSize: 100
    })
  ]);
  const lead = leads.find((record) => {
    const fields = record.fields || {};
    return text(fields.客户编号) === clientId && text(fields.项目编号) === projectId;
  });
  const project = projects.find((record) => {
    const fields = record.fields || {};
    return text(fields.客户编号) === clientId && text(fields.项目编号) === projectId;
  });
  if (!lead || !project) return null;
  return { tenantToken, lead, project };
}

async function projectPaymentProjection({ projectId, paymentStatus }) {
  const tenantToken = await getTenantAccessToken();
  const [leads, projects] = await Promise.all([
    listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      pageSize: 100
    }),
    listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      pageSize: 100
    })
  ]);
  const lead = leads.find((record) => text(record.fields && record.fields.项目编号) === projectId);
  const project = projects.find((record) => text(record.fields && record.fields.项目编号) === projectId);
  if (!lead || !project) return false;

  const paid = ['paid', 'partially_refunded'].includes(String(paymentStatus || ''));
  const refunded = String(paymentStatus || '') === 'refunded';
  const currentStatus = paid ? '已付款' : (refunded ? '已退款' : '待付款');
  const nextAction = paid
    ? 'GeoGi 将开始品牌 GEO 诊断并生成诊断报告'
    : (refunded ? '订单已退款，如需诊断请重新提交' : '支付 199 元后开始品牌 GEO 诊断');
  const auditStatus = paid ? '待 OS 处理' : (refunded ? '已退款' : '待付款');
  const projectStage = paid ? 'INTAKE' : (refunded ? 'REFUNDED' : 'PAYMENT_PENDING');

  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    recordId: lead.record_id || lead.recordId,
    fields: {
      当前状态: currentStatus,
      下一步动作: nextAction,
      审核状态: auditStatus
    }
  });
  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
    recordId: project.record_id || project.recordId,
    fields: {
      当前阶段: projectStage,
      审核状态: auditStatus
    }
  });
  return true;
}

async function ensureOrder({ clientId, projectId, phoneNumber }) {
  const context = await findProjectContext({ clientId, projectId });
  if (!context) {
    const error = new Error('PAYMENT_PROJECT_NOT_FOUND');
    error.code = 'PAYMENT_PROJECT_NOT_FOUND';
    throw error;
  }
  const fields = context.lead.fields || {};
  const result = await createOrGetPaymentOrder({
    clientId,
    projectId,
    submissionId: text(fields.提交ID),
    brandName: text(fields.品牌名称),
    phoneNumber
  });
  return result.order;
}

async function createCustomerPayment({ clientId, projectId, phoneNumber, loginCode }) {
  const order = await ensureOrder({ clientId, projectId, phoneNumber });
  const result = await createJsapiPayment(order, loginCode);
  return {
    ok: true,
    payment: publicPaymentView(result.order),
    payParams: result.payParams || null,
    alreadyPaid: result.alreadyPaid === true,
    product: {
      code: 'diagnostic_report_199',
      name: PRODUCT_NAME,
      priceYuan: PRODUCT_PRICE_YUAN,
      amountTotal: PRODUCT_PRICE_FEN,
      currency: 'CNY'
    }
  };
}

async function getCustomerPayment({ clientId, projectId }) {
  const context = await findProjectContext({ clientId, projectId });
  if (!context) return { ok: false, userMessage: '没有找到这条诊断记录' };
  const order = await findPaymentByProject(projectId);
  return {
    ok: true,
    payment: publicPaymentView(order),
    paymentRequired: true,
    product: {
      code: 'diagnostic_report_199',
      name: PRODUCT_NAME,
      priceYuan: PRODUCT_PRICE_YUAN,
      amountTotal: PRODUCT_PRICE_FEN,
      currency: 'CNY'
    }
  };
}

async function syncCustomerPayment({ clientId, projectId }) {
  const context = await findProjectContext({ clientId, projectId });
  if (!context) return { ok: false, userMessage: '没有找到这条诊断记录' };
  const order = await findPaymentByProject(projectId);
  if (!order) return { ok: false, userMessage: '还没有创建支付订单' };
  const synced = await syncPaymentOrder(order);
  await projectPaymentProjection({ projectId, paymentStatus: synced.status });
  return { ok: true, payment: publicPaymentView(synced) };
}

async function listPaymentsForOs() {
  const orders = await listPaymentOrders();
  return {
    summary: paymentSummary(orders),
    items: orders.map(publicPaymentView)
  };
}

async function refundPaymentForOs({ outTradeNo, amountFen, reason, operatorId }) {
  const order = await findPaymentByOutTradeNo(outTradeNo);
  if (!order) {
    const error = new Error('PAYMENT_ORDER_NOT_FOUND');
    error.code = 'PAYMENT_ORDER_NOT_FOUND';
    throw error;
  }
  const refunded = await requestRefund({
    order,
    amount: Number(amountFen),
    reason,
    operatorId
  });
  await projectPaymentProjection({ projectId: refunded.projectId, paymentStatus: refunded.status });
  return publicPaymentView(refunded);
}

module.exports = {
  ensureOrder,
  createCustomerPayment,
  getCustomerPayment,
  syncCustomerPayment,
  projectPaymentProjection,
  listPaymentsForOs,
  refundPaymentForOs
};
