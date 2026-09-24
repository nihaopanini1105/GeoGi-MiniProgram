const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const {
  PRODUCT_NAME,
  PRODUCT_PRICE_FEN,
  CURRENCY,
  updatePaymentOrder,
  findPaymentByOutTradeNo,
  isPaymentOrderExpired
} = require('./payment-store');
const {
  notifyPaymentPaid,
  notifyRefundRequested,
  notifyRefundResult
} = require('./ops-notifications');

class WechatPayError extends Error {
  constructor(code, detail = '') {
    super(detail ? code + ': ' + detail : code);
    this.code = code;
    this.detail = detail;
  }
}

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function merchantConfig() {
  return {
    appid: env('WECHAT_APP_ID') || env('WECHAT_MINI_PROGRAM_APPID'),
    appSecret: env('WECHAT_APP_SECRET') || env('WECHAT_MINI_PROGRAM_SECRET'),
    mchid: env('WECHATPAY_MCH_ID'),
    merchantSerialNo: env('WECHATPAY_MERCHANT_SERIAL_NO'),
    privateKeyPath: env('WECHATPAY_PRIVATE_KEY_PATH'),
    apiV3Key: env('WECHATPAY_API_V3_KEY'),
    notifyUrl: env('WECHATPAY_NOTIFY_URL'),
    refundNotifyUrl: env('WECHATPAY_REFUND_NOTIFY_URL') || env('WECHATPAY_NOTIFY_URL'),
    platformPublicKeyPath: env('WECHATPAY_PLATFORM_PUBLIC_KEY_PATH'),
    platformSerialNo: env('WECHATPAY_PLATFORM_SERIAL_NO')
  };
}

function configStatus() {
  const config = merchantConfig();
  const required = [
    'appid', 'appSecret', 'mchid', 'merchantSerialNo', 'privateKeyPath',
    'apiV3Key', 'notifyUrl', 'refundNotifyUrl', 'platformPublicKeyPath', 'platformSerialNo'
  ];
  const missing = required.filter((key) => !config[key]);
  return { configured: missing.length === 0, missing, config };
}

function requireConfig() {
  const status = configStatus();
  if (!status.configured) throw new WechatPayError('WECHAT_PAY_NOT_CONFIGURED', status.missing.join(','));
  if (Buffer.byteLength(status.config.apiV3Key, 'utf8') !== 32) {
    throw new WechatPayError('WECHAT_PAY_API_V3_KEY_INVALID');
  }
  return status.config;
}

function readPrivateKey(config) {
  try {
    return fs.readFileSync(config.privateKeyPath, 'utf8');
  } catch (error) {
    throw new WechatPayError('WECHAT_PAY_PRIVATE_KEY_UNREADABLE');
  }
}

function readPlatformPublicKey(config) {
  try {
    return fs.readFileSync(config.platformPublicKeyPath, 'utf8');
  } catch (error) {
    throw new WechatPayError('WECHAT_PAY_PLATFORM_KEY_UNREADABLE');
  }
}

function nonce() {
  return crypto.randomBytes(16).toString('hex');
}

function signRsaSha256(message, privateKey) {
  return crypto.sign('RSA-SHA256', Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

function authorizationHeader({ method, pathWithQuery, bodyText, config }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = nonce();
  const message = method + '\n' + pathWithQuery + '\n' + timestamp + '\n' + nonceStr + '\n' + bodyText + '\n';
  const signature = signRsaSha256(message, readPrivateKey(config));
  return 'WECHATPAY2-SHA256-RSA2048 ' +
    'mchid="' + config.mchid + '",' +
    'nonce_str="' + nonceStr + '",' +
    'timestamp="' + timestamp + '",' +
    'serial_no="' + config.merchantSerialNo + '",' +
    'signature="' + signature + '"';
}

function requestJson({ method, hostname, path: requestPath, body, headers = {}, timeout = 15000 }) {
  const bodyText = body === undefined || body === null ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request({
      method,
      hostname,
      path: requestPath,
      headers: {
        Accept: 'application/json',
        ...(bodyText ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(bodyText)
        } : {}),
        ...headers
      },
      timeout
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (error) {
          reject(new WechatPayError('WECHAT_PAY_INVALID_JSON', raw.slice(0, 500)));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new WechatPayError(
            'WECHAT_PAY_HTTP_' + response.statusCode,
            parsed.message || parsed.code || raw.slice(0, 500)
          ));
          return;
        }
        resolve(parsed);
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new WechatPayError('WECHAT_PAY_TIMEOUT')));
    if (bodyText) request.write(bodyText);
    request.end();
  });
}

