'use strict';

require('dotenv').config();

const { getTenantAccessToken, listBitableRecords } = require('../services/feishu');

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.name) return String(value.name).trim();
    if (value.value) return String(value.value).trim();
    if (value.link) return String(value.link).trim();
    return JSON.stringify(value);
  }
  return String(value || '').trim();
}

async function main() {
  const limitArg = process.argv.find((arg) => /^--limit=\d+$/.test(arg));
  const limit = limitArg ? Math.max(1, Math.min(50, Number(limitArg.split('=')[1]))) : 10;

  if (!process.env.FEISHU_BASE_APP_TOKEN || !process.env.FEISHU_PROJECTS_TABLE_ID) {
    throw new Error('缺少 FEISHU_BASE_APP_TOKEN 或 FEISHU_PROJECTS_TABLE_ID');
  }

  const tenantToken = await getTenantAccessToken();
  const rows = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
    pageSize: 100
  });

  const projects = rows
    .map((row) => {
      const fields = row.fields || {};
      return {
        projectId: text(fields.项目编号),
        clientId: text(fields.客户编号),
        brandName: text(fields.品牌名称),
        stage: text(fields.当前阶段),
        reviewStatus: text(fields.审核状态),
        updatedAt: text(fields.更新时间) || text(fields.创建时间) || text(fields.提交时间),
        recordId: row.record_id || ''
      };
    })
    .filter((item) => item.projectId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit);

  console.log(JSON.stringify({
    ok: true,
    count: projects.length,
    projects
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
