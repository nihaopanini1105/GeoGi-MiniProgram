'use strict';

const crypto = require('crypto');
const {
  getTenantAccessToken,
  createBitableRecord,
  listBitableRecords,
  buildRecordUrl
} = require('./feishu');
const { nextMonthlyId } = require('./counter');
const { normalizePhone } = require('./customer-auth');

const REQUIRED_ENV = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_BASE_APP_TOKEN',
  'FEISHU_LEADS_TABLE_ID',
  'FEISHU_PROJECTS_TABLE_ID'
];

async function submitCustomerIntake(input, customer) {
  try {
    const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missingEnv.length) return fail(`服务未完成配置：${missingEnv.join(', ')}`);

    const form = sanitizeForm((input && input.form) || {});
    const validationError = validateForm(form);
    if (validationError) return fail(validationError);

    const authorizedPhone = normalizePhone(customer && customer.phoneNumber);
    const submittedPhone = normalizePhone(form.contactMethod);
    if (!authorizedPhone || !submittedPhone || authorizedPhone !== submittedPhone) {
      return fail('提交手机号与当前授权手机号不一致，请重新授权手机号');
    }

    const submittedAt = form.submittedAt || new Date().toISOString();
    const tenantToken = await getTenantAccessToken();
    const existing = await findExistingSubmission({ tenantToken, submissionId: form.submissionId });
    if (existing && isSameSubmission(existing.fields || {}, form)) {
      return existingResponse(existing, submittedAt);
    }

    const clientId = await nextMonthlyId('GG', submittedAt);
    const projectId = makeProjectId(submittedAt);
    const fields = buildLeadFields({
      form,
      clientId,
      projectId,
      submittedAt,
      source: input.source || 'wechat_miniprogram'
    });
    const record = await createBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      fields
    });
    const recordId = record && record.record && record.record.record_id;
    const recordUrl = buildRecordUrl({
      recordId,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID
    });

    await createBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      fields: buildProjectFields({ form, clientId, projectId, submittedAt, leadRecordUrl: recordUrl })
    });

    return {
      ok: true,
      clientId,
      projectId,
      status: '已提交',
      workbenchStatus: '等待 GeoGi OS 处理',
      submittedAt,
      recordId,
      recordUrl
    };
  } catch (error) {
    console.error('submitCustomerIntake failed', error);
    return fail('提交失败，请稍后重试');
  }
}

function sanitizeForm(form) {
  const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
  const cleanList = (value, maxItems = 10, maxText = 100) => Array.isArray(value)
    ? value.map((item) => cleanText(item, maxText)).filter(Boolean).slice(0, maxItems)
    : [];
  return {
    submissionId: cleanText(form.submissionId, 120),
    brandName: cleanText(form.brandName, 100),
    companyName: cleanText(form.companyName, 120),
    industry: cleanText(form.industry, 80),
    segment: cleanText(form.segment, 120),
    officialChannel: cleanText(form.officialChannel, 500),
    targetMarket: cleanList(form.targetMarket, 8, 80),
    targetMarketOther: cleanText(form.targetMarketOther, 120),
    offerings: cleanText(form.offerings, 800),
    audiences: cleanText(form.audiences, 500),
    advantages: cleanText(form.advantages, 500),
    competitors: cleanText(form.competitors, 500),
    goals: cleanList(form.goals, 3, 120),
    uploads: normalizeUploads(form.uploads),
    contactName: cleanText(form.contactName, 80),
    contactMethod: cleanText(form.contactMethod, 120),
    message: cleanText(form.message, 500),
    privacyAccepted: Boolean(form.privacyAccepted),
    submittedAt: cleanText(form.submittedAt, 80)
  };
}

function normalizeUploads(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((item) => ({
    name: String(item && item.name || '').trim().slice(0, 160),
    fileId: String(item && item.fileId || '').trim().slice(0, 160),
    url: String(item && item.url || '').trim().slice(0, 800)
  })).filter((item) => item.name || item.fileId || item.url);
}