async function wechatPayRequest(method, requestPath, body) {
  const config = requireConfig();
  const bodyText = body === undefined || body === null ? '' : JSON.stringify(body);
  const authorization = authorizationHeader({
    method,
    pathWithQuery: requestPath,
    bodyText,
    config
  });
  return requestJson({
    method,
    hostname: 'api.mch.weixin.qq.com',
    path: requestPath,
    body,
    headers: {
      Authorization: authorization,
      'User-Agent': 'GeoGi-MiniProgram/1.0'
    }
  });
}

async function resolveOpenId(loginCode) {
  const config = requireConfig();
  const code = String(loginCode || '').trim();
  if (!code) throw new WechatPayError('WECHAT_LOGIN_CODE_REQUIRED');
  const result = await requestJson({
    method: 'GET',
    hostname: 'api.weixin.qq.com',
    path: '/sns/jscode2session?appid=' + encodeURIComponent(config.appid) +
      '&secret=' + encodeURIComponent(config.appSecret) +
      '&js_code=' + encodeURIComponent(code) +
      '&grant_type=authorization_code'
  });
  if (!result.openid) {
    throw new WechatPayError('WECHAT_OPENID_RESOLUTION_FAILED', result.errmsg || String(result.errcode || ''));
  }
  return String(result.openid);
}

function buildClientPayParams(prepayId) {
  const config = requireConfig();
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = nonce();
  const packageValue = 'prepay_id=' + String(prepayId || '');
  const message = config.appid + '\n' + timeStamp + '\n' + nonceStr + '\n' + packageValue + '\n';
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign: signRsaSha256(message, readPrivateKey(config))
  };
}

async function createJsapiPayment(order, loginCode) {
  if (!order) throw new WechatPayError('PAYMENT_ORDER_REQUIRED');
  if (isPaymentOrderExpired(order)) throw new WechatPayError('PAYMENT_ORDER_EXPIRED');
  if (order.status === 'refunded') throw new WechatPayError('PAYMENT_ORDER_ALREADY_REFUNDED');
  if (order.status === 'free') {
    return { alreadyPaid: true, order };
  }
  if (order.status === 'paid' || order.status === 'partially_refunded') {
    return { alreadyPaid: true, order };
  }
  if (order.status === 'paying' && order.prepayId) {
    return {
      alreadyPaid: false,
      order,
      payParams: buildClientPayParams(order.prepayId)
    };
  }
  if (order.status === 'closed') {
    throw new WechatPayError('PAYMENT_ORDER_CLOSED');
  }
  const config = requireConfig();
  const openid = await resolveOpenId(loginCode);
  const body = {
    appid: config.appid,
    mchid: config.mchid,
    description: PRODUCT_NAME,
    out_trade_no: order.outTradeNo,
    notify_url: config.notifyUrl,
    time_expire: order.expiresAt,
    amount: {
      total: Number(order.amountTotal),
      currency: CURRENCY
    },
    payer: { openid },
    attach: JSON.stringify({
      product: 'diagnostic_report_199',
      projectId: order.projectId,
      clientId: order.clientId
    })
  };
  const result = await wechatPayRequest('POST', '/v3/pay/transactions/jsapi', body);
  if (!result.prepay_id) throw new WechatPayError('WECHAT_PAY_PREPAY_ID_MISSING');
  const updated = await updatePaymentOrder(order.outTradeNo, {
    status: 'paying',
    prepayId: result.prepay_id,
    payerOpenidHash: crypto.createHash('sha256').update(openid).digest('hex')
  });
  return {
    alreadyPaid: false,
    order: updated,
    payParams: buildClientPayParams(result.prepay_id)
  };
}

