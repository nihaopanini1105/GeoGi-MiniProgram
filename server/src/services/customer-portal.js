'use strict';

const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');
const { normalizePhone } = require('./customer-auth');
const { readDeliveryPackage, publicArtifactUrl } = require('./delivery-package-store');

async function listCustomerProjects({ clientId, customer } = {}) {
  try {
    const cleanClientId = clean(clientId);
    const phone = normalizePhone(customer && customer.phoneNumber);
    if (!phone) return fail('客户身份无效');

    const tenantToken = await getTenantAccessToken();
    const leads = await listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      pageSize: 100
    });
    const ownedLeads = leads.filter((record) => {
      const fields = record.fields || {};
      const ownedByPhone = normalizePhone(fields.联系方式) === phone;
      const matchesRequestedClient = !cleanClientId || text(fields.客户编号) === cleanClientId;
      return ownedByPhone && matchesRequestedClient;
    });
    if (!ownedLeads.length) return fail('没有找到当前手机号对应的诊断记录');

    const ownedClientIds = Array.from(new Set(
      ownedLeads
        .map((record) => text(record.fields && record.fields.客户编号))
        .filter(Boolean)
    ));
    const ownedProjectIds = new Set(
      ownedLeads
        .map((record) => text(record.fields && record.fields.项目编号))
        .filter(Boolean)
    );

    const projects = process.env.FEISHU_PROJECTS_TABLE_ID
      ? await listBitableRecords({
        tenantToken,
        appToken: process.env.FEISHU_BASE_APP_TOKEN,
        tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
        pageSize: 100
      })
      : [];
    const projectById = new Map(
      projects
        .filter((record) => {
          const fields = record.fields || {};
          const projectId = text(fields.项目编号);
          const projectClientId = text(fields.客户编号);
          return ownedProjectIds.has(projectId)
            && (!projectClientId || ownedClientIds.includes(projectClientId));
        })
        .map((record) => [text(record.fields && record.fields.项目编号), record])
    );

    const orders = ownedLeads.map((lead) => {
      const projectId = text(lead.fields && lead.fields.项目编号);
      const deliveryPackage = readDeliveryPackage(projectId);
      return normalizeOrder({ lead, project: projectById.get(projectId), deliveryPackage });
    }).filter((item) => item.projectId);

    orders.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return {
      ok: true,
      clientId: cleanClientId || ownedClientIds[0] || '',
      clientIds: ownedClientIds,
      orders
    };
  } catch (error) {
    console.error('listCustomerProjects failed', error);
    return fail('报告状态读取失败，请稍后重试');
  }
}

async function getCustomerReport({ clientId, projectId, customer } = {}) {
  try {
    const cleanClientId = clean(clientId);
    const cleanProjectId = clean(projectId);
    const phone = normalizePhone(customer && customer.phoneNumber);
    if (!cleanClientId || !cleanProjectId) return fail('缺少客户编号或诊断编号');
    if (!phone) return fail('客户身份无效');

    const tenantToken = await getTenantAccessToken();
    const lead = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      predicate: (fields) => text(fields.客户编号) === cleanClientId
        && text(fields.项目编号) === cleanProjectId
        && normalizePhone(fields.联系方式) === phone
    });
    if (!lead) return fail('没有找到当前手机号对应的诊断记录');

    const project = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      predicate: (fields) => text(fields.项目编号) === cleanProjectId && text(fields.客户编号) === cleanClientId
    });
    const deliveryPackage = readDeliveryPackage(cleanProjectId);
    const order = normalizeOrder({ lead, project, deliveryPackage });

    if (!order.reportReady) {
      return {
        ok: true,
        order,
        report: buildPendingReport({ lead, project, order })
      };
    }

    if (String(deliveryPackage.external_client_id || '') !== cleanClientId) {
      return fail('报告归属校验失败');
    }

    return {
      ok: true,
      order,
      report: buildReleasedReport(deliveryPackage, order)
    };
  } catch (error) {
    console.error('getCustomerReport failed', error);
    return fail('报告读取失败，请稍后重试');
  }
}

