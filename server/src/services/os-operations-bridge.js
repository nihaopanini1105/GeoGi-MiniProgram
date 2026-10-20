const crypto = require('crypto');
const {
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord
} = require('./feishu');
const { importDeliveryPackage } = require('./delivery-package-store');
const { findPaymentByProject, publicPaymentView, markProjectReportReleased } = require('./payment-store');
const { reconcileCommission } = require('./channel-service');
const { assessV2ReleaseEligibility, PAID_DIAGNOSTIC_LAUNCH_CUTOFF } = require('./os-v2-release-eligibility');

const LEGACY_PAYMENT_EXEMPTION_REASON = 'submitted_before_paid_diagnostic_launch';

const PROJECT_STAGES = Object.freeze({
  INTAKE: { currentStatus: '已提交', auditStatus: '待 OS 处理', nextAction: '等待 GeoGi OS 接收项目并执行诊断' },
  ONBOARDING: { currentStatus: '资料建档中', auditStatus: 'OS 处理中', nextAction: 'GeoGi OS 正在建立客户与品牌基础档案' },
  DETECTION: { currentStatus: '检测进行中', auditStatus: 'OS 处理中', nextAction: 'GeoGi OS 正在执行多平台检测与证据采集' },
  DIAGNOSIS: { currentStatus: '诊断分析中', auditStatus: 'OS 处理中', nextAction: 'GeoGi OS 正在生成诊断结论与优化机会' },
  SOLUTION: { currentStatus: '方案生成中', auditStatus: 'OS 处理中', nextAction: 'GeoGi OS 正在生成优化方案与实施计划' },
  IMPLEMENTATION: { currentStatus: '优化实施中', auditStatus: 'OS 处理中', nextAction: 'GeoGi OS 正在执行已批准优化方案并记录实施证据' },
  RETEST: { currentStatus: '效果复测中', auditStatus: 'OS 处理中', nextAction: 'GeoGi OS 正在按同口径执行效果复测与结果评估' },
  REVIEW: { currentStatus: '报告审核中', auditStatus: '待内部审核', nextAction: 'GeoGi 团队正在完成 QA 与交付审核' },
  RELEASED: { currentStatus: '报告已交付', auditStatus: '已交付', nextAction: '可在小程序查看正式诊断报告' },
  MONITORING: { currentStatus: '持续运营中', auditStatus: '持续服务', nextAction: 'GeoGi OS 按服务计划持续监测与复测' },
  BLOCKED: { currentStatus: '需要补充资料', auditStatus: '等待客户补充', nextAction: '请在小程序补充缺失资料后继续处理' }
});

class OperationsBridgeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function configured() {
  return Boolean(
    process.env.GEOGI_OS_BRIDGE_TOKEN &&
    process.env.FEISHU_APP_ID &&
    process.env.FEISHU_APP_SECRET &&
    process.env.FEISHU_BASE_APP_TOKEN &&
    process.env.FEISHU_LEADS_TABLE_ID &&
    process.env.FEISHU_PROJECTS_TABLE_ID
  );
}

function requireOsBridge(req, res, next) {
  const expected = String(process.env.GEOGI_OS_BRIDGE_TOKEN || '');
  if (!expected) return res.status(503).json({ ok: false, error: 'OS_BRIDGE_NOT_CONFIGURED' });
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (!supplied || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'OS_BRIDGE_UNAUTHORIZED' });
  }
  next();
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

function splitLines(value) {
  return text(value).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}
function legacyPaymentExemption(submittedAt) {
  const submittedMs = Date.parse(String(submittedAt || ''));
  const cutoffMs = Date.parse(PAID_DIAGNOSTIC_LAUNCH_CUTOFF);
  const eligible = Number.isFinite(submittedMs) && submittedMs < cutoffMs;
  return {
    eligible,
    reason: eligible ? LEGACY_PAYMENT_EXEMPTION_REASON : '',
    cutoffAt: PAID_DIAGNOSTIC_LAUNCH_CUTOFF
  };
}


function projectView(record) {
  const fields = record.fields || {};
  return {
    recordId: record.record_id || record.recordId || '',
    projectId: text(fields.项目编号),
    clientId: text(fields.客户编号),
    brandName: text(fields.品牌名称),
    stage: text(fields.当前阶段) || 'INTAKE',
    auditStatus: text(fields.审核状态),
    startedAt: text(fields.开始时间),
    customerScope: text(fields.客户确认范围),
    internalNote: text(fields.内部备注)
  };
}

