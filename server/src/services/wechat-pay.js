const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const {
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord
} = require('./feishu');

const DIAGNOSTIC_PRODUCT_CODE = 'GEOGI_DIAGNOSTIC_REPORT_199';
const DIAGNOSTIC_PRODUCT_NAME = 'GeoGi 品牌 GEO 诊断报告';
const DIAGNOSTIC_AMOUNT_FEN = 19900;
const DIAGNOSTIC_AMOUNT_YUAN = '199.00';

class WechatPayError extends Error {
  constructor(code, message = '') {
    super(message || code);
    this.code = code;
  }
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

function appId() {
  return clean(process.env.WECHAT_APP_ID || process.env.WECHAT_MINI_PROGRAM_APPID, 64);
}

function merchantId() {
  return clean(process.env.WECHAT_PAY_MCH_ID, 64);
}

function apiV3Key() {
  return String(process.env.WECHAT_PAY_API_V3_KEY || '');
}

function privateKeyPath() {
  return clean(process.env.WECHAT_PAY_PRIVATE_KEY_PATH, 2000);
}

function platformCertPath() {
  return clean(process.env.WECHAT_PAY_PLATFORM_CERT_PATH, 2000);
}

function merchantSerial() {
  return clean(process.env.WECHAT_PAY_CERT_SERIAL_NO, 128);
}

function platformSerial() {
  return clean(process.env.WECHAT_PAY_PLATFORM_CERT_SERIAL_NO, 128).toUpperCase();
}

function paymentNotifyUrl() {
  const explicit = clean(process.env.WECHAT_PAY_NOTIFY_URL, 2000);
  if (explicit) return explicit;
  const base = clean(process.env.PUBLIC_BASE_URL, 2000).replace(/\/+$/, '');
  return base ? `${base}/api/payments/wechat/notify` : '';
}

function refundNotifyUrl() {
  const explicit = clean(process.env.WECHAT_PAY_REFUND_NOTIFY_URL, 2000);
  if (explicit) return explicit;
  const base = clean(process.env.PUBLIC_BASE_URL, 2000).replace(/\/+$/, '');
  return base ? `${base}/api/payments/wechat/refund-notify` : '';
}

function fileExists(path) {
  try {
    return Boolean(path && fs.statSync(path).isFile());
  } catch (_error) {
    return false;
  }
}

function paymentConfiguration() {
  const missing = [];
  if (!appId()) missing.push('WECHAT_APP_ID');
  if (!merchantId()) missing.push('WECHAT_PAY_MCH_ID');
  if (!merchantSerial()) missing.push('WECHAT_PAY_CERT_SERIAL_NO');
  if (!privateKeyPath() || !fileExists(privateKeyPath())) missing.push('WECHAT_PAY_PRIVATE_KEY_PATH');
  if (!platformCertPath() || !fileExists(platformCertPath())) missing.push('WECHAT_PAY_PLATFORM_CERT_PATH');
  if (!platformSerial()) missing.push('WECHAT_PAY_PLATFORM_CERT_SERIAL_NO');
  if (Buffer.byteLength(apiV3Key(), 'utf8') !== 32) missing.push('WECHAT_PAY_API_V3_KEY');
  if (!/^https:\/\//i.test(paymentNotifyUrl())) missing.push('WECHAT_PAY_NOTIFY_URL/PUBLIC_BASE_URL');
  if (!/^https:\/\//i.test(refundNotifyUrl())) missing.push('WECHAT_PAY_REFUND_NOTIFY_URL/PUBLIC_BASE_URL');
  return {
    configured: missing.length === 0,
    missing
  };
}

function requirePaymentConfigured() {
  const configuration = paymentConfiguration();
  if (!configuration.configured) {
    throw new WechatPayError('WECHAT_PAY_NOT_CONFIGURED', configuration.missing.join(','));
  }
}

function privateKeyPem() {
  return fs.readFileSync(privateKeyPath(), 'utf8');
}

function platformCertPem() {
  return fs.readFileSync(platformCertPath(), 'utf8');
}

function merchantSign(message) {
  return crypto
    .sign('RSA-SHA256', Buffer.from(message, 'utf8'), privateKeyPem())
    .toString('base64');
}

function buildAuthorization({ method, path, body = '' }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = merchantSign(message);
  return {
    authorization: [
      'WECHATPAY2-SHA256-RSA2048',
      `mchid="${merchantId()}"`,
      `nonce_str="${nonce}"`,
      `signature="${signature}"`,
      `timestamp="${timestamp}"`,
      `serial_no="${merchantSerial()}"`
    ].join(' '),
    timestamp,
    nonce,
    signature
  };
}

function headerValue(headers, name) {
  if (!headers) return '';
  const lower = String(name).toLowerCase();
  return String(headers[lower] || headers[name] || '').trim();
}

function verifyWechatSignature({ headers, rawBody }) {
  const timestamp = headerValue(headers, 'wechatpay-timestamp');
  const nonce = headerValue(headers, 'wechatpay-nonce');
  const signature = headerValue(headers, 'wechatpay-signature');
  const serial = headerValue(headers, 'wechatpay-serial').toUpperCase();
  if (!timestamp || !nonce || !signature || !serial) {
    throw new WechatPayError('WECHAT_PAY_SIGNATURE_HEADERS_MISSING');
  }
  if (platformSerial() && serial !== platformSerial()) {
    throw new WechatPayError('WECHAT_PAY_PLATFORM_CERT_SERIAL_MISMATCH');
  }
  const message = `${timestamp}\n${nonce}\n${String(rawBody || '')}\n`;
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    platformCertPem(),
    Buffer.from(signature, 'base64')
  );
  if (!valid) throw new WechatPayError('WECHAT_PAY_SIGNATURE_INVALID');
  return true;
}

function requestWechatJson({ method, path, payload }) {
  requirePaymentConfigured();
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const auth = buildAuthorization({ method, path, body });
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: 'api.mch.weixin.qq.com',
      path,
      headers: {
        Authorization: auth.authorization,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'GeoGi-MiniProgram/1.2',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      },
      timeout: 15000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          if (raw) verifyWechatSignature({ headers: res.headers, rawBody: raw });
          const parsed = raw ? JSON.parse(raw) : {};
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new WechatPayError(
              clean(parsed.code || `WECHAT_PAY_HTTP_${res.statusCode}`, 128),
              clean(parsed.message || parsed.detail || '微信支付请求失败', 1000)
            ));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new WechatPayError('WECHAT_PAY_REQUEST_TIMEOUT')));
    if (body) req.write(body);
    req.end();
  });
}

