const crypto = require('crypto');
const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sessionSecret() {
  const value = String(
    process.env.CUSTOMER_SESSION_SECRET
    || process.env.WECHAT_APP_SECRET
    || process.env.WECHAT_MINI_PROGRAM_SECRET
    || ''
  ).trim();
  if (!value) throw new Error('CUSTOMER_SESSION_SECRET_REQUIRED');
  return value;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(body) {
  return crypto
    .createHmac('sha256', sessionSecret())
    .update(body, 'utf8')
    .digest('base64url');
}

function createCustomerToken(phoneNumber) {
  const cleanPhone = String(phoneNumber || '').trim();
  if (!cleanPhone) throw new Error('CUSTOMER_PHONE_REQUIRED');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const payload = {
    v: 1,
    phoneNumber: cleanPhone,
    exp: expiresAt.getTime()
  };
  const body = base64url(JSON.stringify(payload));
  return {
    customerToken: `${body}.${sign(body)}`,
    customerTokenExpiresAt: expiresAt.toISOString()
  };
}

function verifyCustomerToken(token) {
  const raw = String(token || '').trim();
  const [body, signature] = raw.split('.');
  if (!body || !signature) throw new Error('CUSTOMER_SESSION_INVALID');
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('CUSTOMER_SESSION_INVALID');
  }
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error('CUSTOMER_SESSION_INVALID');
  }
  if (!payload || payload.v !== 1 || !payload.phoneNumber || !payload.exp) {
    throw new Error('CUSTOMER_SESSION_INVALID');
  }
  if (Number(payload.exp) <= Date.now()) throw new Error('CUSTOMER_SESSION_EXPIRED');
  return payload;
}

function bearerToken(req) {
  const header = String(req && req.headers && req.headers.authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function requireCustomerSession(req, res, next) {
  try {
    req.customerSession = verifyCustomerToken(bearerToken(req));
    next();
  } catch (error) {
    res.status(401).json({
      ok: false,
      userMessage: error && error.message === 'CUSTOMER_SESSION_EXPIRED'
        ? '身份验证已失效，请重新授权手机号'
        : '请先授权手机号'
    });
  }
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

async function resolveOwnedClientId({ phoneNumber, requestedClientId = '' }) {
  const cleanPhone = String(phoneNumber || '').trim();
  if (!cleanPhone) return '';
  const tableId = process.env.FEISHU_LEADS_TABLE_ID;
  if (!tableId) return '';
  const tenantToken = await getTenantAccessToken();
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  const owned = records.filter((record) => text(record.fields && record.fields.联系方式) === cleanPhone);
  if (!owned.length) return '';
  const requested = String(requestedClientId || '').trim();
  if (requested) {
    const match = owned.find((record) => text(record.fields && record.fields.客户编号) === requested);
    return match ? requested : '';
  }
  owned.sort((a, b) => text(b.fields && b.fields.提交时间).localeCompare(text(a.fields && a.fields.提交时间)));
  return text(owned[0].fields && owned[0].fields.客户编号);
}

module.exports = {
  createCustomerToken,
  verifyCustomerToken,
  requireCustomerSession,
  resolveOwnedClientId
};
