const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');
const {
  findDeliveryPackage,
  projectDeliveryForCustomer
} = require('./delivery-package-store');
const {
  findPaymentByProject,
  publicPaymentView
} = require('./payment-store');

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
      const [deliveryPackage, payment] = await Promise.all([
        findDeliveryPackage({ clientId: cleanClientId, projectId }),
        findPaymentByProject(projectId)
      ]);
      return normalizeOrder({
        lead,
        project: projectById.get(projectId),
        deliveryPackage,
        payment
      });
    }))).filter(Boolean);

    orders.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    const notifications = orders
      .flatMap((order) => buildCustomerResultNotifications(order))
      .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
    return { ok: true, clientId: cleanClientId, orders, notifications };
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
    const [deliveryPackage, payment] = await Promise.all([
      findDeliveryPackage({ clientId: cleanClientId, projectId: cleanProjectId }),
      findPaymentByProject(cleanProjectId)
    ]);
    const order = normalizeOrder({ lead, project, deliveryPackage, payment });

    if (!deliveryPackage || !isPaidForReport(payment)) {
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
        status: '报告已完成',
        reportReady: true
      }
    };
  } catch (error) {
    console.error('getCustomerReport failed', error);
    return fail('报告读取失败，请稍后重试');
  }
}

function normalizeOrder({ lead, project, deliveryPackage, payment }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const paidForReport = isPaidForReport(payment);
  const reportReady = Boolean(deliveryPackage && paidForReport);
  const leadStatus = text(leadFields.当前状态);
  const projectStage = text(projectFields.当前阶段);
  const status = reportReady
    ? '报告已完成'
    : paymentStatusLabel(payment) || mapCustomerStatus({ projectStage, leadStatus });
  const deliveryView = deliveryPackage ? projectDeliveryForCustomer(deliveryPackage, {
    clientId: text(leadFields.客户编号),
    projectId: text(leadFields.项目编号) || text(projectFields.项目编号)
  }) : null;

  const paymentView = publicPaymentView(payment);

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
    paymentRequired: !(payment && payment.status === 'free'),
    payment: paymentView,
    paymentStatus: payment ? payment.status : 'unpaid',
    amountYuan: payment ? payment.amountYuan : 199,
    reportLink: reportReady && deliveryView ? deliveryView.reportLink : '',
    version: reportReady ? String(deliveryPackage.report_reference.report_version) : '',
    deliveryPackageId: reportReady ? deliveryPackage.delivery_package_id : '',
    canSupplement: canCustomerSupplement(payment, reportReady),
    nextAction: customerNextAction(status),
    updatedAt: reportReady ? deliveryPackage.released_at : (text(projectFields.开始时间) || text(leadFields.提交时间))
  };
}

function canCustomerSupplement(payment, reportReady) {
  if (reportReady) return false;
  const status = String(payment && payment.status || 'unpaid');
  return !['refund_processing', 'refunded'].includes(status);
}

function buildCustomerResultNotifications(order = {}) {
  const notifications = [];
  const payment = order.payment || {};
  const projectId = String(order.projectId || '');
  const clientId = String(order.clientId || '');
  const brandName = String(order.brandName || '品牌');
  const paymentStatus = String(order.paymentStatus || payment.status || '');

  if (order.reportReady) {
    notifications.push({
      id: ['report_ready', projectId, order.deliveryPackageId || order.version || order.completedAt].filter(Boolean).join(':'),
      type: 'report_ready',
      title: '诊断报告已完成',
      message: brandName + ' 的品牌 GEO 诊断报告已完成，可直接查看。',
      actionText: '查看报告',
      projectId,
      clientId,
      occurredAt: order.completedAt || order.updatedAt || ''
    });
  }

  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  const successfulRefunds = refunds.filter((refund) => String(refund.status || '').toLowerCase() === 'success');
  const latestSuccess = successfulRefunds.sort(
    (a, b) => String(b.successAt || b.requestedAt || '').localeCompare(String(a.successAt || a.requestedAt || ''))
  )[0] || null;

  if (paymentStatus === 'refunded') {
    notifications.push({
      id: ['refund_completed', projectId, latestSuccess && (latestSuccess.outRefundNo || latestSuccess.refundId) || payment.updatedAt].filter(Boolean).join(':'),
      type: 'refund_completed',
      title: '订单退款已完成',
      message: brandName + ' 的诊断订单已退款，退款结果以微信支付到账记录为准。',
      actionText: '查看订单',
      projectId,
      clientId,
      occurredAt: latestSuccess && (latestSuccess.successAt || latestSuccess.requestedAt) || payment.updatedAt || order.updatedAt || ''
    });
  } else if (paymentStatus === 'partially_refunded') {
    notifications.push({
      id: ['refund_partial', projectId, latestSuccess && (latestSuccess.outRefundNo || latestSuccess.refundId) || payment.updatedAt].filter(Boolean).join(':'),
      type: 'refund_partial',
      title: '订单已部分退款',
      message: brandName + ' 的诊断订单已完成部分退款，可查看订单了解当前服务状态。',
      actionText: '查看订单',
      projectId,
      clientId,
      occurredAt: latestSuccess && (latestSuccess.successAt || latestSuccess.requestedAt) || payment.updatedAt || order.updatedAt || ''
    });
  } else if (paymentStatus === 'refund_processing') {
    const latestRefund = refunds.sort(
      (a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || ''))
    )[0] || null;
    notifications.push({
      id: ['refund_processing', projectId, latestRefund && (latestRefund.outRefundNo || latestRefund.refundId) || payment.updatedAt].filter(Boolean).join(':'),
      type: 'refund_processing',
      title: '退款正在处理中',
      message: brandName + ' 的退款申请已提交，正在等待微信支付确认。',
      actionText: '查看订单',
      projectId,
      clientId,
      occurredAt: latestRefund && latestRefund.requestedAt || payment.updatedAt || order.updatedAt || ''
    });
  }

  return notifications;
}

