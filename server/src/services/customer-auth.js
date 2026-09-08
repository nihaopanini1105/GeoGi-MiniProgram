'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function secret() {
  const value = String(process.env.CUSTOMER_SESSION_SECRET || '').trim();
  if (!value) throw new Error('CUSTOMER_SESSION_SECRET_NOT_CONFIGURED');
  return value;
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', secret()).update(encodedPayload).digest('base64url');
}

function createCustomerSession({ phoneNumber, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) return { ok: false, reason: 'phone_missing' };
  const now = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = now + Math.max(300, Number(ttlSeconds) || DEFAULT_TTL_SECONDS);
  const payload = {
    v: 1,
    sub: `phone:${phone}`,
    phoneNumber: phone,
    iat: now,
    exp: expiresAtSeconds,
    nonce: crypto.randomBytes(12).toString('hex')
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = sign(encoded);
  return {
    ok: true,
    token: `${encoded}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    customer: { phoneNumber: phone }
  };
}

function verifyCustomerSession(token) {
  try {
    const raw = String(token || '').trim();
    const [encoded, signature, extra] = raw.split('.');
    if (!encoded || !signature || extra) return { ok: false, reason: 'token_malformed' };
    const expected = sign(encoded);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'token_signature_invalid' };
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || payload.v !== 1) return { ok: false, reason: 'token_version_invalid' };
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'token_expired' };
    }
    const phoneNumber = normalizePhone(payload.phoneNumber);
    if (!phoneNumber || payload.sub !== `phone:${phoneNumber}`) {
      return { ok: false, reason: 'token_subject_invalid' };
    }
    return {
      ok: true,
      customer: {
        phoneNumber,
        subject: payload.sub,
        issuedAt: new Date(payload.iat * 1000).toISOString(),
        expiresAt: new Date(payload.exp * 1000).toISOString()
      }
    };
  } catch (error) {
    return { ok: false, reason: 'token_invalid' };
  }
}

function bearerToken(req) {
  const header = String((req && req.headers && req.headers.authorization) || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function authenticateCustomer(req, res, next) {
  let verified;
  try {
    verified = verifyCustomerSession(bearerToken(req));
  } catch (error) {
    verified = { ok: false, reason: 'auth_unavailable' };
  }
  if (!verified.ok) {
    res.status(401).json({ ok: false, userMessage: '身份验证已失效，请重新授权手机号' });
    return;
  }
  req.customer = verified.customer;
  next();
}

module.exports = {
  createCustomerSession,
  verifyCustomerSession,
  authenticateCustomer,
  normalizePhone
};
