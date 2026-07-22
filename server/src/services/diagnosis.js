const crypto = require('crypto');
const {
  getTenantAccessToken,
  createBitableRecord,
  updateBitableRecord,
  listBitableRecords,
  sendWebhookText,
  sendBotText,
  buildRecordUrl
} = require('./feishu');
const { nextMonthlyId } = require('./counter');

const REQUIRED_ENV = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_BASE_APP_TOKEN',
  'FEISHU_LEADS_TABLE_ID'
];

async function submitDiagnosis(input) {
  try {
    const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missingEnv.length) {
      return fail(`服务未完成配置：${missingEnv.join(', ')}`);
    }

    const form = sanitizeForm((input && input.form) || {});
    const validationError = validateForm(form);
    if (validationError) {
      return fail(validationError);
    }

    const submittedAt = form.submittedAt || new Date().toISOString();
    const tenantToken = await getTenantAccessToken();
    const existing = await findExistingSubmission({
      tenantToken,
      submissionId: form.submissionId
    });

    if (existing && isSameSubmission(existing.fields || {}, form)) {
      const clientId = text(existing.fields && existing.fields.客户编号);
      const projectId = text(existing.fields && existing.fields.项目编号);
      const existingSubmittedAt = text(existing.fields && existing.fields.提交时间) || submittedAt;
      const recordId = existing.record_id;
      const recordUrl = buildRecordUrl({
        recordId,
        appToken: process.env.FEISHU_BASE_APP_TOKEN,
        tableId: process.env.FEISHU_LEADS_TABLE_ID
      });
      let workbench = {
        ok: Boolean(projectId),
        status: '已存在客户提交记录'
      };

      if (text(existing.fields && existing.fields.当前状态) === '新提交') {
        workbench = await initializeReviewProject({
          tenantToken,
          form,
          clientId,
          projectId,
          submittedAt: existingSubmittedAt,
          leadRecordUrl: recordUrl
        });
        await updateBitableRecord({
          tenantToken,
          appToken: process.env.FEISHU_BASE_APP_TOKEN,
          tableId: process.env.FEISHU_LEADS_TABLE_ID,
          recordId,
          fields: {
            当前状态: '待人工审核',
            下一步动作: '人工审核资料后，在飞书群触发品牌信息补齐和问题生成'
          }
        });
      }

      return {
        ok: true,
        duplicated: true,
        clientId,
        projectId,
        status: text(existing.fields && existing.fields.当前状态) || '待人工审核',
        notificationStatus: text(existing.fields && existing.fields.通知状态),
        workbenchStatus: workbench.status,
        submittedAt: existingSubmittedAt,
        recordId,
        recordUrl
      };
    }

    if (existing) {
      form.submissionId = makeRetrySubmissionId(form.submissionId);
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
    const workbench = await initializeReviewProject({
      tenantToken,
      form,
      clientId,
      projectId,
      submittedAt,
      leadRecordUrl: recordUrl
    });

    const notification = await notifyWithRetry({
      tenantToken,
      form,
      clientId,
      projectId,
      submittedAt,
      recordUrl,
      workbench
    });

    if (recordId) {
      await updateBitableRecord({
        tenantToken,
        appToken: process.env.FEISHU_BASE_APP_TOKEN,
        tableId: process.env.FEISHU_LEADS_TABLE_ID,
        recordId,
        fields: {
          当前状态: workbench.ok ? '待人工审核' : '新提交',
          下一步动作: workbench.ok ? '人工审核资料后，在飞书群触发品牌信息补齐和问题生成' : '审核资料并补建诊断项目',
          通知状态: notification.status,
          通知发送时间: notification.sentAt,
          通知错误: notification.error,
          通知重试次数: String(notification.retryCount)
        }
      });
    }

    return {
      ok: true,
      clientId,
      projectId,
      status: workbench.ok ? '待人工审核' : '新提交',
      submittedAt,
      notificationStatus: notification.status,
      workbenchStatus: workbench.status,
      recordId,
      recordUrl
    };
  } catch (error) {
    console.error('submitDiagnosis failed', error);
    return fail('提交失败，请稍后重试');
  }
}

function sanitizeForm(form) {
  const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
  const cleanList = (value, maxItems = 10, maxText = 100) => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => cleanText(item, maxText)).filter(Boolean).slice(0, maxItems);
  };

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
    competitors: splitCompetitors(form.competitors).slice(0, 3).join('、'),
    goals: cleanList(form.goals, 3, 120),
    uploads: normalizeUploads(form.uploads),
    contactName: cleanText(form.contactName, 80),
    contactMethod: cleanText(form.contactMethod, 120),
    message: cleanText(form.message, 500),
    privacyAccepted: Boolean(form.privacyAccepted),
    submittedAt: cleanText(form.submittedAt, 80)
  };
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
    品牌分组: brandGroup(form, projectId),
    排序键: sortKey(form, projectId, '01 客户提交', 1),
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
    当前状态: '新提交',
    负责人: process.env.DEFAULT_OWNER || 'GeoGi 负责人',
    下一步动作: '审核资料并联系客户',
    通知状态: '待发送',
    通知发送时间: '',
    通知错误: '',
    通知重试次数: '0',
    来源: source,
    审核状态: '待人工审核'
  };
}

function isSameSubmission(existingFields, form) {
  const existingBrand = text(existingFields.品牌名称);
  const existingCompany = text(existingFields.企业名称);
  const existingIndustry = text(existingFields.一级行业);

  if (!existingBrand || existingBrand !== form.brandName) return false;
  if (form.companyName && existingCompany && existingCompany !== form.companyName) return false;
  if (form.industry && existingIndustry && existingIndustry !== form.industry) return false;
  return true;
}