async function closePaymentOrder(order, reason = 'customer_cancelled') {
  if (!order) throw new WechatPayError('PAYMENT_ORDER_REQUIRED');
  if (['paid', 'free', 'refund_processing', 'partially_refunded', 'refunded'].includes(order.status)) {
    throw new WechatPayError('PAYMENT_ORDER_NOT_CANCELLABLE');
  }
  if (order.status === 'closed') return order;

  if (order.prepayId || order.status === 'paying') {
    const config = requireConfig();
    await wechatPayRequest(
      'POST',
      '/v3/pay/transactions/out-trade-no/' + encodeURIComponent(order.outTradeNo) + '/close',
      { mchid: config.mchid }
    );
  }

  return updatePaymentOrder(order.outTradeNo, {
    status: 'closed',
    providerTradeState: 'CLOSED',
    closedAt: new Date().toISOString(),
    closedReason: String(reason || 'customer_cancelled').slice(0, 60)
  });
}

function mapTradeState(tradeState) {
  const state = String(tradeState || '').toUpperCase();
  if (state === 'SUCCESS') return 'paid';
  if (state === 'CLOSED' || state === 'REVOKED') return 'closed';
  if (state === 'PAYERROR') return 'payment_failed';
  return 'paying';
}

async function syncPaymentOrder(order) {
  if (!order) throw new WechatPayError('PAYMENT_ORDER_REQUIRED');
  const config = requireConfig();
  const result = await wechatPayRequest(
    'GET',
    '/v3/pay/transactions/out-trade-no/' + encodeURIComponent(order.outTradeNo) +
      '?mchid=' + encodeURIComponent(config.mchid)
  );
  if (String(result.mchid || '') !== config.mchid || String(result.appid || '') !== config.appid) {
    throw new WechatPayError('WECHAT_PAY_QUERY_MERCHANT_SCOPE_MISMATCH');
  }
  if (
    Number(result.amount && result.amount.total) !== Number(order.amountTotal)
    || String(result.amount && result.amount.currency || CURRENCY) !== CURRENCY
  ) {
    throw new WechatPayError('WECHAT_PAY_QUERY_AMOUNT_MISMATCH');
  }
  const nextStatus = mapTradeState(result.trade_state);
  return updatePaymentOrder(order.outTradeNo, {
    status: nextStatus,
    providerTradeState: String(result.trade_state || ''),
    transactionId: String(result.transaction_id || order.transactionId || ''),
    paidAt: nextStatus === 'paid'
      ? String(result.success_time || order.paidAt || new Date().toISOString())
      : order.paidAt,
    refundableAmount: nextStatus === 'paid'
      ? Math.max(Number(order.refundableAmount || 0), Number(order.amountTotal || 0) - Number(order.refundedAmount || 0))
      : order.refundableAmount,
    closedAt: nextStatus === 'closed' ? new Date().toISOString() : order.closedAt,
    closedReason: nextStatus === 'closed'
      ? (order.closedReason || (isPaymentOrderExpired(order) ? 'expired' : 'provider_closed'))
      : order.closedReason
  });
}

function makeRefundNo(outTradeNo) {
  return ('R' + String(outTradeNo || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) +
    Date.now().toString(36).toUpperCase()).slice(0, 32);
}

