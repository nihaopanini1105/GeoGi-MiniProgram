const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const REQUIRED_ENV = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_BASE_APP_TOKEN',
  'FEISHU_LEADS_TABLE_ID'
];

exports.main = async (event) => {
  try {
    const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missingEnv.length) {
      return fail(`服务未完成配置：${missingEnv.join(', ')}`);
    }

    const form = sanitizeForm(event.form || {});
    const validationError = validateForm(form);
    if (validationError) {
      return fail(validationError);
    }

    const wxContext = cloud.getWXContext();
    const submittedAt = form.submittedAt || new Date().toISOString();
    const clientId = makeId('GG', submittedAt);
    const projectId = makeId('GG-P', submittedAt);
    const tenantToken = await getTenantAccessToken();
    const fields = buildLeadFields({
      form,
      clientId,
      projectId,
      submittedAt,
      openid: wxContext.OPENID || '',
      source: event.source || 'wechat_miniprogram'
    });

    const record = await createBitableRecord(tenantToken, fields);
    const recordId = record && record.record && record.record.record_id;
    const recordUrl = buildRecordUrl(recordId);

    await notifyFeishu({
      tenantToken,
      form,
      clientId,
      projectId,
      submittedAt,
      recordUrl
    });

    return {
      ok: true,
      clientId,
      projectId,
      recordId,
      recordUrl
    };
  } catch (error) {
    console.error('submitDiagnosis failed', error);
    return fail('提交失败，请稍后重试');
  }
};

function sanitizeForm(form) {
  const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
  return {
    brandName: cleanText(form.brandName, 100),
    companyName: cleanText(form.companyName, 120),
    industry: cleanText(form.industry, 80),
    segment: cleanText(form.segment, 120),
    officialChannel: cleanText(form.officialChannel, 500),
    offerings: cleanText(form.offerings, 500),
    audiences: cleanText(form.audiences, 200),
    competitors: cleanText(form.competitors, 200),
    goals: Array.isArray(form.goals) ? form.goals.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 3) : [],
    contactName: cleanText(form.contactName, 80),
    contactMethod: cleanText(form.contactMethod, 120),
    message: cleanText(form.message, 500),
    privacyAccepted: Boolean(form.privacyAccepted),
    submittedAt: cleanText(form.submittedAt, 80)
  };
}

function validateForm(form) {
  if (!form.brandName || !form.industry || !form.segment) return '请补全品牌和行业信息';
  if (!form.offerings || form.goals.length === 0) return '请填写核心业务并选择诊断目标';
  if (!form.contactName || !form.contactMethod || !form.privacyAccepted) return '请填写联系方式并确认授权';
  return '';
}

function buildLeadFields({ form, clientId, projectId, submittedAt, openid, source }) {
  return {
    客户编号: clientId,
    项目编号: projectId,
    品牌名称: form.brandName,
    企业名称: form.companyName,
    一级行业: form.industry,
    细分业务: form.segment,
    官方渠道: form.officialChannel,
    核心业务: form.offerings,
    主要客户: form.audiences,
    竞品或对标品牌: form.competitors,
    诊断目标: form.goals.join('、'),
    联系人: form.contactName,
    联系方式: form.contactMethod,
    补充说明: form.message,
    隐私授权: form.privacyAccepted,
    提交时间: submittedAt,
    当前状态: '新提交',
    来源: source,
    小程序OpenID: openid
  };
}

function makeId(prefix, isoTime) {
  const date = new Date(isoTime);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  return `${prefix}-${y}${m}-${random}`;
}

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

async function createBitableRecord(tenantToken, fields) {
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  const tableId = process.env.FEISHU_LEADS_TABLE_ID;
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

async function notifyFeishu({ tenantToken, form, clientId, projectId, submittedAt, recordUrl }) {
  const text = [
    '【GeoGi 新客户提交】收到新的品牌 AI 可见度诊断申请。',
    `品牌名称：${form.brandName}`,
    `所属行业：${form.industry} / ${form.segment}`,
    `核心产品或服务：${form.offerings}`,
    `诊断目标：${form.goals.join('、')}`,
    `联系人：${form.contactName}`,
    `联系方式：${form.contactMethod}`,
    `提交时间：${submittedAt}`,
    `客户编号：${clientId}`,
    `项目编号：${projectId}`,
    `当前状态：新提交`,
    '建议动作：请在 24 小时内审核资料并联系客户。',
    recordUrl ? `查看客户详情：${recordUrl}` : ''
  ].filter(Boolean).join('\n');

  if (process.env.FEISHU_NOTIFY_WEBHOOK) {
    await notifyByWebhook(text);
  }

  if (process.env.FEISHU_NOTIFY_RECEIVE_ID) {
    await notifyByBot(tenantToken, text);
  }
}

async function notifyByWebhook(text) {
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

async function notifyByBot(tenantToken, text) {
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

function buildRecordUrl(recordId) {
  if (!recordId || !process.env.FEISHU_RECORD_URL_TEMPLATE) return '';
  return process.env.FEISHU_RECORD_URL_TEMPLATE
    .replace('{recordId}', recordId)
    .replace('{appToken}', process.env.FEISHU_BASE_APP_TOKEN)
    .replace('{tableId}', process.env.FEISHU_LEADS_TABLE_ID);
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

function fail(userMessage) {
  return {
    ok: false,
    userMessage
  };
}
