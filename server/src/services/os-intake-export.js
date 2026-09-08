'use strict';

const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');

const REQUIRED_TABLES = [
  'FEISHU_LEADS_TABLE_ID',
  'FEISHU_PROJECTS_TABLE_ID'
];

async function buildOsIntakeHandoff({ projectId } = {}) {
  const cleanProjectId = clean(projectId);
  if (!cleanProjectId) throw new Error('缺少项目编号');

  const missing = REQUIRED_TABLES.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`缺少飞书表配置：${missing.join(', ')}`);

  const tenantToken = await getTenantAccessToken();
  const [leadRows, projectRows] = await Promise.all([
    listProjectRows({ tenantToken, tableId: process.env.FEISHU_LEADS_TABLE_ID, projectId: cleanProjectId }),
    listProjectRows({ tenantToken, tableId: process.env.FEISHU_PROJECTS_TABLE_ID, projectId: cleanProjectId })
  ]);

  if (leadRows.length !== 1) throw new Error(`客户提交记录数量异常：${leadRows.length}`);
  if (projectRows.length !== 1) throw new Error(`诊断项目记录数量异常：${projectRows.length}`);

  const lead = leadRows[0].fields || {};
  const project = projectRows[0].fields || {};
  const clientId = text(lead.客户编号) || text(project.客户编号);
  if (!clientId) throw new Error(`项目缺少客户编号：${cleanProjectId}`);

  return {
    handoffVersion: '2.0.0',
    handoffType: 'geogi_customer_intake',
    sourceSystem: 'geogi_miniprogram_feishu',
    authorityBoundary: {
      miniProgramRole: 'auth_intake_upload_status_display',
      downstreamAuthority: 'GeoGi-OS',
      containsDerivedIntelligence: false,
      containsGeneratedQuestions: false,
      containsScores: false,
      containsReportContent: false
    },
    generatedAt: new Date().toISOString(),
    project: {
      externalProjectId: cleanProjectId,
      externalClientId: clientId,
      brandName: text(lead.品牌名称),
      companyName: text(lead.企业名称),
      industry: text(lead.一级行业),
      segment: text(lead.细分业务),
      officialChannel: text(lead.官方渠道),
      targetMarkets: splitList(text(lead.主要市场)),
      offerings: text(lead.核心业务),
      audiences: text(lead.主要客户),
      advantages: text(lead.核心优势),
      competitors: splitList(text(lead.竞品或对标品牌)),
      goals: splitList(text(lead.诊断目标)),
      attachments: splitLines(text(lead.附件资料)),
      customerMessage: text(lead.补充说明),
      submittedAt: text(lead.提交时间),
      intakeStatus: text(lead.当前状态),
      projectStage: text(project.当前阶段),
      projectReviewStatus: text(project.审核状态)
    }
  };
}

async function listProjectRows({ tenantToken, tableId, projectId }) {
  if (!tableId) return [];
  const rows = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return rows.filter((row) => text((row.fields || {}).项目编号) === projectId);
}

function splitList(value) {
  return String(value || '')
    .split(/[、,，;；\n\r]/)
    .map(clean)
    .filter(Boolean);
}

function splitLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean);
}

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

function clean(value) {
  return String(value || '').trim();
}

module.exports = {
  buildOsIntakeHandoff
};
