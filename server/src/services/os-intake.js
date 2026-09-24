const crypto = require('crypto');
const {
  getTenantAccessToken,
  createBitableRecord,
  listBitableRecords
} = require('./feishu');
const { nextMonthlyId } = require('./counter');
const {
  createOrGetPaymentOrder,
  publicPaymentView
} = require('./payment-store');
const { notifyIntakeSubmitted } = require('./ops-notifications');

const REQUIRED_ENV = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_BASE_APP_TOKEN',
  'FEISHU_LEADS_TABLE_ID',
  'FEISHU_PROJECTS_TABLE_ID'
];

async function submitIntake(input = {}) {
  try {
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missing.length) return fail(`服务未完成配置：${missing.join(', ')}`);

    const form = sanitizeForm(input.form || {});
    const validationError = validateForm(form);
    if (validationError) return fail(validationError);

    const submittedAt = form.submittedAt || new Date().toISOString();
    const tenantToken = await getTenantAccessToken();
    const existing = await findExistingSubmission({ tenantToken, submissionId: form.submissionId });
    if (existing) {
      const fields = existing.fields || {};
      const clientId = text(fields.客户编号);
      const projectId = text(fields.项目编号);
      const paymentResult = await createOrGetPaymentOrder({
        clientId,
        projectId,
        submissionId: form.submissionId,
        brandName: text(fields.品牌名称) || form.brandName,
        phoneNumber: form.contactMethod
      });
      return {
        ok: true,
        duplicated: true,
        clientId,
        projectId,
        status: text(fields.当前状态) || '待付款',
        submittedAt: text(fields.提交时间) || submittedAt,
        paymentRequired: true,
        payment: publicPaymentView(paymentResult.order),
        productName: 'GeoGi 品牌 GEO 诊断报告',
        amountYuan: 199,
        currency: 'CNY',
        workbenchStatus: '等待客户支付'
      };
    }

    const clientId = await nextMonthlyId('GG', submittedAt);
    const projectId = makeProjectId(submittedAt);
    await createBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      fields: buildLeadFields({ form, clientId, projectId, submittedAt, source: input.source || 'wechat_miniprogram' })
    });

    if (process.env.FEISHU_PROJECTS_TABLE_ID) {
      await createBitableRecord({
        tenantToken,
        appToken: process.env.FEISHU_BASE_APP_TOKEN,
        tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
        fields: buildProjectFields({ form, clientId, projectId, submittedAt })
      });
    }

    const paymentResult = await createOrGetPaymentOrder({
      clientId,
      projectId,
      submissionId: form.submissionId,
      brandName: form.brandName,
      phoneNumber: form.contactMethod
    });

    notifyIntakeSubmitted({
      form,
      clientId,
      projectId,
      payment: paymentResult.order,
      submittedAt
    });

    return {
      ok: true,
      clientId,
      projectId,
      status: '待付款',
      submittedAt,
      paymentRequired: true,
      payment: publicPaymentView(paymentResult.order),
      productName: 'GeoGi 品牌 GEO 诊断报告',
      amountYuan: 199,
      currency: 'CNY',
      workbenchStatus: '等待客户支付'
    };
  } catch (error) {
    console.error('submitIntake failed', error);
    return fail('提交失败，请稍后重试');
  }
}

function sanitizeForm(form) {
  const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
  const cleanList = (value, maxItems = 10, maxText = 100) => Array.isArray(value)
    ? value.map((item) => cleanText(item, maxText)).filter(Boolean).slice(0, maxItems)
    : [];
  return {
    submissionId: cleanText(form.submissionId || crypto.randomUUID(), 120),
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
    competitors: cleanText(form.competitors, 5000),
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
  return value.slice(0, 10).map((item) => ({
    name: String(item && item.name || '').trim().slice(0, 160),
    fileId: String(item && item.fileId || '').trim().slice(0, 200),
    url: String(item && item.url || '').trim().slice(0, 1000)
  })).filter((item) => item.name || item.fileId || item.url);
}

function validateForm(form) {
  if (!form.brandName) return '请填写品牌名称';
  if (!form.industry) return '请选择所属行业';
  if (!form.segment) return '请填写细分业务领域';
  if (!form.targetMarket.length && !form.targetMarketOther) return '请选择或填写主要市场';
  if (!form.offerings) return '请填写核心产品或服务';
  if (!form.audiences) return '请填写主要客户与需求';
  if (!form.goals.length) return '请选择本次诊断目标';
  if (!form.contactName) return '请填写联系人';
  if (!form.contactMethod) return '请填写手机号或微信号';
  if (!form.privacyAccepted) return '提交前需要同意隐私说明';
  return '';
}

function buildLeadFields({ form, clientId, projectId, submittedAt, source }) {
  return {
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
    当前状态: '待付款',
    下一步动作: '支付 199 元后开始品牌 GEO 诊断',
    来源: source,
    审核状态: '待付款'
  };
}

function buildProjectFields({ form, clientId, projectId, submittedAt }) {
  return {
    项目编号: projectId,
    客户编号: clientId,
    品牌名称: form.brandName,
    项目类型: 'GEO 诊断',
    当前阶段: 'PAYMENT_PENDING',
    开始时间: submittedAt,
    客户确认范围: form.goals.join('、'),
    内部备注: '由微信小程序提交；客户支付 199 元后由 GeoGi OS 执行品牌 GEO 诊断并交付诊断报告。',
    信息层级: '01 诊断项目',
    审核状态: '待付款'
  };
}

async function findExistingSubmission({ tenantToken, submissionId }) {
  if (!submissionId) return null;
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    pageSize: 100
  });
  return records.find((record) => text(record.fields && record.fields.提交ID) === submissionId) || null;
}

function makeProjectId(isoTime) {
  const date = new Date(isoTime);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const random = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  return `GG-P-${y}${m}-${random}`;
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

function fail(userMessage) {
  return { ok: false, userMessage };
}

module.exports = { submitIntake, sanitizeForm, validateForm };