function isPaidForReport(payment) {
  return Boolean(payment && ['paid', 'free', 'partially_refunded'].includes(String(payment.status || '')));
}

function paymentStatusLabel(payment) {
  if (!payment) return '待付款';
  const status = String(payment.status || '');
  if (status === 'unpaid' || status === 'payment_failed' || status === 'closed') return '待付款';
  if (status === 'paying') return '付款确认中';
  if (status === 'paid') return '已付款';
  if (status === 'free') return '已优惠至免费';
  if (status === 'refund_processing') return '退款处理中';
  if (status === 'partially_refunded') return '部分退款';
  if (status === 'refunded') return '已退款';
  return '';
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
  if (status === '待付款') return '完成当前订单付款后，GeoGi 才会开始本次品牌 GEO 诊断。';
  if (status === '付款确认中') return '付款结果正在确认，请稍后刷新。';
  if (status === '已付款') return '付款已确认，GeoGi 将开始品牌研究和 AI 平台检测。';
  if (status === '已优惠至免费') return '渠道专享优惠已生效，本次诊断无需付款，GeoGi 将开始品牌研究和 AI 平台检测。';
  if (status === '部分退款') return '订单已发生部分退款，剩余服务状态以当前项目进度为准。';
  if (status === '退款处理中') return '退款请求已提交，正在等待微信支付确认。';
  if (status === '已退款') return '本次订单已退款，如需重新诊断请重新提交资料。';
  if (status === '资料待补充') return '请补充诊断所需资料，必要时联系 GeoGi 顾问。';
  if (status === '资料建档中') return 'GeoGi 正在整理品牌企业资料并建立品牌画像。';
  if (status === '检测进行中') return 'GeoGi 正在执行主流 AI 平台检测。';
  if (status === '诊断分析中' || status === '诊断处理中') return 'GeoGi 正在分析检测结果并形成诊断结论。';
  if (status === '方案生成中') return 'GeoGi 正在整理诊断结果。';
  if (status === '优化实施中') return '后续优化服务正在执行中。';
  if (status === '效果复测中') return 'GeoGi 正在进行效果复测与结果评估。';
  if (status === '报告审核中') return '诊断报告正在审核，审核完成后即可查看。';
  if (status === '持续运营中') return '当前项目已进入持续监测服务。';
  if (status === '报告已完成') return '诊断报告已完成，可直接查看。';
  return '资料已提交，支付 199 元后开始正式诊断。';
}

function buildPendingReport({ order }) {
  return {
    status: order.status,
    reportReady: false,
    paymentRequired: !(order && order.paymentStatus === 'free'),
    payment: order.payment || null,
    reportLink: '',
    reportVersion: '',
    releasedAt: '',
    deliveryPackageId: '',
    deliveryContractVersion: '',
    deliveryMode: 'artifact_only',
    productionAuthority: 'geogi_os'
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
  buildPendingReport,
  isPaidForReport,
  canCustomerSupplement,
  buildCustomerResultNotifications,
  paymentStatusLabel
};
