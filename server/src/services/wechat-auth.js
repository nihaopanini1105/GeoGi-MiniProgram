const https = require('https');
const { createCustomerSession, normalizePhone } = require('./customer-auth');

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

async function getPhoneNumber({ code }) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return fail('手机号授权信息无效，请重新授权');

  const appId = process.env.WECHAT_APP_ID || process.env.WECHAT_MINI_PROGRAM_APPID;
  const appSecret = process.env.WECHAT_APP_SECRET || process.env.WECHAT_MINI_PROGRAM_SECRET;
  if (!appId || !appSecret) {
    console.error('WeChat phone authorization is missing WECHAT_APP_ID or WECHAT_APP_SECRET');
    return fail('手机号授权服务暂时不可用');
  }

  try {
    const accessToken = await getAccessToken({ appId, appSecret });
    if (!accessToken) return fail('手机号授权服务暂时不可用');

    const phoneResult = await requestJson({
      method: 'POST',
      hostname: 'api.weixin.qq.com',
      path: `/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
      body: { code: cleanCode }
    });
    if (phoneResult.errcode && phoneResult.errcode !== 0) {
      console.error('WeChat getuserphonenumber failed', phoneResult.errcode, phoneResult.errmsg || '');
      return fail('手机号授权失败，请重新授权');
    }

    const info = phoneResult.phone_info || {};
    const phoneNumber = normalizePhone(info.purePhoneNumber || info.phoneNumber);
    if (!phoneNumber) {
      console.error('WeChat getuserphonenumber returned invalid phone info');
      return fail('手机号授权失败，请重新授权');
    }

    const session = createCustomerSession({ phoneNumber });
    if (!session.ok) {
      console.error('Customer session creation failed');
      return fail('手机号已获取，但客户身份服务暂时不可用');
    }

    return {
      ok: true,
      phoneNumber,
      purePhoneNumber: phoneNumber,
      countryCode: info.countryCode || '86',
      customerToken: session.token,
      customerTokenExpiresAt: session.expiresAt
    };
  } catch (error) {
    console.error('getPhoneNumber failed', error);
    return fail('手机号授权服务暂时不可用');
  }
}

async function getAccessToken({ appId, appSecret }) {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiresAt > now + 60 * 1000) {
    return cachedAccessToken;
  }

  const tokenResult = await requestJson({
    method: 'GET',
    hostname: 'api.weixin.qq.com',
    path: `/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`
  });
  if (!tokenResult.access_token) {
    console.error('WeChat access_token failed', tokenResult.errcode || '', tokenResult.errmsg || '');
    return '';
  }

  const expiresInSeconds = Math.max(Number(tokenResult.expires_in || 7200), 300);
  cachedAccessToken = tokenResult.access_token;
  cachedAccessTokenExpiresAt = now + expiresInSeconds * 1000;
  return cachedAccessToken;
}

function requestJson({ method, hostname, path, body }) {
  const data = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request({
      method,
      hostname,
      path,
      headers,
      timeout: 12000
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(new Error('invalid json response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (data) req.write(data);
    req.end();
  });
}

function fail(userMessage) {
  return {
    ok: false,
    userMessage
  };
}

module.exports = {
  getPhoneNumber
};
