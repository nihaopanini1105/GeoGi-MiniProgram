const https = require('https');

async function getPhoneNumber({ code }) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return fail('缺少手机号授权 code');

  const appId = process.env.WECHAT_APP_ID || process.env.WECHAT_MINI_PROGRAM_APPID;
  const appSecret = process.env.WECHAT_APP_SECRET || process.env.WECHAT_MINI_PROGRAM_SECRET;
  if (!appId || !appSecret) return fail('服务器未配置小程序 AppSecret，暂时无法完成手机号授权');

  try {
    const tokenResult = await requestJson({
      method: 'GET',
      hostname: 'api.weixin.qq.com',
      path: `/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`
    });
    if (!tokenResult.access_token) {
      return fail(`获取微信 access_token 失败：${tokenResult.errmsg || tokenResult.errcode || '未知错误'}`);
    }

    const phoneResult = await requestJson({
      method: 'POST',
      hostname: 'api.weixin.qq.com',
      path: `/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(tokenResult.access_token)}`,
      body: { code: cleanCode }
    });
    if (phoneResult.errcode && phoneResult.errcode !== 0) {
      return fail(`手机号授权失败：${phoneResult.errmsg || phoneResult.errcode}`);
    }

    const info = phoneResult.phone_info || {};
    return {
      ok: true,
      phoneNumber: info.phoneNumber || '',
      purePhoneNumber: info.purePhoneNumber || info.phoneNumber || '',
      countryCode: info.countryCode || ''
    };
  } catch (error) {
    console.error('getPhoneNumber failed', error);
    return fail('手机号授权服务暂时不可用');
  }
}

function requestJson({ method, hostname, path, body }) {
  const data = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname,
      path,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data)
      },
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
          reject(new Error(`invalid json response: ${raw}`));
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