function normalizeOrder({ lead, project, deliveryPackage }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const reportReady = Boolean(deliveryPackage && deliveryPackage.release_status === 'released');
  const status = reportReady ? '报告已完成' : mapPendingStatus({
    projectStage: text(projectFields.当前阶段),
    leadStatus: text(leadFields.当前状态)
  });
  const pdf = reportReady ? selectArtifact(deliveryPackage, 'pdf') : null;

  return {
    clientId: text(leadFields.客户编号),
    projectId: text(leadFields.项目编号) || text(projectFields.项目编号),
    brandName: text(leadFields.品牌名称) || text(projectFields.品牌名称),
    companyName: text(leadFields.企业名称),
    industry: text(leadFields.一级行业),
    segment: text(leadFields.细分业务),
    submittedAt: text(leadFields.提交时间) || text(projectFields.开始时间),
    completedAt: reportReady ? String(deliveryPackage.released_at || '') : '',
    status,
    reportReady,
    reportLink: pdf ? publicArtifactUrl(pdf.uri) : '',
    version: reportReady ? String(deliveryPackage.report_reference && deliveryPackage.report_reference.report_version || '') : '',
    nextAction: customerNextAction(status),
    updatedAt: reportReady ? String(deliveryPackage.released_at || '') : (text(projectFields.实际交付时间) || text(projectFields.开始时间))
  };
}

function mapPendingStatus({ projectStage, leadStatus }) {
  const combined = [projectStage, leadStatus].filter(Boolean).join(' ');
  if (/待补充|补充材料|资料不全/.test(combined)) return '资料待补充';
  if (/审核|质检|待复核/.test(combined)) return '报告审核中';
  if (/AI|检测|测试|品牌|问题|诊断|处理中|生成中|OS处理/.test(combined)) return '诊断处理中';
  return '已提交';
}

function customerNextAction(status) {
  if (status === '资料待补充') return '请补充诊断所需资料，必要时联系 GeoGi 顾问。';
  if (status === '诊断处理中') return 'GeoGi OS 正在完成品牌研究、平台检测与诊断。';
  if (status === '报告审核中') return '诊断已完成，正式交付物正在审核。';
  if (status === '报告已完成') return 'GeoGi OS 已发布正式交付物，可直接查看。';
  return 'GeoGi 已收到资料，将进入 OS 诊断处理流程。';
}

function buildPendingReport({ lead, project, order }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const brandName = text(leadFields.品牌名称) || text(projectFields.品牌名称);
  return {
    title: `${brandName || '品牌'} GEO 诊断`,
    status: order.status,
    version: '',
    updatedAt: order.updatedAt,
    summary: order.nextAction,
    reportLink: '',
    previewImageUrl: '',
    artifacts: []
  };
}

function buildReleasedReport(deliveryPackage, order) {
  const summary = deliveryPackage.display_summary || {};
  const pdf = selectArtifact(deliveryPackage, 'pdf');
  const preview = selectArtifact(deliveryPackage, 'thumbnail') || selectArtifact(deliveryPackage, 'report_page_image');
  return {
    title: String(summary.title || `${order.brandName || '品牌'} GEO 诊断报告`),
    status: '报告已完成',
    version: String(deliveryPackage.report_reference && deliveryPackage.report_reference.report_version || ''),
    updatedAt: String(deliveryPackage.released_at || ''),
    summary: String(summary.status_label || 'GeoGi OS 已完成并发布正式客户交付物。'),
    overallScore: typeof summary.overall_score === 'number' ? summary.overall_score : null,
    confidence: typeof summary.confidence === 'number' ? summary.confidence : null,
    reportLink: pdf ? publicArtifactUrl(pdf.uri) : '',
    previewImageUrl: preview ? publicArtifactUrl(preview.uri) : '',
    artifacts: (deliveryPackage.artifacts || []).map((artifact) => ({
      artifactId: artifact.artifact_id,
      type: artifact.artifact_type,
      mimeType: artifact.mime_type,
      fileName: artifact.file_name,
      sha256: artifact.sha256,
      url: publicArtifactUrl(artifact.uri)
    })).filter((artifact) => artifact.url),
    deliveryPackageId: deliveryPackage.delivery_package_id,
    reportId: deliveryPackage.report_reference && deliveryPackage.report_reference.report_id,
    packageHash: deliveryPackage.package_hash,
    versionPins: deliveryPackage.version_pins || {}
  };
}

function selectArtifact(deliveryPackage, type) {
  return (deliveryPackage && Array.isArray(deliveryPackage.artifacts))
    ? deliveryPackage.artifacts.find((item) => item && item.artifact_type === type && publicArtifactUrl(item.uri)) || null
    : null;
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

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.value) return String(value.value).trim();
    if (value.name) return String(value.name).trim();
  }
  return String(value || '').trim();
}

function clean(value) {
  return String(value || '').trim();
}

function fail(userMessage) {
  return { ok: false, userMessage };
}

module.exports = {
  listCustomerProjects,
  getCustomerReport
};
