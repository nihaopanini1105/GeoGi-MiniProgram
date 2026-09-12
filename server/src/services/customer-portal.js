const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');
const {
  findDeliveryPackage,
  projectDeliveryForCustomer
} = require('./delivery-package-store');

async function listCustomerProjects({ clientId }) {
  try {
    const cleanClientId = clean(clientId);
    if (!cleanClientId) return fail('缺少客户编号');

    const tenantToken = await getTenantAccessToken();
    const leads = await listByClient({
      tenantToken,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      clientId: cleanClientId
    });
    const projects = await listByClient({
      tenantToken,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      clientId: cleanClientId
    });
    const projectById = new Map(projects.map((record) => [text(record.fields && record.fields.项目编号), record]));

    const orders = (await Promise.all(leads.map(async (lead) => {
      const fields = lead.fields || {};
      const projectId = text(fields.项目编号);
      if (!projectId) return null;
      const deliveryPackage = await findDeliveryPackage({ clientId: cleanClientId, projectId });
      return normalizeOrder({
        lead,
        project: projectById.get(projectId),
        deliveryPackage
      });
    }))).filter(Boolean);

    orders.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return { ok: true, clientId: cleanClientId, orders };
  } catch (error) {
    console.error('listCustomerProjects failed', error);
    return fail('报告状态读取失败，请稍后重试');
  }
}

async function getCustomerReport({ clientId, projectId }) {
  try {
    const cleanClientId = clean(clientId);
    const cleanProjectId = clean(projectId);
    if (!cleanClientId || !cleanProjectId) return fail('缺少客户编号或诊断编号');

    const tenantToken = await getTenantAccessToken();
    const lead = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      predicate: (fields) => text(fields.客户编号) === cleanClientId && text(fields.项目编号) === cleanProjectId
    });
    if (!lead) return fail('没有找到这条诊断记录');

    const project = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      predicate: (fields) => text(fields.项目编号) === cleanProjectId && text(fields.客户编号) === cleanClientId
    });
    const deliveryPackage = await findDeliveryPackage({ clientId: cleanClientId, projectId: cleanProjectId });
    const order = normalizeOrder({ lead, project, deliveryPackage });

    if (!deliveryPackage) {
      return {
        ok: true,
        order,
        report: buildPendingReport({ lead, project, order })
      };
    }

    return {
      ok: true,
      order,
      report: {
        ...projectDeliveryForCustomer(deliveryPackage, {
          clientId: cleanClientId,
          projectId: cleanProjectId
        }),
        status: '报告已完成'
      }
    };
  } catch (error) {
    console.error('getCustomerReport failed', error);
    return fail('报告读取失败，请稍后重试');
  }
}

function normalizeOrder({ lead, project, deliveryPackage }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const reportReady = Boolean(deliveryPackage);
  const leadStatus = text(leadFields.当前状态);
  const projectStage = text(projectFields.当前阶段);
  const status = reportReady ? '报告已完成' : mapCustomerStatus({ projectStage, leadStatus });
  const summary = deliveryPackage ? projectDeliveryForCustomer(deliveryPackage, {
    clientId: text(leadFields.客户编号),
    projectId: text(leadFields.项目编号) || text(projectFields.项目编号)
  }) : null;

  return {
    clientId: text(leadFields.客户编号),
    projectId: text(leadFields.项目编号) || text(projectFields.项目编号),
    brandName: text(leadFields.品牌名称) || text(projectFields.品牌名称),
    companyName: text(leadFields.企业名称),
    industry: text(leadFields.一级行业),
    segment: text(leadFields.细分业务),
    submittedAt: text(leadFields.提交时间) || text(projectFields.开始时间),
    completedAt: reportReady ? deliveryPackage.released_at : '',
    status,
    reportReady,
    reportLink: summary ? summary.reportLink : '',
    version: reportReady ? String(deliveryPackage.report_reference.report_version) : '',
    deliveryPackageId: reportReady ? deliveryPackage.delivery_package_id : '',
    nextAction: customerNextAction(status),
    updatedAt: reportReady ? deliveryPackage.released_at : (text(projectFields.开始时间) || text(leadFields.提交时间))
  };
}

