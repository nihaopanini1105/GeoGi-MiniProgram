require('dotenv').config();

const crypto = require('crypto');
const https = require('https');

const fields = [
  '提交ID',
  '客户编号',
  '项目编号',
  '品牌名称',
  '企业名称',
  '一级行业',
  '细分业务',
  '官方渠道',
  '主要市场',
  '核心业务',
  '主要客户',
  '核心优势',
  '竞品或对标品牌',
  '诊断目标',
  '附件资料',
  '联系人',
  '联系方式',
  '补充说明',
  '隐私授权',
  '提交时间',
  '当前状态',
  '负责人',
  '下一步动作',
  '通知状态',
  '通知发送时间',
  '通知错误',
  '通知重试次数',
  '来源',
  '小程序OpenID'
];

async function main() {
  assertEnv(['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BASE_APP_TOKEN', 'FEISHU_LEADS_TABLE_ID']);
  const tenantToken = await getTenantAccessToken();
  const existing = await listFields(tenantToken);
  const existingNames = new Set(existing.map((field) => field.field_name));
  const created = [];
  const skipped = [];

  for (const fieldName of fields) {
    if (existingNames.has(fieldName)) {
      skipped.push(fieldName);
      continue;
    }
    await createTextField(tenantToken, fieldName);
    created.push(fieldName);
  }

  console.log(JSON.stringify({ ok: true, created, skipped }, null, 2));
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
    throw new Error(`tenant token failed: ${JSON.stringify(result)}`);
  }
  return result.tenant_access_token;
}

async function listFields(tenantToken) {
  const result = await requestJson({
    method: 'GET',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${process.env.FEISHU_LEADS_TABLE_ID}/fields?page_size=100`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    }
  });

  if (result.code !== 0) {
    throw new Error(`list fields failed: ${JSON.stringify(result)}`);
  }
  return result.data && result.data.items ? result.data.items : [];
}

async function createTextField(tenantToken, fieldName) {
  const result = await requestJson({
    method: 'POST',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${process.env.FEISHU_LEADS_TABLE_ID}/fields?client_token=${crypto.randomUUID()}`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    },
    body: {
      field_name: fieldName,
      type: 1
    }
  });

  if (result.code !== 0) {
    throw new Error(`create field ${fieldName} failed: ${JSON.stringify(result)}`);
  }
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

function assertEnv(keys) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`missing env: ${missing.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
