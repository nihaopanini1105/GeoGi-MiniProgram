const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function createCustomerSession({ phoneNumber }) {
  const secret = getSecret();
  if (!secret) {
    return {
      ok: false,
      userMessage: '客户身份服务暂未配置'
    };
  }

  const phone = normalizePhone(phoneNumber);
  if (!phone) {
    return {
      ok: false,
      userMessage: '手机号无效'
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = getTtlSeconds();
  const payload = {
    phoneNumber: phone,
    iat: now,
    exp: now + ttl,
    nonce: crypto.randomBytes(12).toString('hex')
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return {
    ok: true,
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date((now + ttl) * 1000).toISOString(),
    phoneNumber: phone
  };
}

function verifyCustomerSession(token) {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: 'SESSION_SECRET_MISSING' };

  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'TOKEN_INVALID' };

  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = sign(encodedPayload, secret);
  if (!safeEqual(suppliedSignature, expectedSignature)) {
    return { ok: false, reason: 'TOKEN_INVALID' };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || Number(payload.exp) <= now) {
      return { ok: false, reason: 'TOKEN_EXPIRED' };
    }
    const phoneNumber = normalizePhone(payload.phoneNumber);
    if (!phoneNumber) return { ok: false, reason: 'TOKEN_INVALID' };
    return {
      ok: true,
      customer: {
        phoneNumber,
        expiresAt: new Date(Number(payload.exp) * 1000).toISOString()
      }
    };
  } catch (error) {
    return { ok: false, reason: 'TOKEN_INVALID' };
  }
}

function getBearerToken(req) {
  const header = String((req && req.headers && req.headers.authorization) || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
  return /^1\d{10}$/.test(digits) ? digits : '';
}

function getSecret() {
  return String(process.env.CUSTOMER_SESSION_SECRET || '').trim();
}

function getTtlSeconds() {
  const configured = Number(process.env.CUSTOMER_SESSION_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 3600) return DEFAULT_TTL_SECONDS;
  return Math.floor(configured);
}

function sign(value, secret) {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(value).digest());
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

module.exports = {
  createCustomerSession,
  verifyCustomerSession,
  getBearerToken,
  normalizePhone
};