function decryptNotificationResource(resource) {
  requirePaymentConfigured();
  if (!resource || !resource.ciphertext || !resource.nonce) {
    throw new WechatPayError('WECHAT_PAY_NOTIFICATION_RESOURCE_INVALID');
  }
  const key = Buffer.from(apiV3Key(), 'utf8');
  const encrypted = Buffer.from(String(resource.ciphertext), 'base64');
  if (encrypted.length <= 16) throw new WechatPayError('WECHAT_PAY_NOTIFICATION_CIPHERTEXT_INVALID');
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(resource.nonce), 'utf8'));
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(String(resource.associated_data), 'utf8'));
  }
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

function buildClientPayParams(prepayId) {
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageValue = `prepay_id=${clean(prepayId, 256)}`;
  if (!prepayId) throw new WechatPayError('WECHAT_PAY_PREPAY_ID_REQUIRED');
  const message = `${appId()}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign: merchantSign(message)
  };
}

async function loadLeadAndProjectRecords() {
  const tenantToken = await getTenantAccessToken();
  const [leads, projects] = await Promise.all([
    listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      pageSize: 100
    }),
    process.env.FEISHU_PROJECTS_TABLE_ID
      ? listBitableRecords({
        tenantToken,
        appToken: process.env.FEISHU_BASE_APP_TOKEN,
        tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
        pageSize: 100
      })
      : Promise.resolve([])
  ]);
  return { tenantToken, leads, projects };
}

function findByProjectId(records, projectId) {
  return records.find((record) => text(record.fields && record.fields.项目编号) === projectId) || null;
}

function findByOutTradeNo(records, outTradeNo) {
  return records.find((record) => text(record.fields && record.fields.支付商户订单号) === outTradeNo) || null;
}

function findByRefundNo(records, refundNo) {
  return records.find((record) => text(record.fields && record.fields.退款单号) === refundNo) || null;
}

function recordId(record) {
  return record && (record.record_id || record.recordId) || '';
}

function paymentStatusCode(fields) {
  const value = text(fields && fields.支付状态);
  if (value === '已支付') return 'PAID';
  if (value === '退款处理中') return 'REFUND_PROCESSING';
  if (value === '已退款') return 'REFUNDED';
  if (value === '支付失败') return 'FAILED';
  if (value === '待支付') return 'PENDING';
  return 'UNPAID';
}

function refundStatusCode(fields) {
  const value = text(fields && fields.退款状态);
  if (value === '退款成功') return 'SUCCESS';
  if (value === '退款处理中') return 'PROCESSING';
  if (value === '退款失败') return 'FAILED';
  return value ? value.toUpperCase() : 'NONE';
}

function paymentView({ lead, project }) {
  const fields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const paymentStatus = paymentStatusCode(fields);
  const projectStage = text(projectFields.当前阶段) || 'PAYMENT_PENDING';
  const paymentRequired = text(fields.支付要求) === 'true' || text(fields.诊断产品代码) === DIAGNOSTIC_PRODUCT_CODE;
  const amountFen = Number(text(fields.支付金额分) || text(fields.应付金额分) || (paymentRequired ? DIAGNOSTIC_AMOUNT_FEN : 0));
  return {
    clientId: text(fields.客户编号),
    projectId: text(fields.项目编号) || text(projectFields.项目编号),
    submissionId: text(fields.提交ID),
    brandName: text(fields.品牌名称) || text(projectFields.品牌名称),
    contactName: text(fields.联系人),
    contactMethod: text(fields.联系方式),
    submittedAt: text(fields.提交时间),
    projectStage,
    productCode: text(fields.诊断产品代码) || (paymentRequired ? DIAGNOSTIC_PRODUCT_CODE : ''),
    productName: text(fields.诊断产品) || (paymentRequired ? DIAGNOSTIC_PRODUCT_NAME : ''),
    paymentRequired,
    amountFen,
    amountYuan: amountFen ? (amountFen / 100).toFixed(2) : '',
    paymentStatus,
    paymentStatusLabel: {
      UNPAID: '未支付',
      PENDING: '待支付',
      PAID: '已支付',
      REFUND_PROCESSING: '退款处理中',
      REFUNDED: '已退款',
      FAILED: '支付失败'
    }[paymentStatus] || paymentStatus,
    outTradeNo: text(fields.支付商户订单号),
    transactionId: text(fields.微信支付单号),
    prepayId: text(fields.预支付ID),
    paymentCreatedAt: text(fields.支付创建时间),
    paidAt: text(fields.支付完成时间),
    paymentMethod: text(fields.支付方式) || (paymentRequired ? '微信支付' : ''),
    refundStatus: refundStatusCode(fields),
    refundNo: text(fields.退款单号),
    wechatRefundId: text(fields.微信退款单号),
    refundReason: text(fields.退款原因),
    refundAmountFen: Number(text(fields.退款金额分) || 0),
    refundRequestedAt: text(fields.退款申请时间),
    refundCompletedAt: text(fields.退款完成时间),
    refundRequestedBy: text(fields.退款操作人),
    refundable: paymentStatus === 'PAID' && ['', 'INTAKE', 'PAYMENT_PENDING'].includes(projectStage)
  };
}

function makeOutTradeNo(projectId) {
  const suffix = crypto.randomBytes(5).toString('hex').toUpperCase();
  const projectPart = clean(projectId, 18).replace(/[^A-Za-z0-9_-]/g, '').slice(-18);
  return `GGD${projectPart}${suffix}`.slice(0, 32);
}

function makeRefundNo(projectId) {
  const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
  const projectPart = clean(projectId, 20).replace(/[^A-Za-z0-9_-]/g, '').slice(-20);
  return `GGR${projectPart}${suffix}`.slice(0, 64);
}

async function updateLeadFields({ tenantToken, lead, fields }) {
  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    recordId: recordId(lead),
    fields
  });
}

async function updateProjectFields({ tenantToken, project, fields }) {
  if (!project || !process.env.FEISHU_PROJECTS_TABLE_ID) return;
  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
    recordId: recordId(project),
    fields
  });
}

async function createDiagnosticPayment({ clientId, projectId, openid }) {
  requirePaymentConfigured();
  const cleanClientId = clean(clientId, 160);
  const cleanProjectId = clean(projectId, 160);
  const cleanOpenid = clean(openid, 160);
  if (!cleanClientId || !cleanProjectId) throw new WechatPayError('PAYMENT_CLIENT_PROJECT_REQUIRED');
  if (!cleanOpenid) throw new WechatPayError('PAYMENT_OPENID_REQUIRED');

  const { tenantToken, leads, projects } = await loadLeadAndProjectRecords();
  const lead = findByProjectId(leads, cleanProjectId);
  const project = findByProjectId(projects, cleanProjectId);
  if (!lead || text(lead.fields && lead.fields.客户编号) !== cleanClientId) {
    throw new WechatPayError('PAYMENT_PROJECT_NOT_OWNED');
  }

  const current = paymentView({ lead, project });
  if (current.paymentStatus === 'PAID') {
    return { ok: true, alreadyPaid: true, payment: current };
  }
  if (['REFUND_PROCESSING', 'REFUNDED'].includes(current.paymentStatus)) {
    throw new WechatPayError('PAYMENT_PROJECT_REFUNDED', '该诊断已进入退款流程，请重新提交新的诊断申请');
  }
  const expectedAmount = Number(text(lead.fields && lead.fields.应付金额分) || DIAGNOSTIC_AMOUNT_FEN);
  if (expectedAmount !== DIAGNOSTIC_AMOUNT_FEN) {
    throw new WechatPayError('PAYMENT_AMOUNT_MISMATCH');
  }

  let outTradeNo = current.outTradeNo;
  let prepayId = current.prepayId;
  const now = new Date().toISOString();
  if (!outTradeNo || !prepayId) {
    outTradeNo = outTradeNo || makeOutTradeNo(cleanProjectId);
    const expire = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const provider = await requestWechatJson({
      method: 'POST',
      path: '/v3/pay/transactions/jsapi',
      payload: {
        appid: appId(),
        mchid: merchantId(),
        description: DIAGNOSTIC_PRODUCT_NAME,
        out_trade_no: outTradeNo,
        time_expire: expire,
        attach: JSON.stringify({ projectId: cleanProjectId }).slice(0, 128),
        notify_url: paymentNotifyUrl(),
        amount: { total: DIAGNOSTIC_AMOUNT_FEN, currency: 'CNY' },
        payer: { openid: cleanOpenid }
      }
    });
    prepayId = clean(provider.prepay_id, 256);
    if (!prepayId) throw new WechatPayError('WECHAT_PAY_PREPAY_ID_MISSING');
    await updateLeadFields({
      tenantToken,
      lead,
      fields: {
        支付状态: '待支付',
        支付金额: DIAGNOSTIC_AMOUNT_YUAN,
        支付金额分: String(DIAGNOSTIC_AMOUNT_FEN),
        支付商户订单号: outTradeNo,
        预支付ID: prepayId,
        支付创建时间: now,
        支付方式: '微信支付'
      }
    });
  }

  return {
    ok: true,
    alreadyPaid: false,
    amountFen: DIAGNOSTIC_AMOUNT_FEN,
    amountYuan: DIAGNOSTIC_AMOUNT_YUAN,
    productCode: DIAGNOSTIC_PRODUCT_CODE,
    productName: DIAGNOSTIC_PRODUCT_NAME,
    outTradeNo,
    paymentParams: buildClientPayParams(prepayId)
  };
}

async function getDiagnosticPaymentStatus({ clientId, projectId }) {
  const cleanClientId = clean(clientId, 160);
  const cleanProjectId = clean(projectId, 160);
  if (!cleanClientId || !cleanProjectId) throw new WechatPayError('PAYMENT_CLIENT_PROJECT_REQUIRED');
  const { leads, projects } = await loadLeadAndProjectRecords();
  const lead = findByProjectId(leads, cleanProjectId);
  const project = findByProjectId(projects, cleanProjectId);
  if (!lead || text(lead.fields && lead.fields.客户编号) !== cleanClientId) {
    throw new WechatPayError('PAYMENT_PROJECT_NOT_OWNED');
  }
  return { ok: true, payment: paymentView({ lead, project }) };
}

async function markPaymentSuccessful(transaction) {
  const outTradeNo = clean(transaction.out_trade_no, 64);
  if (!outTradeNo) throw new WechatPayError('PAYMENT_NOTIFICATION_ORDER_REQUIRED');
  if (clean(transaction.trade_state, 64) !== 'SUCCESS') {
    return { ok: true, ignored: true, reason: 'trade_state_not_success' };
  }
  if (clean(transaction.mchid, 64) !== merchantId() || clean(transaction.appid, 64) !== appId()) {
    throw new WechatPayError('PAYMENT_NOTIFICATION_MERCHANT_MISMATCH');
  }
  const total = Number(transaction.amount && transaction.amount.total);
  if (total !== DIAGNOSTIC_AMOUNT_FEN) throw new WechatPayError('PAYMENT_NOTIFICATION_AMOUNT_MISMATCH');

  const { tenantToken, leads, projects } = await loadLeadAndProjectRecords();
  const lead = findByOutTradeNo(leads, outTradeNo);
  if (!lead) throw new WechatPayError('PAYMENT_NOTIFICATION_ORDER_NOT_FOUND');
  const projectId = text(lead.fields && lead.fields.项目编号);
  const project = findByProjectId(projects, projectId);
  const current = paymentView({ lead, project });
  if (current.paymentStatus === 'PAID') return { ok: true, idempotent: true, payment: current };

  await updateLeadFields({
    tenantToken,
    lead,
    fields: {
      支付状态: '已支付',
      支付金额: DIAGNOSTIC_AMOUNT_YUAN,
      支付金额分: String(DIAGNOSTIC_AMOUNT_FEN),
      微信支付单号: clean(transaction.transaction_id, 128),
      支付完成时间: clean(transaction.success_time, 100) || new Date().toISOString(),
      当前状态: '已付款',
      下一步动作: '等待 GeoGi 开始 199 元品牌 GEO 诊断报告服务',
      审核状态: '待 OS 处理'
    }
  });
  const currentStage = text(project && project.fields && project.fields.当前阶段);
  if (project && ['', 'PAYMENT_PENDING', 'INTAKE'].includes(currentStage)) {
    await updateProjectFields({
      tenantToken,
      project,
      fields: {
        当前阶段: 'INTAKE',
        审核状态: '待 OS 处理',
        内部备注: '客户已完成 199 元诊断报告支付；等待 GeoGi OS 接收。'
      }
    });
  }
  return {
    ok: true,
    idempotent: false,
    projectId,
    clientId: text(lead.fields && lead.fields.客户编号),
    transactionId: clean(transaction.transaction_id, 128)
  };
}

async function handlePaymentNotification({ headers, rawBody }) {
  requirePaymentConfigured();
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  verifyWechatSignature({ headers, rawBody: raw });
  const envelope = JSON.parse(raw);
  const transaction = decryptNotificationResource(envelope.resource);
  return markPaymentSuccessful(transaction);
}

async function requestFullRefund({ projectId, reason, requestedBy }) {
  requirePaymentConfigured();
  const cleanProjectId = clean(projectId, 160);
  const cleanReason = clean(reason, 80);
  const operator = clean(requestedBy, 160);
  if (!cleanProjectId) throw new WechatPayError('PAYMENT_REFUND_PROJECT_REQUIRED');
  if (cleanReason.length < 2) throw new WechatPayError('PAYMENT_REFUND_REASON_REQUIRED');

  const { tenantToken, leads, projects } = await loadLeadAndProjectRecords();
  const lead = findByProjectId(leads, cleanProjectId);
  const project = findByProjectId(projects, cleanProjectId);
  if (!lead) throw new WechatPayError('PAYMENT_REFUND_ORDER_NOT_FOUND');
  const current = paymentView({ lead, project });
  if (current.paymentStatus === 'REFUNDED') return { ok: true, idempotent: true, payment: current };
  if (current.paymentStatus === 'REFUND_PROCESSING') return { ok: true, idempotent: true, payment: current };
  if (current.paymentStatus !== 'PAID') throw new WechatPayError('PAYMENT_REFUND_REQUIRES_PAID_ORDER');
  if (!current.refundable) throw new WechatPayError('PAYMENT_REFUND_SERVICE_ALREADY_STARTED');

  const refundNo = current.refundNo || makeRefundNo(cleanProjectId);
  const provider = await requestWechatJson({
    method: 'POST',
    path: '/v3/refund/domestic/refunds',
    payload: {
      out_trade_no: current.outTradeNo,
      out_refund_no: refundNo,
      reason: cleanReason,
      notify_url: refundNotifyUrl(),
      amount: {
        refund: DIAGNOSTIC_AMOUNT_FEN,
        total: DIAGNOSTIC_AMOUNT_FEN,
        currency: 'CNY'
      }
    }
  });
  const status = clean(provider.status, 64).toUpperCase();
  const refundSuccessful = status === 'SUCCESS';
  const now = new Date().toISOString();
  await updateLeadFields({
    tenantToken,
    lead,
    fields: {
      支付状态: refundSuccessful ? '已退款' : '退款处理中',
      退款状态: refundSuccessful ? '退款成功' : '退款处理中',
      退款单号: refundNo,
      微信退款单号: clean(provider.refund_id, 128),
      退款原因: cleanReason,
      退款金额: DIAGNOSTIC_AMOUNT_YUAN,
      退款金额分: String(DIAGNOSTIC_AMOUNT_FEN),
      退款申请时间: now,
      退款完成时间: refundSuccessful ? clean(provider.success_time, 100) || now : '',
      退款操作人: operator,
      当前状态: refundSuccessful ? '已退款' : '退款处理中',
      下一步动作: refundSuccessful ? '本次诊断已全额退款' : '等待微信支付完成退款'
    }
  });
  if (refundSuccessful && project) {
    await updateProjectFields({
      tenantToken,
      project,
      fields: {
        当前阶段: 'REFUNDED',
        审核状态: '已退款',
        内部备注: '客户 199 元诊断报告订单已全额退款，项目停止。'
      }
    });
  }
  return {
    ok: true,
    idempotent: false,
    refundStatus: refundSuccessful ? 'SUCCESS' : 'PROCESSING',
    refundNo,
    wechatRefundId: clean(provider.refund_id, 128),
    amountFen: DIAGNOSTIC_AMOUNT_FEN
  };
}

async function handleRefundNotification({ headers, rawBody }) {
  requirePaymentConfigured();
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  verifyWechatSignature({ headers, rawBody: raw });
  const envelope = JSON.parse(raw);
  const refund = decryptNotificationResource(envelope.resource);
  const refundNo = clean(refund.out_refund_no, 128);
  if (!refundNo) throw new WechatPayError('PAYMENT_REFUND_NOTIFICATION_ORDER_REQUIRED');

  const { tenantToken, leads, projects } = await loadLeadAndProjectRecords();
  const lead = findByRefundNo(leads, refundNo);
  if (!lead) throw new WechatPayError('PAYMENT_REFUND_NOTIFICATION_ORDER_NOT_FOUND');
  const projectId = text(lead.fields && lead.fields.项目编号);
  const project = findByProjectId(projects, projectId);
  const status = clean(refund.refund_status, 64).toUpperCase();
  const success = status === 'SUCCESS';
  const failed = status === 'CLOSED' || status === 'ABNORMAL';
  const amount = Number(refund.amount && refund.amount.refund);
  if (amount && amount !== DIAGNOSTIC_AMOUNT_FEN) {
    throw new WechatPayError('PAYMENT_REFUND_NOTIFICATION_AMOUNT_MISMATCH');
  }
  await updateLeadFields({
    tenantToken,
    lead,
    fields: {
      支付状态: success ? '已退款' : (failed ? '已支付' : '退款处理中'),
      退款状态: success ? '退款成功' : (failed ? '退款失败' : '退款处理中'),
      微信退款单号: clean(refund.refund_id, 128),
      退款完成时间: success ? clean(refund.success_time, 100) || new Date().toISOString() : '',
      当前状态: success ? '已退款' : (failed ? '已付款' : '退款处理中'),
      下一步动作: success
        ? '本次诊断已全额退款'
        : (failed ? '退款失败，请运营人员重新处理' : '等待微信支付完成退款')
    }
  });
  if (success && project) {
    await updateProjectFields({
      tenantToken,
      project,
      fields: {
        当前阶段: 'REFUNDED',
        审核状态: '已退款',
        内部备注: '客户 199 元诊断报告订单已全额退款，项目停止。'
      }
    });
  }
  return { ok: true, projectId, refundNo, refundStatus: status };
}

async function listPaymentRecords() {
  const { leads, projects } = await loadLeadAndProjectRecords();
  const projectMap = new Map(projects.map((record) => [text(record.fields && record.fields.项目编号), record]));
  return leads
    .map((lead) => {
      const projectId = text(lead.fields && lead.fields.项目编号);
      return paymentView({ lead, project: projectMap.get(projectId) || null });
    })
    .filter((item) => item.paymentRequired || item.outTradeNo || item.paymentStatus !== 'UNPAID')
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

function paymentStats(records) {
  const rows = Array.isArray(records) ? records : [];
  const paid = rows.filter((row) => row.paymentStatus === 'PAID');
  const pending = rows.filter((row) => ['UNPAID', 'PENDING'].includes(row.paymentStatus));
  const refunding = rows.filter((row) => row.paymentStatus === 'REFUND_PROCESSING');
  const refunded = rows.filter((row) => row.paymentStatus === 'REFUNDED');
  return {
    orderCount: rows.length,
    paidOrderCount: paid.length,
    pendingOrderCount: pending.length,
    refundProcessingCount: refunding.length,
    refundedOrderCount: refunded.length,
    paidAmountFen: paid.reduce((sum, row) => sum + Number(row.amountFen || 0), 0),
    refundedAmountFen: refunded.reduce((sum, row) => sum + Number(row.refundAmountFen || row.amountFen || 0), 0)
  };
}

module.exports = {
  DIAGNOSTIC_PRODUCT_CODE,
  DIAGNOSTIC_PRODUCT_NAME,
  DIAGNOSTIC_AMOUNT_FEN,
  DIAGNOSTIC_AMOUNT_YUAN,
  WechatPayError,
  paymentConfiguration,
  buildAuthorization,
  buildClientPayParams,
  verifyWechatSignature,
  decryptNotificationResource,
  paymentView,
  paymentStats,
  createDiagnosticPayment,
  getDiagnosticPaymentStatus,
  handlePaymentNotification,
  handleRefundNotification,
  requestFullRefund,
  listPaymentRecords
};