async function requestRefund({ order, amount, reason, operatorId }) {
  if (!order) throw new WechatPayError('PAYMENT_ORDER_REQUIRED');
  if (!['paid', 'partially_refunded'].includes(order.status)) {
    throw new WechatPayError('PAYMENT_NOT_REFUNDABLE');
  }
  const refundAmount = Number(amount);
  if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
    throw new WechatPayError('REFUND_AMOUNT_INVALID');
  }
  const refundableAmount = Number(order.refundableAmount || 0);
  if (refundAmount > refundableAmount) throw new WechatPayError('REFUND_AMOUNT_EXCEEDS_REFUNDABLE');

  const config = requireConfig();
  const outRefundNo = makeRefundNo(order.outTradeNo);
  const body = {
    out_trade_no: order.outTradeNo,
    out_refund_no: outRefundNo,
    reason: String(reason || '客户退款').trim().slice(0, 80),
    notify_url: config.refundNotifyUrl,
    amount: {
      refund: refundAmount,
      total: Number(order.amountTotal),
      currency: CURRENCY
    }
  };
  const result = await wechatPayRequest('POST', '/v3/refund/domestic/refunds', body);
  const requestedAt = new Date().toISOString();
  const refund = {
    refundId: 'refund_' + crypto.randomUUID(),
    outRefundNo,
    providerRefundId: String(result.refund_id || ''),
    amount: refundAmount,
    status: String(result.status || 'PROCESSING').toLowerCase(),
    reason: body.reason,
    requestedAt,
    successAt: String(result.success_time || ''),
    operatorId: String(operatorId || '')
  };
  const refunds = [...(order.refunds || []), refund];
  const refundedAmount = Number(order.refundedAmount || 0) +
    (String(result.status || '').toUpperCase() === 'SUCCESS' ? refundAmount : 0);
  const status = String(result.status || '').toUpperCase() === 'SUCCESS'
    ? (refundedAmount >= Number(order.amountTotal || 0) ? 'refunded' : 'partially_refunded')
    : 'refund_processing';
  const updated = await updatePaymentOrder(order.outTradeNo, {
    refunds,
    refundedAmount,
    refundableAmount: Math.max(0, Number(order.amountTotal || 0) - refundedAmount),
    status
  });
  notifyRefundRequested({ order: updated, refund });
  if (String(refund.status || '').toLowerCase() === 'success') {
    notifyRefundResult({ order: updated, refund });
  }
  return updated;
}

function verifyWechatSignature(headers, rawBody) {
  const config = requireConfig();
  const timestamp = String(headers['wechatpay-timestamp'] || '');
  const nonceStr = String(headers['wechatpay-nonce'] || '');
  const serial = String(headers['wechatpay-serial'] || '');
  const signature = String(headers['wechatpay-signature'] || '');
  if (!timestamp || !nonceStr || !serial || !signature) return false;
  if (serial !== config.platformSerialNo) return false;
  const message = timestamp + '\n' + nonceStr + '\n' + rawBody + '\n';
  return crypto.verify(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    readPlatformPublicKey(config),
    Buffer.from(signature, 'base64')
  );
}

function decryptNotificationResource(resource) {
  const config = requireConfig();
  if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_ALGORITHM_INVALID');
  }
  const key = Buffer.from(config.apiV3Key, 'utf8');
  const ciphertext = Buffer.from(String(resource.ciphertext || ''), 'base64');
  if (ciphertext.length < 17) throw new WechatPayError('WECHAT_PAY_NOTIFY_CIPHERTEXT_INVALID');
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(resource.nonce || ''), 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(String(resource.associated_data || ''), 'utf8'));
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

async function handlePaymentNotification(headers, rawBody) {
  if (!verifyWechatSignature(headers, rawBody)) {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_SIGNATURE_INVALID');
  }
  const envelope = JSON.parse(rawBody);
  const resource = decryptNotificationResource(envelope.resource);
  const config = requireConfig();
  if (String(resource.mchid || '') !== config.mchid || String(resource.appid || '') !== config.appid) {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_MERCHANT_SCOPE_MISMATCH');
  }
  if (String(resource.amount && resource.amount.currency || CURRENCY) !== CURRENCY) {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_CURRENCY_MISMATCH');
  }
  const outTradeNo = String(resource.out_trade_no || '');
  const order = await findPaymentByOutTradeNo(outTradeNo);
  if (!order) throw new WechatPayError('PAYMENT_ORDER_NOT_FOUND');
  if (Number(resource.amount && resource.amount.total) !== Number(order.amountTotal)) {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_AMOUNT_MISMATCH');
  }
  const nextStatus = mapTradeState(resource.trade_state);
  const wasPaid = Boolean(order.paidAt || order.transactionId)
    || ['paid', 'refund_processing', 'partially_refunded', 'refunded'].includes(order.status);
  const updated = await updatePaymentOrder(outTradeNo, {
    status: nextStatus,
    providerTradeState: String(resource.trade_state || ''),
    transactionId: String(resource.transaction_id || order.transactionId || ''),
    paidAt: nextStatus === 'paid'
      ? String(resource.success_time || order.paidAt || new Date().toISOString())
      : order.paidAt,
    refundableAmount: nextStatus === 'paid'
      ? Math.max(Number(order.refundableAmount || 0), Number(order.amountTotal || 0) - Number(order.refundedAmount || 0))
      : order.refundableAmount
  });
  if (nextStatus === 'paid' && !wasPaid) {
    notifyPaymentPaid(updated);
  }
  return updated;
}