function leadView(record) {
  const fields = record.fields || {};
  return {
    recordId: record.record_id || record.recordId || '',
    submissionId: text(fields.提交ID),
    projectId: text(fields.项目编号),
    clientId: text(fields.客户编号),
    brandName: text(fields.品牌名称),
    companyName: text(fields.企业名称),
    industry: text(fields.一级行业),
    segment: text(fields.细分业务),
    officialChannel: text(fields.官方渠道),
    market: text(fields.主要市场),
    offerings: text(fields.核心业务),
    audiences: text(fields.主要客户),
    advantages: text(fields.核心优势),
    competitors: text(fields.竞品或对标品牌),
    goals: text(fields.诊断目标),
    attachments: splitLines(fields.附件资料),
    contactName: text(fields.联系人),
    contactMethod: text(fields.联系方式),
    message: text(fields.补充说明),
    submittedAt: text(fields.提交时间),
    currentStatus: text(fields.当前状态),
    nextAction: text(fields.下一步动作),
    auditStatus: text(fields.审核状态),
    source: text(fields.来源)
  };
}

async function listOsIntakes() {
  if (!configured()) throw new OperationsBridgeError('OS_BRIDGE_NOT_CONFIGURED');
  const tenantToken = await getTenantAccessToken();
  const [leadRecords, projectRecords] = await Promise.all([
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_LEADS_TABLE_ID, pageSize: 100 }),
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_PROJECTS_TABLE_ID, pageSize: 100 })
  ]);
  // Never let a Feishu Map silently turn duplicate rows into CRM authority.
  const scopeKey = (clientId,projectId) => JSON.stringify([clientId,projectId]);
  const projectCounts = new Map(), leadCounts = new Map();
  const projects = new Map(projectRecords.map((record) => {
    const project = projectView(record),key=scopeKey(project.clientId,project.projectId);
    projectCounts.set(key,(projectCounts.get(key)||0)+1);
    return [key,project];
  }));
  for (const record of leadRecords) {
    const fields=record.fields||{},key=scopeKey(text(fields.客户编号),text(fields.项目编号));
    leadCounts.set(key,(leadCounts.get(key)||0)+1);
  }
  const items = await Promise.all(leadRecords.map(async (record) => {
    const lead = leadView(record);
    const candidate = await findPaymentByProject(lead.projectId);
    const payment = candidate && candidate.clientId === lead.clientId
      && candidate.projectId === lead.projectId ? candidate : null;
    const paymentView = publicPaymentView(payment);
    const paid = Boolean(payment && ['paid', 'partially_refunded'].includes(payment.status));
    const freeChannelOffer = Boolean(payment && payment.status === 'free' && payment.channelId && payment.sourceId);
    const legacyExemption = legacyPaymentExemption(lead.submittedAt);
    const legacyEligible = legacyExemption.eligible && !paid;
    const scope=scopeKey(lead.clientId,lead.projectId);
    const crmScopeUnique=Boolean(lead.clientId && lead.projectId &&
      leadCounts.get(scope)===1 && projectCounts.get(scope)===1);
    return {
      ...lead,
      project: crmScopeUnique ? projects.get(scope) : null,
      crmScopeUnique,
      payment: paymentView,
      paymentRequired: !crmScopeUnique || (!legacyEligible && !freeChannelOffer),
      paymentEligibleForProcessing: crmScopeUnique && (paid || freeChannelOffer || legacyEligible),
      paymentAdmissionMode: !crmScopeUnique ? 'crm_scope_ambiguous' :
        (paid ? 'paid' : (freeChannelOffer ? 'channel_offer' : (legacyEligible ? 'legacy_pre_payment' : 'payment_required'))),
      legacyPaymentExemption: legacyExemption
    };
  }));
  return items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