function makeRetrySubmissionId(submissionId) {
  const base = String(submissionId || 'mp').slice(0, 80);
  return `${base}-retry-${Date.now()}`;
}

async function initializeReviewProject({ tenantToken, form, clientId, projectId, submittedAt, leadRecordUrl }) {
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  const projectTableId = process.env.FEISHU_PROJECTS_TABLE_ID;

  if (!projectTableId) {
    return {
      ok: false,
      status: '未配置诊断项目表ID'
    };
  }

  try {
    const existingProject = await findExistingProject({ tenantToken, tableId: projectTableId, projectId });
    if (existingProject) {
      return {
        ok: true,
        status: '诊断项目已存在，等待人工审核',
        projectRecordId: existingProject.record_id
      };
    }

    const projectRecord = await createBitableRecord({
      tenantToken,
      appToken,
      tableId: projectTableId,
      fields: buildProjectFields({ form, clientId, projectId, submittedAt, leadRecordUrl })
    });

    return {
      ok: true,
      status: '已创建诊断项目，等待人工审核',
      projectRecordId: projectRecord && projectRecord.record && projectRecord.record.record_id
    };
  } catch (error) {
    return {
      ok: false,
      status: `诊断项目创建失败：${(error && error.message ? error.message : String(error)).slice(0, 300)}`
    };
  }
}

async function findExistingProject({ tenantToken, tableId, projectId }) {
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return records.find((record) => text(record.fields && record.fields.项目编号).includes(projectId)) || null;
}

function buildProjectFields({ form, clientId, projectId, submittedAt, leadRecordUrl }) {
  return {
    品牌分组: brandGroup(form, projectId),
    排序键: sortKey(form, projectId, '01 诊断项目', 1),
    项目编号: projectId,
    客户编号: clientId,
    品牌名称: form.brandName,
    项目类型: 'GEO 诊断',
    当前阶段: '待人工审核',
    优先级: '普通',
    负责人: process.env.DEFAULT_OWNER || 'GeoGi 负责人',
    开始时间: submittedAt,
    预计交付时间: '',
    实际交付时间: '',
    客户确认范围: form.goals.join('、'),
    内部备注: leadRecordUrl ? `客户提交记录：${leadRecordUrl}\n审核后在飞书群触发：开始品牌信息补齐和问题生成 项目编号 ${projectId}` : '由小程序提交自动创建',
    信息层级: '01 诊断项目',
    审核状态: '待人工审核'
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

async function notifyWithRetry(payload) {
  const maxAttempts = 3;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await notify(payload);
      return {
        status: '已发送',
        sentAt: new Date().toISOString(),
        error: '',
        retryCount: attempt - 1
      };
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      if (attempt < maxAttempts) {
        await wait(attempt * 800);
      }
    }
  }

  return {
    status: '发送失败',
    sentAt: '',
    error: lastError.slice(0, 500),
    retryCount: maxAttempts
  };
}

async function notify({ tenantToken, form, clientId, projectId, submittedAt, recordUrl, workbench }) {
  const textBody = [
    '【GeoGi 新客户提交】收到新的品牌 AI 可见度诊断申请。',
    `品牌：${form.brandName}`,
    `行业：${form.industry} / ${form.segment}`,
    `核心业务：${form.offerings}`,
    `诊断目标：${form.goals.join('、')}`,
    `联系人：${form.contactName}`,
    `联系方式：${form.contactMethod}`,
    `提交时间：${submittedAt}`,
    `客户编号：${clientId}`,
    `项目编号：${projectId}`,
    workbench && workbench.status ? `工作台：${workbench.status}` : '',
    `下一步动作：${workbench && workbench.ok ? '请人工审核资料，审核后在群里触发品牌信息补齐和问题生成。' : '审核资料并联系客户。'}`,
    recordUrl ? `飞书记录：${recordUrl}` : ''
  ].filter(Boolean).join('\n');

  if (!process.env.FEISHU_NOTIFY_WEBHOOK && !process.env.FEISHU_NOTIFY_RECEIVE_ID) {
    throw new Error('未配置飞书通知 webhook 或接收人');
  }

  if (process.env.FEISHU_NOTIFY_WEBHOOK) {
    await sendWebhookText(textBody);
  }

  if (process.env.FEISHU_NOTIFY_RECEIVE_ID) {
    await sendBotText({ tenantToken, text: textBody });
  }
}

function normalizeUploads(uploads) {
  if (!Array.isArray(uploads)) return [];
  return uploads.slice(0, 3).map((item) => ({
    fileId: text(item.fileId).slice(0, 120),
    name: text(item.name).slice(0, 180),
    url: text(item.url).slice(0, 500),
    size: Number(item.size || 0)
  }));
}

function splitCompetitors(value) {
  return String(value || '')
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function brandGroup(form, projectId) {
  return `${form.brandName || '未命名品牌'}｜${projectId}`;
}

function sortKey(form, projectId, layer, order) {
  return [
    form.brandName || '未命名品牌',
    projectId,
    layer || '99',
    String(order || 0).padStart(3, '0')
  ].join('｜');
}

function text(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join('、');
  }
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.name) return String(value.name);
    if (value.value) return String(value.value);
    if (value.link) return String(value.link);
    return JSON.stringify(value);
  }
  return String(value || '').trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(userMessage) {
  return {
    ok: false,
    userMessage
  };
}

module.exports = {
  submitDiagnosis
};
