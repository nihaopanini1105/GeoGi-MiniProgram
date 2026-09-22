const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const {
  PRODUCT_NAME,
  PRODUCT_PRICE_FEN,
  CURRENCY,
  updatePaymentOrder,
  findPaymentByOutTradeNo
} = require('./payment-store');

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
  if (order.status === 'refunded') throw new WechatPayError('PAYMENT_ORDER_ALREADY_REFUNDED');
  if (order.status === 'paid' || order.status === 'partially_refunded') {
    return { alreadyPaid: true, order };
  }
  const config = requireConfig();
  const openid = await resolveOpenId(loginCode);
  const body = {
    appid: config.appid,
    mchid: config.mchid,
    description: PRODUCT_NAME,
    out_trade_no: order.outTradeNo,
    notify_url: config.notifyUrl,
    amount: {
      total: PRODUCT_PRICE_FEN,
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
  const nextStatus = mapTradeState(result.trade_state);
  return updatePaymentOrder(order.outTradeNo, {
    status: nextStatus,
    providerTradeState: String(result.trade_state || ''),
    transactionId: String(result.transaction_id || order.transactionId || ''),
    paidAt: nextStatus === 'paid'
      ? String(result.success_time || order.paidAt || new Date().toISOString())
      : order.paidAt,
    closedAt: nextStatus === 'closed' ? new Date().toISOString() : order.closedAt
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
      total: PRODUCT_PRICE_FEN,
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
    ? (refundedAmount >= PRODUCT_PRICE_FEN ? 'refunded' : 'partially_refunded')
    : 'refund_processing';
  return updatePaymentOrder(order.outTradeNo, {
    refunds,
    refundedAmount,
    refundableAmount: Math.max(0, PRODUCT_PRICE_FEN - refundedAmount),
    status
  });
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
  const outTradeNo = String(resource.out_trade_no || '');
  const order = await findPaymentByOutTradeNo(outTradeNo);
  if (!order) throw new WechatPayError('PAYMENT_ORDER_NOT_FOUND');
  if (Number(resource.amount && resource.amount.total) !== PRODUCT_PRICE_FEN) {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_AMOUNT_MISMATCH');
  }
  return updatePaymentOrder(outTradeNo, {
    status: mapTradeState(resource.trade_state),
    providerTradeState: String(resource.trade_state || ''),
    transactionId: String(resource.transaction_id || ''),
    paidAt: String(resource.success_time || order.paidAt || new Date().toISOString())
  });
}

async function handleRefundNotification(headers, rawBody) {
  if (!verifyWechatSignature(headers, rawBody)) {
    throw new WechatPayError('WECHAT_PAY_NOTIFY_SIGNATURE_INVALID');
  }
  const envelope = JSON.parse(rawBody);
  const resource = decryptNotificationResource(envelope.resource);
  const outTradeNo = String(resource.out_trade_no || '');
  const order = await findPaymentByOutTradeNo(outTradeNo);
  if (!order) throw new WechatPayError('PAYMENT_ORDER_NOT_FOUND');

  const outRefundNo = String(resource.out_refund_no || '');
  const refundStatus = String(resource.refund_status || '').toUpperCase();
  const successAmount = refundStatus === 'SUCCESS'
    ? Number(resource.amount && resource.amount.refund || 0)
    : 0;
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
  const status = refundedAmount >= PRODUCT_PRICE_FEN
    ? 'refunded'
    : (refundedAmount > 0 ? 'partially_refunded' : (refundStatus === 'ABNORMAL' || refundStatus === 'CLOSED' ? 'paid' : 'refund_processing'));
  return updatePaymentOrder(outTradeNo, {
    refunds,
    refundedAmount,
    refundableAmount: Math.max(0, PRODUCT_PRICE_FEN - refundedAmount),
    status
  });
}

module.exports = {
  WechatPayError,
  configStatus,
  createJsapiPayment,
  syncPaymentOrder,
  requestRefund,
  verifyWechatSignature,
  decryptNotificationResource,
  handlePaymentNotification,
  handleRefundNotification
};
