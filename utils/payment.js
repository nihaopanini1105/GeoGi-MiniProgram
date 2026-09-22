const { get, post } = require('./request');

const PRODUCT = Object.freeze({
  code: 'GEOGI_DIAGNOSTIC_REPORT_199',
  name: 'GeoGi 品牌 GEO 诊断报告',
  amountFen: 19900,
  amountYuan: '199.00'
});

function requestPayment(params) {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...params,
      success: resolve,
      fail: reject
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPaymentStatus({ clientId, projectId }) {
  const result = await get('/api/payments/status', { clientId, projectId });
  if (!result || !result.ok) throw new Error(result && result.userMessage ? result.userMessage : '支付状态读取失败');
  return result.payment || {};
}

async function waitForPaid({ clientId, projectId, attempts = 8, delayMs = 900 }) {
  let last = {};
  for (let index = 0; index < attempts; index += 1) {
    last = await getPaymentStatus({ clientId, projectId });
    if (last.paymentStatus === 'PAID') return last;
    if (['REFUNDED', 'REFUND_PROCESSING'].includes(last.paymentStatus)) return last;
    if (index < attempts - 1) await sleep(delayMs);
  }
  return last;
}

async function payDiagnosticReport({ clientId, projectId }) {
  const created = await post('/api/payments/create', { clientId, projectId });
  if (!created || !created.ok) {
    throw new Error(created && created.userMessage ? created.userMessage : '支付订单创建失败');
  }
  if (created.alreadyPaid) {
    return { paid: true, payment: created.payment || {} };
  }
  if (!created.paymentParams) throw new Error('支付参数生成失败');

  try {
    await requestPayment(created.paymentParams);
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (/cancel/i.test(message)) {
      return {
        paid: false,
        cancelled: true,
        payment: await getPaymentStatus({ clientId, projectId }).catch(() => ({}))
      };
    }
    throw new Error('微信支付未完成，请稍后重试');
  }

  const payment = await waitForPaid({ clientId, projectId });
  return {
    paid: payment.paymentStatus === 'PAID',
    cancelled: false,
    payment
  };
}

module.exports = {
  PRODUCT,
  getPaymentStatus,
  payDiagnosticReport,
  waitForPaid
};