async function verifiedOsProjectTarget({ clientId = '', projectId }) {
  if (!projectId) throw new OperationsBridgeError('OS_BRIDGE_PROJECT_ID_REQUIRED');
  const tenantToken = await getTenantAccessToken();
  const [leadRecords, projectRecords] = await Promise.all([
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_LEADS_TABLE_ID, pageSize: 100 }),
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_PROJECTS_TABLE_ID, pageSize: 100 })
  ]);
  // The historical OS stage API may omit clientId. Such calls are safe only
  // if BOTH Feishu tables have exactly one row for this project, and they
  // identify the same customer. A specified clientId must match that owner.
  const projectMatches = (records) => records.filter((record) =>
    text(record.fields && record.fields.项目编号) === projectId);
  const leads = projectMatches(leadRecords), projects = projectMatches(projectRecords);
  if (leads.length !== 1 || projects.length !== 1)
    throw new OperationsBridgeError('OS_BRIDGE_PROJECT_SCOPE_AMBIGUOUS');
  const lead = leads[0], project = projects[0];
  const leadClient = text(lead.fields && lead.fields.客户编号);
  const projectClient = text(project.fields && project.fields.客户编号);
  if (!leadClient || leadClient !== projectClient || (clientId && clientId !== leadClient))
    throw new OperationsBridgeError('OS_BRIDGE_PROJECT_SCOPE_MISMATCH');
  return { tenantToken, lead, project };
}

async function updateOsProjectStage({ clientId = '', projectId, stage }) {
  const stageConfig = PROJECT_STAGES[String(stage || '').toUpperCase()];
  if (!stageConfig) throw new OperationsBridgeError('OS_BRIDGE_STAGE_INVALID');
  const { tenantToken, lead, project }=await verifiedOsProjectTarget({clientId,projectId});

  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    recordId: lead.record_id || lead.recordId,
    fields: {
      当前状态: stageConfig.currentStatus,
      下一步动作: stageConfig.nextAction,
      审核状态: stageConfig.auditStatus
    }
  });
  await updateBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
    recordId: project.record_id || project.recordId,
    fields: {
      当前阶段: String(stage).toUpperCase(),
      审核状态: stageConfig.auditStatus
    }
  });
  return { projectId, stage: String(stage).toUpperCase(), ...stageConfig };
}

async function publishOsDeliveryPackage(packageDocument) {
  if (!packageDocument || !packageDocument.client_id || !packageDocument.project_id)
    throw new OperationsBridgeError('OS_BRIDGE_DELIVERY_SCOPE_REQUIRED');
  // Reject incorrect customer ownership and payment scope BEFORE persisting
  // a delivery package or mutating the customer's RELEASED stage.
  const target=await verifiedOsProjectTarget({
    clientId:packageDocument.client_id,projectId:packageDocument.project_id
  });
  const candidatePayment=await findPaymentByProject(packageDocument.project_id);
  if (candidatePayment && (candidatePayment.clientId !== packageDocument.client_id
      || candidatePayment.projectId !== packageDocument.project_id))
    throw new OperationsBridgeError('OS_BRIDGE_PAYMENT_SCOPE_MISMATCH');
  // Successful validation of a release package is not proof of payment.
  // Keep explicit legacy prelaunch and exact GeoGi pilot exceptions, but
  // never import a postlaunch unpaid V2 diagnostic report.
  const eligibility=assessV2ReleaseEligibility({
    packageDocument,leadRecord:target.lead,payment:candidatePayment,
    legacyCutoffAt:PAID_DIAGNOSTIC_LAUNCH_CUTOFF
  });
  if (!eligibility.allowed)
    throw new OperationsBridgeError('OS_BRIDGE_V2_RELEASE_NOT_ELIGIBLE');
  const result = await importDeliveryPackage(packageDocument);
  await updateOsProjectStage({ clientId: packageDocument.client_id, projectId: packageDocument.project_id, stage: 'RELEASED' });
  const payment = await markProjectReportReleased(
    packageDocument.project_id,
    packageDocument.released_at,
    packageDocument.client_id
  );
  const commission = payment
    ? await reconcileCommission({ order: payment, releasedAt: packageDocument.released_at })
    : null;
  return {
    status:'published',
    imported: result.imported,
    idempotent: result.idempotent,
    deliveryPackageId: packageDocument.delivery_package_id,
    projectId: packageDocument.project_id,
    clientId: packageDocument.client_id,
    commission
  };
}

module.exports = {
  PROJECT_STAGES,
  PAID_DIAGNOSTIC_LAUNCH_CUTOFF,
  LEGACY_PAYMENT_EXEMPTION_REASON,
  legacyPaymentExemption,
  OperationsBridgeError,
  configured,
  requireOsBridge,
  listOsIntakes,
  updateOsProjectStage,
  publishOsDeliveryPackage
};
