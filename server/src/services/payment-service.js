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
  paymentSummary,
  isPaymentOrderExpired
} = require('./payment-store');
const {
  createJsapiPayment,
  closePaymentOrder,
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

function paymentProjectionState(paymentStatus) {
  const status = String(paymentStatus || '');
  const paid = status === 'paid';
  const partiallyRefunded = status === 'partially_refunded';
  const refundProcessing = status === 'refund_processing';
  const refunded = status === 'refunded';
  const serviceEligible = paid || partiallyRefunded;
  return {
    serviceEligible,
    currentStatus: paid
      ? '已付款'
      : (partiallyRefunded ? '部分退款' : (refundProcessing ? '退款处理中' : (refunded ? '已退款' : '待付款'))),
    nextAction: serviceEligible
      ? 'GeoGi 将开始品牌 GEO 诊断并生成诊断报告'
      : (refundProcessing
          ? '等待微信支付退款结果确认'
          : (refunded ? '订单已退款，如需诊断请重新提交' : '支付 199 元后开始品牌 GEO 诊断')),
    auditStatus: paid
      ? '待 OS 处理'
      : (partiallyRefunded ? '部分退款' : (refundProcessing ? '退款处理中' : (refunded ? '已退款' : '待付款'))),
    projectStage: serviceEligible
      ? 'INTAKE'
      : (refundProcessing ? 'REFUND_PROCESSING' : (refunded ? 'REFUNDED' : 'PAYMENT_PENDING'))
  };
}

function paymentProjectionDecision(currentStage, paymentStatus) {
  const stage = String(currentStage || 'PAYMENT_PENDING').toUpperCase();
  const state = paymentProjectionState(paymentStatus);
  const paymentGateStages = new Set(['', 'PAYMENT_PENDING', 'INTAKE', 'REFUND_PROCESSING', 'REFUNDED']);
  if (!paymentGateStages.has(stage)) {
    return {
      ...state,
      mutateBusinessProjection: false,
      projectStage: stage
    };
  }
  return {
    mutateBusinessProjection: true,
    ...state
  };
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

  const currentStage = text(project.fields && project.fields.当前阶段) || 'PAYMENT_PENDING';
  const decision = paymentProjectionDecision(currentStage, paymentStatus);
  if (!decision.mutateBusinessProjection) return true;

  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    recordId: lead.record_id || lead.recordId,
    fields: {
      当前状态: decision.currentStatus,
      下一步动作: decision.nextAction,
      审核状态: decision.auditStatus
    }
  });
  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
    recordId: project.record_id || project.recordId,
    fields: {
      当前阶段: decision.projectStage,
      审核状态: decision.auditStatus
    }
  });
  return true;
}

async function refreshExpiredPaymentOrder(order) {
  if (!order || !isPaymentOrderExpired(order)) return order;
  try {
    return await closePaymentOrder(order, 'expired');
  } catch (closeError) {
    if (order.prepayId || order.status === 'paying') {
      const synced = await syncPaymentOrder(order);
      if (['paid', 'partially_refunded', 'closed'].includes(synced.status)) return synced;
    }
    throw closeError;
  }
}

async function cancelActivePaymentOrder(order) {
  if (!order) return null;
  if (['paid', 'refund_processing', 'partially_refunded', 'refunded'].includes(order.status)) {
    const error = new Error('PAYMENT_ORDER_NOT_CANCELLABLE');
    error.code = 'PAYMENT_ORDER_NOT_CANCELLABLE';
    throw error;
  }
  if (order.status === 'closed') return order;
  try {
    return await closePaymentOrder(order, 'customer_cancelled');
  } catch (closeError) {
    if (order.prepayId || order.status === 'paying') {
      const synced = await syncPaymentOrder(order);
      if (['paid', 'partially_refunded'].includes(synced.status)) {
        const error = new Error('PAYMENT_ORDER_NOT_CANCELLABLE');
        error.code = 'PAYMENT_ORDER_NOT_CANCELLABLE';
        throw error;
      }
      if (synced.status === 'closed') return synced;
    }
    throw closeError;
  }
}

async function ensureOrder({ clientId, projectId, phoneNumber }) {
  const context = await findProjectContext({ clientId, projectId });
  if (!context) {
    const error = new Error('PAYMENT_PROJECT_NOT_FOUND');
    error.code = 'PAYMENT_PROJECT_NOT_FOUND';
    throw error;
  }
  const existing = await findPaymentByProject(projectId);
  if (existing && isPaymentOrderExpired(existing)) {
    const expired = await refreshExpiredPaymentOrder(existing);
    await projectPaymentProjection({ projectId, paymentStatus: expired.status });
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
  let order = await findPaymentByProject(projectId);
  if (order && isPaymentOrderExpired(order)) {
    order = await refreshExpiredPaymentOrder(order);
    await projectPaymentProjection({ projectId, paymentStatus: order.status });
  }
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
  let order = await findPaymentByProject(projectId);
  if (!order) return { ok: false, userMessage: '还没有创建支付订单' };
  if (isPaymentOrderExpired(order)) {
    order = await refreshExpiredPaymentOrder(order);
    await projectPaymentProjection({ projectId, paymentStatus: order.status });
    return { ok: true, payment: publicPaymentView(order) };
  }
  if (order.status === 'closed') return { ok: true, payment: publicPaymentView(order) };
  const synced = await syncPaymentOrder(order);
  await projectPaymentProjection({ projectId, paymentStatus: synced.status });
  return { ok: true, payment: publicPaymentView(synced) };
}

async function cancelCustomerPayment({ clientId, projectId }) {
  const context = await findProjectContext({ clientId, projectId });
  if (!context) return { ok: false, userMessage: '没有找到这条诊断记录' };
  let order = await findPaymentByProject(projectId);
  if (!order) return { ok: false, userMessage: '还没有创建支付订单' };
  if (isPaymentOrderExpired(order)) {
    order = await refreshExpiredPaymentOrder(order);
  } else {
    order = await cancelActivePaymentOrder(order);
  }
  await projectPaymentProjection({ projectId, paymentStatus: order.status });
  return {
    ok: true,
    payment: publicPaymentView(order),
    userMessage: order.closedReason === 'expired' ? '支付订单已失效' : '订单已取消'
  };
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
  const requestedAmount = amountFen === undefined || amountFen === null || amountFen === ''
    ? Number(order.refundableAmount || 0)
    : Number(amountFen);
  const refunded = await requestRefund({
    order,
    amount: requestedAmount,
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
  cancelCustomerPayment,
  projectPaymentProjection,
  paymentProjectionState,
  paymentProjectionDecision,
  listPaymentsForOs,
  refundPaymentForOs
};
