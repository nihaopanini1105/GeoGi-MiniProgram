require('dotenv').config();

const crypto = require('crypto');
const https = require('https');

const workbenchTables = [
  {
    name: '诊断项目',
    fields: [
      '项目编号',
      '客户编号',
      '品牌名称',
      '项目类型',
      '当前阶段',
      '优先级',
      '负责人',
      '开始时间',
      '预计交付时间',
      '实际交付时间',
      '客户确认范围',
      '内部备注'
    ]
  },
  {
    name: '品牌基础档案',
    fields: [
      '项目编号',
      '客户编号',
      '品牌标准名称',
      '所属企业',
      '行业',
      '细分业务',
      '目标市场',
      '核心产品/服务',
      '主要客户',
      '品牌优势',
      '官方渠道',
      '公开信源',
      '竞品品牌',
      '风险备注',
      '档案状态',
      '最后更新'
    ]
  },
  {
    name: '全网信源',
    fields: [
      '项目编号',
      '品牌名称',
      '信源名称',
      '信源类型',
      '链接',
      '是否官方',
      '可信度',
      '核心信息摘要',
      '问题或缺口',
      '采集时间'
    ]
  },
  {
    name: '品牌关键词',
    fields: [
      '项目编号',
      '品牌名称',
      '关键词',
      '关键词类型',
      '用户意图',
      '优先级',
      '备注'
    ]
  },
  {
    name: '行业热门问题',
    fields: [
      '项目编号',
      '行业',
      '问题',
      '问题类型',
      '用户场景',
      '优先级',
      '是否纳入检测',
      '备注'
    ]
  },
  {
    name: 'AI 检测问题',
    fields: [
      '项目编号',
      '问题编号',
      '检测问题',
      '问题类型',
      '目标平台',
      '预期识别点',
      '检测状态',
      '负责人',
      '备注'
    ]
  },
  {
    name: '平台测试记录',
    fields: [
      '项目编号',
      '问题编号',
      '平台',
      '提问内容',
      '回答原文',
      '是否提到品牌',
      '是否主动推荐',
      '信息是否准确',
      '提到的竞品',
      '引用或信源',
      '证据截图/链接',
      '测试时间',
      '测试人'
    ]
  },
  {
    name: '回答分析结果',
    fields: [
      '项目编号',
      '平台',
      '品牌识别得分',
      '主动推荐得分',
      '信息准确得分',
      '竞品压制情况',
      '信源可信度',
      '核心问题',
      '优化建议',
      '分析状态'
    ]
  },
  {
    name: '报告管理',
    fields: [
      '项目编号',
      '客户编号',
      '品牌名称',
      '报告版本',
      '报告状态',
      '报告链接',
      '交付说明',
      '客户反馈',
      '下一步建议',
      '创建时间',
      '更新时间'
    ]
  }
];

async function main() {
  assertEnv(['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BASE_APP_TOKEN']);
  const tenantToken = await getTenantAccessToken();
  const existingTables = await listTables(tenantToken);
  const tableByName = new Map(existingTables.map((table) => [table.name, table]));
  const result = [];

  for (const tableSpec of workbenchTables) {
    const table = tableByName.get(tableSpec.name) || await createTable(tenantToken, tableSpec.name);
    const tableId = table.table_id;
    const fieldResult = await ensureFields(tenantToken, tableId, tableSpec.fields);
    result.push({
      table: tableSpec.name,
      tableId,
      createdTable: !tableByName.has(tableSpec.name),
      createdFields: fieldResult.created,
      skippedFields: fieldResult.skipped
    });
  }

  console.log(JSON.stringify({ ok: true, tables: result }, null, 2));
}

async function ensureFields(tenantToken, tableId, fields) {
  const existing = await listFields(tenantToken, tableId);
  const existingNames = new Set(existing.map((field) => field.field_name));
  const created = [];
  const skipped = [];

  for (const fieldName of fields) {
    if (existingNames.has(fieldName)) {
      skipped.push(fieldName);
      continue;
    }
    await createTextField(tenantToken, tableId, fieldName);
    created.push(fieldName);
  }

  return { created, skipped };
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

async function listTables(tenantToken) {
  const result = await requestJson({
    method: 'GET',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables?page_size=100`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    }
  });

  if (result.code !== 0) {
    throw new Error(`list tables failed: ${JSON.stringify(result)}`);
  }
  return result.data && result.data.items ? result.data.items : [];
}

async function createTable(tenantToken, tableName) {
  const result = await requestJson({
    method: 'POST',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    },
    body: {
      table: {
        name: tableName
      },
      default_view_name: '默认视图',
      fields: [
        {
          field_name: '项目编号',
          type: 1
        }
      ]
    }
  });

  if (result.code !== 0) {
    throw new Error(`create table ${tableName} failed: ${JSON.stringify(result)}`);
  }
  return result.data && result.data.table ? result.data.table : result.data;
}

async function listFields(tenantToken, tableId) {
  const result = await requestJson({
    method: 'GET',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${tableId}/fields?page_size=100`,
    headers: {
      Authorization: `Bearer ${tenantToken}`
    }
  });

  if (result.code !== 0) {
    throw new Error(`list fields ${tableId} failed: ${JSON.stringify(result)}`);
  }
  return result.data && result.data.items ? result.data.items : [];
}

async function createTextField(tenantToken, tableId, fieldName) {
  const result = await requestJson({
    method: 'POST',
    hostname: 'open.feishu.cn',
    path: `/open-apis/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${tableId}/fields?client_token=${crypto.randomUUID()}`,
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
