const {
  getTenantAccessToken,
  sendWebhookText,
  sendBotText
} = require('./feishu');

const DEFAULT_OPS_URL = 'https://ops.geogi.cn';

function opsUrl() {
  return String(process.env.GEOGI_OPS_URL || DEFAULT_OPS_URL).trim() || DEFAULT_OPS_URL;
}

function notificationConfigured() {
  return Boolean(
    String(process.env.FEISHU_NOTIFY_WEBHOOK || '').trim()
    || String(process.env.FEISHU_NOTIFY_RECEIVE_ID || '').trim()
  );
}

async function deliverText(text) {
  if (String(process.env.FEISHU_NOTIFY_WEBHOOK || '').trim()) {
    await sendWebhookText(text);
    return { delivered: true, channel: 'webhook' };
  }
  if (String(process.env.FEISHU_NOTIFY_RECEIVE_ID || '').trim()) {
    const tenantToken = await getTenantAccessToken();
    await sendBotText({ tenantToken, text });
    return { delivered: true, channel: 'bot' };
  }
  return { delivered: false, channel: 'not_configured' };
}

async function safeNotify(kind, text) {
  if (!notificationConfigured()) {
    console.warn(`[feishu-notify] skipped kind=${kind} reason=not_configured`);
    return false;
  }
  try {
    const result = await deliverText(text);
    console.log(`[feishu-notify] delivered kind=${kind} channel=${result.channel}`);
    return true;
  } catch (error) {
    console.error(`[feishu-notify] failed kind=${kind}`, error);
    return false;
  }
}

function notifyDetached(kind, text) {
  void safeNotify(kind, text);
}

function line(label, value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  return text ? `${label}：${text}` : '';
}

function amountYuanFromFen(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? (amount / 100).toFixed(2) : '0.00';
}

function buildIntakeSubmittedMessage({ form = {}, clientId, projectId, payment, submittedAt }) {
  return [
    '🔔 GeoGi 新品牌资料提交',
    line('品牌', form.brandName),
    line('企业', form.companyName),
    line('行业', [form.industry, form.segment].filter(Boolean).join(' / ')),
    line('联系人', form.contactName),
    line('联系方式', form.contactMethod),
    line('客户编号', clientId),
    line('项目编号', projectId),
    line('订单号', payment && payment.outTradeNo),
    '产品：GeoGi 品牌 GEO 诊断报告',
    line('渠道', payment && payment.channelName),
    line('兑换码', payment && payment.promotionCode),
    `订单金额：¥${amountYuanFromFen(payment && payment.amountTotal !== undefined ? payment.amountTotal : 19900)}`,
    `当前状态：${payment && payment.status === 'free' ? '已兑换 / 免支付' : '待付款'}`,
    line('提交时间', submittedAt),
    line('附件数量', Array.isArray(form.uploads) ? form.uploads.length : 0),
    payment && payment.status === 'free' ? '下一步：可直接进入 GEO 诊断' : '下一步：等待客户完成支付',
    `后台：${opsUrl()}`
  ].filter(Boolean).join('\n');
}

function buildPaymentPaidMessage(order = {}) {
  return [
    '💰 GeoGi 诊断订单支付成功',
    line('品牌', order.brandName),
    line('客户编号', order.clientId),
    line('项目编号', order.projectId),
    line('商户订单号', order.outTradeNo),
    line('微信支付单号', order.transactionId),
    line('渠道', order.channelName),
    line('兑换码', order.promotionCode),
    `实收：¥${amountYuanFromFen(order.amountTotal)} ${order.currency || 'CNY'}`,
    line('支付时间', order.paidAt),
    '当前状态：已付款 / 待 OS 处理',
    '下一步：补充品牌资料并开始 GEO 诊断',
    `后台：${opsUrl()}`
  ].filter(Boolean).join('\n');
}

function buildRefundRequestedMessage({ order = {}, refund = {} }) {
  return [
    '↩️ GeoGi 退款已发起',
    line('品牌', order.brandName),
    line('客户编号', order.clientId),
    line('项目编号', order.projectId),
    line('商户订单号', order.outTradeNo),
    line('商户退款单号', refund.outRefundNo),
    `退款金额：¥${amountYuanFromFen(refund.amount)}`,
    line('退款原因', refund.reason),
    line('操作人', refund.operatorId),
    line('申请时间', refund.requestedAt),
    line('当前状态', refund.status),
    `后台：${opsUrl()}`
  ].filter(Boolean).join('\n');
}

function buildRefundResultMessage({ order = {}, refund = {} }) {
  const status = String(refund.status || '').toLowerCase();
  const statusText = status === 'success'
    ? (Number(order.refundedAmount || 0) >= Number(order.amountTotal || 0) ? '已全额退款' : '已部分退款')
    : (status === 'abnormal' ? '退款异常' : (status === 'closed' ? '退款关闭' : status));
  return [
    status === 'success' ? '✅ GeoGi 退款结果已确认' : '⚠️ GeoGi 退款状态更新',
    line('品牌', order.brandName),
    line('客户编号', order.clientId),
    line('项目编号', order.projectId),
    line('商户订单号', order.outTradeNo),
    line('商户退款单号', refund.outRefundNo),
    line('微信退款单号', refund.providerRefundId),
    `退款金额：¥${amountYuanFromFen(refund.amount)}`,
    line('结果', statusText),
    line('成功时间', refund.successAt),
    line('退款原因', refund.reason),
    `累计退款：¥${amountYuanFromFen(order.refundedAmount)}`,
    `剩余可退：¥${amountYuanFromFen(order.refundableAmount)}`,
    `后台：${opsUrl()}`
  ].filter(Boolean).join('\n');
}

function notifyIntakeSubmitted(payload) {
  notifyDetached('intake_submitted', buildIntakeSubmittedMessage(payload));
}

function notifyPaymentPaid(order) {
  notifyDetached('payment_succeeded', buildPaymentPaidMessage(order));
}

function notifyRefundRequested(payload) {
  notifyDetached('refund_requested', buildRefundRequestedMessage(payload));
}

function notifyRefundResult(payload) {
  notifyDetached('refund_result', buildRefundResultMessage(payload));
}

module.exports = {
  notificationConfigured,
  deliverText,
  safeNotify,
  notifyDetached,
  buildIntakeSubmittedMessage,
  buildPaymentPaidMessage,
  buildRefundRequestedMessage,
  buildRefundResultMessage,
  notifyIntakeSubmitted,
  notifyPaymentPaid,
  notifyRefundRequested,
  notifyRefundResult
};