async function handleRefundNotification(headers, rawBody) {
  if (!verifyWechatSignature(headers, rawBody)) {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_SIGNATURE_INVALID');
  }
  const envelope = JSON.parse(rawBody);
  const resource = decryptNotificationResource(envelope.resource);
  if (String(resource.amount && resource.amount.currency || CURRENCY) !== CURRENCY) {
    throw new WechatPayError('WECHAT_REFUND_NOTIFY_CURRENCY_MISMATCH');
  }
  const outTradeNo = String(resource.out_trade_no || '');
  const order = await findPaymentByOutTradeNo(outTradeNo);
  if (!order) throw new WechatPayError('PAYMENT_ORDER_NOT_FOUND');
  if (Number(resource.amount && resource.amount.total || 0) !== Number(order.amountTotal || 0)) {
    throw new WechatPayError('WECHAT_REFUND_NOTIFY_TOTAL_MISMATCH');
  }

  const outRefundNo = String(resource.out_refund_no || '');
  if (!(order.refunds || []).some((refund) => String(refund.outRefundNo || '') === outRefundNo)) {
    throw new WechatPayError('WECHAT_REFUND_NOTIFY_ORDER_MISMATCH');
  }
  const refundStatus = String(resource.refund_status || '').toUpperCase();
  const previousRefund = (order.refunds || []).find(
    (refund) => String(refund.outRefundNo || '') === outRefundNo
  ) || null;
  const refunds = (order.refunds || []).map((refund) => (
    refund.outRefundNo === outRefundNo
      ? {
          ...refund,
          providerRefundId: String(resource.refund_id || refund.providerRefundId || ''),
          status: refundStatus.toLowerCase(),
          successAt: refundStatus === 'SUCCESS'
            ? String(resource.success_time || new Date().toISOString())
            : refund.successAt
        }
      : refund
  ));
  const refundedAmount = refunds
    .filter((refund) => String(refund.status).toLowerCase() === 'success')
    .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
  const status = refundedAmount >= Number(order.amountTotal || 0)
    ? 'refunded'
    : (refundedAmount > 0 ? 'partially_refunded' : (refundStatus === 'ABNORMAL' || refundStatus === 'CLOSED' ? 'paid' : 'refund_processing'));
  const updated = await updatePaymentOrder(outTradeNo, {
    refunds,
    refundedAmount,
    refundableAmount: Math.max(0, Number(order.amountTotal || 0) - refundedAmount),
    status
  });
  const updatedRefund = refunds.find(
    (refund) => String(refund.outRefundNo || '') === outRefundNo
  ) || null;
  const previousStatus = String(previousRefund && previousRefund.status || '').toLowerCase();
  const currentStatus = String(updatedRefund && updatedRefund.status || '').toLowerCase();
  if (updatedRefund && currentStatus && currentStatus !== previousStatus
      && ['success', 'abnormal', 'closed'].includes(currentStatus)) {
    notifyRefundResult({ order: updated, refund: updatedRefund });
  }
  return updated;
}

module.exports = {
  WechatPayError,
  configStatus,
  createJsapiPayment,
  closePaymentOrder,
  syncPaymentOrder,
  requestRefund,
  verifyWechatSignature,
  decryptNotificationResource,
  handlePaymentNotification,
  handleRefundNotification
};