function validateForm(form) {
  if (!form.submissionId) return '提交编号缺失，请重新进入诊断页面';
  if (!form.brandName) return '请填写品牌名称';
  if (!form.industry) return '请选择所属行业';
  if (!form.segment) return '请填写细分业务领域';
  if (!form.targetMarket.length && !form.targetMarketOther) return '请选择或填写主要市场';
  if (!form.offerings) return '请填写核心产品或服务';
  if (!form.audiences) return '请填写主要客户与需求';
  if (!form.goals.length) return '请选择本次诊断目标';
  if (!form.contactName) return '请填写联系人';
  if (!form.contactMethod) return '请授权手机号';
  if (!form.privacyAccepted) return '提交前需要同意隐私说明';
  return '';
}

async function findExistingSubmission({ tenantToken, submissionId }) {
  if (!submissionId) return null;
  const rows = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    pageSize: 100
  });
  return rows.find((row) => text(row.fields && row.fields.提交ID) === submissionId) || null;
}

function isSameSubmission(fields, form) {
  return text(fields.品牌名称) === form.brandName
    && (!form.companyName || !text(fields.企业名称) || text(fields.企业名称) === form.companyName)
    && (!form.industry || !text(fields.一级行业) || text(fields.一级行业) === form.industry);
}

function existingResponse(existing, submittedAt) {
  const fields = existing.fields || {};
  return {
    ok: true,
    duplicated: true,
    clientId: text(fields.客户编号),
    projectId: text(fields.项目编号),
    status: text(fields.当前状态) || '已提交',
    workbenchStatus: '等待 GeoGi OS 处理',
    submittedAt: text(fields.提交时间) || submittedAt,
    recordId: existing.record_id || ''
  };
}

function buildLeadFields({ form, clientId, projectId, submittedAt, source }) {
  return {
    品牌分组: `${form.brandName}｜${projectId}`,
    排序键: `${projectId}/01 客户提交/0001`,
    提交ID: form.submissionId,
    客户编号: clientId,
    项目编号: projectId,
    品牌名称: form.brandName,
    企业名称: form.companyName,
    一级行业: form.industry,
    细分业务: form.segment,
    官方渠道: form.officialChannel,
    主要市场: form.targetMarket.concat(form.targetMarketOther ? [form.targetMarketOther] : []).join('、'),
    核心业务: form.offerings,
    主要客户: form.audiences,
    核心优势: form.advantages,
    竞品或对标品牌: form.competitors,
    诊断目标: form.goals.join('、'),
    附件资料: form.uploads.map((item) => `${item.name || item.fileId}: ${item.url || item.fileId}`).join('\n'),
    联系人: form.contactName,
    联系方式: form.contactMethod,
    补充说明: form.message,
    隐私授权: form.privacyAccepted ? 'true' : 'false',
    提交时间: submittedAt,
    当前状态: '已提交',
    负责人: process.env.DEFAULT_OWNER || 'GeoGi 负责人',
    下一步动作: '等待 GeoGi OS 读取客户 Intake 并进入品牌研究流程',
    通知状态: '待处理',
    通知发送时间: '',
    通知错误: '',
    通知重试次数: '0',
    来源: source,
    审核状态: '待处理'
  };
}

function buildProjectFields({ form, clientId, projectId, submittedAt, leadRecordUrl }) {
  return {
    品牌分组: `${form.brandName}｜${projectId}`,
    排序键: `${projectId}/01 诊断项目/0001`,
    项目编号: projectId,
    客户编号: clientId,
    品牌名称: form.brandName,
    项目类型: 'GEO 诊断',
    当前阶段: '等待GeoGi OS处理',
    优先级: '普通',
    负责人: process.env.DEFAULT_OWNER || 'GeoGi 负责人',
    开始时间: submittedAt,
    预计交付时间: '',
    实际交付时间: '',
    客户确认范围: form.goals.join('、'),
    内部备注: leadRecordUrl ? `客户提交记录：${leadRecordUrl}\nMiniProgram仅负责Intake；后续业务处理由GeoGi OS负责。` : 'MiniProgram Intake',
    信息层级: '01 诊断项目',
    审核状态: '待处理'
  };
}

function makeProjectId(value) {
  const date = new Date(value || Date.now());
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const suffix = String(parseInt(crypto.randomBytes(4).toString('hex'), 16) % 1000000).padStart(6, '0');
  return `GG-P-${y}${m}-${suffix}`;
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.value) return String(value.value).trim();
    if (value.name) return String(value.name).trim();
  }
  return String(value || '').trim();
}

function fail(userMessage) {
  return { ok: false, userMessage };
}

module.exports = {
  submitCustomerIntake,
  sanitizeForm,
  validateForm
};
