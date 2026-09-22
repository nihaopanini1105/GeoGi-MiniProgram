const crypto = require('crypto');
const {
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord
} = require('./feishu');
const { importDeliveryPackage } = require('./delivery-package-store');

const PROJECT_STAGES = Object.freeze({
  PAYMENT_PENDING: { currentStatus: '待支付', auditStatus: '等待支付', nextAction: '完成 199 元支付后开始品牌 GEO 诊断' },
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
  BLOCKED: { currentStatus: '需要补充资料', auditStatus: '等待客户补充', nextAction: '请在小程序补充缺失资料后继续处理' },
  REFUNDED: { currentStatus: '已退款', auditStatus: '已退款', nextAction: '本次 199 元诊断服务已退款，项目停止' }
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
    submittedAt: text(fields.提交时间),
    currentStatus: text(fields.当前状态),
    nextAction: text(fields.下一步动作),
    auditStatus: text(fields.审核状态),
    source: text(fields.来源),
    paymentRequired: text(fields.支付要求) === 'true',
    productCode: text(fields.诊断产品代码),
    productName: text(fields.诊断产品),
    amountFen: Number(text(fields.应付金额分) || text(fields.支付金额分) || 0),
    amountYuan: text(fields.应付金额) || text(fields.支付金额),
    paymentStatus: (() => {
      const value = text(fields.支付状态);
      if (value === '已支付') return 'PAID';
      if (value === '退款处理中') return 'REFUND_PROCESSING';
      if (value === '已退款') return 'REFUNDED';
      if (value === '支付失败') return 'FAILED';
      if (value === '待支付') return 'PENDING';
      return value ? value.toUpperCase() : 'UNPAID';
    })(),
    outTradeNo: text(fields.支付商户订单号),
    transactionId: text(fields.微信支付单号),
    paymentCreatedAt: text(fields.支付创建时间),
    paidAt: text(fields.支付完成时间),
    paymentMethod: text(fields.支付方式),
    refundStatus: text(fields.退款状态),
    refundNo: text(fields.退款单号),
    wechatRefundId: text(fields.微信退款单号),
    refundReason: text(fields.退款原因),
    refundAmountFen: Number(text(fields.退款金额分) || 0),
    refundRequestedAt: text(fields.退款申请时间),
    refundCompletedAt: text(fields.退款完成时间),
    refundRequestedBy: text(fields.退款操作人)
  };
}

async function listOsIntakes() {
  if (!configured()) throw new OperationsBridgeError('OS_BRIDGE_NOT_CONFIGURED');
  const tenantToken = await getTenantAccessToken();
  const [leadRecords, projectRecords] = await Promise.all([
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_LEADS_TABLE_ID, pageSize: 100 }),
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_PROJECTS_TABLE_ID, pageSize: 100 })
  ]);
  const projects = new Map(projectRecords.map((record) => {
    const project = projectView(record);
    return [project.projectId, project];
  }));
  return leadRecords.map((record) => {
    const lead = leadView(record);
    return { ...lead, project: projects.get(lead.projectId) || null };
  }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

async function updateOsProjectStage({ projectId, stage }) {
  const stageConfig = PROJECT_STAGES[String(stage || '').toUpperCase()];
  if (!stageConfig) throw new OperationsBridgeError('OS_BRIDGE_STAGE_INVALID');
  if (!projectId) throw new OperationsBridgeError('OS_BRIDGE_PROJECT_ID_REQUIRED');
  const tenantToken = await getTenantAccessToken();
  const [leadRecords, projectRecords] = await Promise.all([
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_LEADS_TABLE_ID, pageSize: 100 }),
    listBitableRecords({ tenantToken, appToken: process.env.FEISHU_BASE_APP_TOKEN, tableId: process.env.FEISHU_PROJECTS_TABLE_ID, pageSize: 100 })
  ]);
  const lead = leadRecords.find((record) => text(record.fields && record.fields.项目编号) === projectId);
  const project = projectRecords.find((record) => text(record.fields && record.fields.项目编号) === projectId);
  if (!lead || !project) throw new OperationsBridgeError('OS_BRIDGE_PROJECT_NOT_FOUND');

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
  const result = await importDeliveryPackage(packageDocument);
  await updateOsProjectStage({ projectId: packageDocument.project_id, stage: 'RELEASED' });
  return {
    imported: result.imported,
    idempotent: result.idempotent,
    deliveryPackageId: packageDocument.delivery_package_id,
    projectId: packageDocument.project_id,
    clientId: packageDocument.client_id
  };
}

module.exports = {
  PROJECT_STAGES,
  OperationsBridgeError,
  configured,
  requireOsBridge,
  listOsIntakes,
  updateOsProjectStage,
  publishOsDeliveryPackage
};