function mapCustomerStatus({ projectStage, leadStatus }) {
  const stage = String(projectStage || '').toUpperCase();
  const combined = [projectStage, leadStatus].filter(Boolean).join(' ');
  if (stage === 'BLOCKED' || /待补充|补充材料|资料不全/.test(combined)) return '资料待补充';
  if (stage === 'REVIEW' || /审核|复核|质检/.test(combined)) return '报告审核中';
  if (stage === 'RETEST' || /效果复测|复测中/.test(combined)) return '效果复测中';
  if (stage === 'IMPLEMENTATION' || /优化实施|实施中/.test(combined)) return '优化实施中';
  if (stage === 'SOLUTION' || /方案生成|优化方案/.test(combined)) return '方案生成中';
  if (stage === 'DIAGNOSIS' || /诊断分析/.test(combined)) return '诊断分析中';
  if (stage === 'DETECTION' || /检测进行|平台检测/.test(combined)) return '检测进行中';
  if (stage === 'ONBOARDING' || /资料建档/.test(combined)) return '资料建档中';
  if (stage === 'MONITORING' || /持续运营/.test(combined)) return '持续运营中';
  if (/处理中|运行中|CAPTURE|TEST|ANALYSIS|REPORT/.test(combined)) return '诊断处理中';
  return '已提交';
}

function customerNextAction(status) {
  if (status === '资料待补充') return '请补充诊断所需资料，必要时联系 GeoGi 顾问。';
  if (status === '资料建档中') return 'GeoGi OS 正在建立品牌与客户正式画像。';
  if (status === '检测进行中') return 'GeoGi OS 正在执行多平台检测与证据采集。';
  if (status === '诊断分析中' || status === '诊断处理中') return 'GeoGi OS 正在基于受治理证据形成诊断结论。';
  if (status === '方案生成中') return 'GeoGi OS 正在把诊断结果转成可实施优化方案。';
  if (status === '优化实施中') return '已批准的优化方案正在实施，并持续记录实施证据。';
  if (status === '效果复测中') return 'GeoGi OS 正在按同口径执行效果复测与结果评估。';
  if (status === '报告审核中') return '诊断与复测已进入报告审核，正式发布前仍会保持未交付状态。';
  if (status === '持续运营中') return 'GeoGi OS 已进入持续监测与周期复测服务。';
  if (status === '报告已完成') return '报告已由 GeoGi OS 正式发布，可查看或下载交付物。';
  return 'GeoGi 已收到资料，等待 OS 进入正式诊断流程。';
}

function buildPendingReport({ lead, project, order }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const brandName = text(leadFields.品牌名称) || text(projectFields.品牌名称);
  return {
    title: `${brandName || '品牌'} AI 可见度诊断`,
    status: order.status,
    version: '',
    createdAt: '',
    updatedAt: order.updatedAt,
    summary: order.nextAction,
    conclusion: '',
    overallScore: null,
    scoreStatus: '正式报告尚未发布，不形成客户侧综合评分。',
    dimensions: [],
    platforms: [],
    keyFindings: [],
    recommendations: [],
    limitations: [],
    risks: [],
    scope: [
      `品牌：${brandName || '待确认'}`,
      `行业：${text(leadFields.一级行业) || '待确认'} / ${text(leadFields.细分业务) || '待确认'}`
    ],
    evidenceCount: 0,
    reportLink: '',
    deliveryPackageId: '',
    releaseStatus: ''
  };
}

async function listByClient({ tenantToken, tableId, clientId }) {
  if (!tableId) return [];
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return records.filter((record) => text(record.fields && record.fields.客户编号) === clientId);
}

async function findOne({ tenantToken, tableId, predicate }) {
  if (!tableId) return null;
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return records.find((record) => predicate(record.fields || {})) || null;
}

function clean(value) {
  return String(value || '').trim().slice(0, 160);
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

function fail(userMessage) {
  return { ok: false, userMessage };
}

module.exports = {
  listCustomerProjects,
  getCustomerReport,
  normalizeOrder,
  mapCustomerStatus,
  customerNextAction,
  buildPendingReport
};
