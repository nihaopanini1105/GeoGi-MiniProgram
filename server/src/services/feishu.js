const https = require('https');
const crypto = require('crypto');

async function getTenantAccessToken() {
  const result = await requestJson({
    method: 'POST',
    hostname: 'open.feishu.cn',
    path: '/open-apis/auth/v3/tenant_access_token/internal',
    body: {
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    }
  });

  if (result.code !== 0 || !result.tenant_access_token) {
    throw new Error(`tenant_access_token failed: ${JSON.stringify(result)}`);
  }
  return result.tenant_access_token;
}

async function createBitableRecord({ tenantToken, appToken, tableId, fields }) {
  const result = await requestJson({
    method: 'POST',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    },
    body: {
      fields
    }
  });

  if (result.code !== 0) {
    throw new Error(`create record failed: ${JSON.stringify(result)}`);
  }
  return result.data;
}

async function listBitableRecords({ tenantToken, appToken, tableId, pageSize = 100 }) {
  const result = await requestJson({
    method: 'GET',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=${pageSize}`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    }
  });

  if (result.code !== 0) {
    throw new Error(`list records failed: ${JSON.stringify(result)}`);
  }
  return result.data && result.data.items ? result.data.items : [];
}

async function sendWebhookText(text) {
  const webhook = new URL(process.env.FEISHU_NOTIFY_WEBHOOK);
  const payload = {
    msg_type: 'text',
    content: { text }
  };

  if (process.env.FEISHU_NOTIFY_SECRET) {
    const timestamp = Math.floor(Date.now() / 1000);
    payload.timestamp = timestamp;
    payload.sign = crypto
      .createHmac('sha256', `${timestamp}\n${process.env.FEISHU_NOTIFY_SECRET}`)
      .update('')
      .digest('base64');
  }

  const result = await requestJson({
    method: 'POST',
    hostname: webhook.hostname,
    path: `${webhook.pathname}${webhook.search}`,
    body: payload
  });

  if (result.code && result.code !== 0) {
    throw new Error(`webhook notify failed: ${JSON.stringify(result)}`);
  }
}

async function sendBotText({ tenantToken, text }) {
  const receiveIdType = process.env.FEISHU_NOTIFY_RECEIVE_ID_TYPE || 'open_id';
  const result = await requestJson({
    method: 'POST',
    hostname: 'open.feishu.cn',
    path: `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    },
    body: {
      receive_id: process.env.FEISHU_NOTIFY_RECEIVE_ID,
      msg_type: 'text',
      content: JSON.stringify({ text })
    }
  });

  if (result.code !== 0) {
    throw new Error(`bot notify failed: ${JSON.stringify(result)}`);
  }
}

function buildRecordUrl({ recordId, appToken, tableId }) {
  if (!recordId || !process.env.FEISHU_RECORD_URL_TEMPLATE) return '';
  return process.env.FEISHU_RECORD_URL_TEMPLATE
    .replace('{recordId}', recordId)
    .replace('{appToken}', appToken)
    .replace('{tableId}', tableId);
}

function requestJson({ method, hostname, path, headers = {}, body }) {
  const data = body ? JSON.stringify(body) : '';
  const options = {
    method,
    hostname,
    path,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      ...headers
    },
    timeout: 12000
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
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
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    if (data) req.write(data);
    req.end();
  });
}

module.exports = {
  getTenantAccessToken,
  createBitableRecord,
  listBitableRecords,
  sendWebhookText,
  sendBotText,
  buildRecordUrl
};
