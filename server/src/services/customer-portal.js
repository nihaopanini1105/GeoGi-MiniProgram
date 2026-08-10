const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');

const REPORT_PLATFORMS = ['豆包', '元宝', '千问', 'DeepSeek', 'Kimi'];
const PUBLISHED_REPORT_STATUS = '已发布';
const CONFIRMED_REVIEW_STATUS = '已确认';

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
    const reports = await listByClient({
      tenantToken,
      tableId: process.env.FEISHU_REPORTS_TABLE_ID,
      clientId: cleanClientId
    });

    const projectById = new Map(projects.map((record) => [text(record.fields && record.fields.项目编号), record]));
    const reportByProject = new Map(reports.map((record) => [text(record.fields && record.fields.项目编号), record]));
    const orders = leads.map((lead) => {
      const fields = lead.fields || {};
      const projectId = text(fields.项目编号);
      return normalizeOrder({
        lead,
        project: projectById.get(projectId),
        report: reportByProject.get(projectId)
      });
    }).filter((item) => item.projectId);

    orders.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

    return {
      ok: true,
      clientId: cleanClientId,
      orders
    };
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
    const report = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_REPORTS_TABLE_ID,
      predicate: (fields) => text(fields.项目编号) === cleanProjectId && text(fields.客户编号) === cleanClientId
    });

    const order = normalizeOrder({ lead, project, report });
    if (!order.reportReady) {
      return {
        ok: true,
        order,
        report: buildPendingReport({ lead, project, report, order })
      };
    }

    const analyses = await listByProject({
      tenantToken,
      tableId: process.env.FEISHU_ANALYSIS_TABLE_ID,
      projectId: cleanProjectId
    });
    const tests = await listByProject({
      tenantToken,
      tableId: process.env.FEISHU_TEST_RECORDS_TABLE_ID,
      projectId: cleanProjectId
    });

    return {
      ok: true,
      order,
      report: buildReportTemplate({
        lead,
        project,
        report,
        analyses,
        tests
      })
    };
  } catch (error) {
    console.error('getCustomerReport failed', error);
    return fail('报告读取失败，请稍后重试');
  }
}

function normalizeOrder({ lead, project, report }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const reportFields = (report && report.fields) || {};
  const reportStatus = text(reportFields.报告状态);
  const reviewStatus = text(reportFields.审核状态);
  const projectStage = text(projectFields.当前阶段);
  const leadStatus = text(leadFields.当前状态);
  const rawReportLink = text(reportFields.报告链接);
  const reportReady = isPublishedReport({ reportStatus, reviewStatus, reportLink: rawReportLink });
  const status = mapCustomerStatus({ reportReady, reportStatus, reviewStatus, projectStage, leadStatus });

  return {
    clientId: text(leadFields.客户编号),
    projectId: text(leadFields.项目编号) || text(projectFields.项目编号) || text(reportFields.项目编号),
    brandName: text(leadFields.品牌名称) || text(projectFields.品牌名称) || text(reportFields.品牌名称),
    companyName: text(leadFields.企业名称),
    industry: text(leadFields.一级行业),
    segment: text(leadFields.细分业务),
    submittedAt: text(leadFields.提交时间) || text(projectFields.开始时间),
    completedAt: reportReady ? (text(reportFields.更新时间) || text(projectFields.实际交付时间)) : '',
    status,
    reportReady,
    reportLink: reportReady ? rawReportLink : '',
    version: reportReady ? text(reportFields.报告版本) : '',
    nextAction: customerNextAction(status),
    updatedAt: text(reportFields.更新时间) || text(projectFields.实际交付时间) || text(projectFields.开始时间)
  };
}

function isPublishedReport({ reportStatus, reviewStatus, reportLink }) {
  return reportStatus === PUBLISHED_REPORT_STATUS
    && reviewStatus === CONFIRMED_REVIEW_STATUS
    && Boolean(reportLink);
}

function mapCustomerStatus({ reportReady, reportStatus, reviewStatus, projectStage, leadStatus }) {
  if (reportReady) return '报告已完成';
  const combined = [reportStatus, reviewStatus, projectStage, leadStatus].filter(Boolean).join(' ');
  if (/待补充|补充材料|资料不全/.test(combined)) return '资料待补充';
  if (/报告初稿|报告待复核|报告审核|报告质检|待审核|待复核/.test(combined)) return '报告审核中';
  if (/AI|检测|测试|品牌资料|品牌档案|诊断问题|诊断中|处理中|生成中/.test(combined)) return '诊断处理中';
  return '已提交';
}

function customerNextAction(status) {
  if (status === '资料待补充') return '请补充诊断所需资料，必要时联系 GeoGi 顾问。';
  if (status === '诊断处理中') return 'GeoGi 正在完成品牌研究与 AI 平台检测。';
  if (status === '报告审核中') return '诊断已完成，报告正在进行人工审核。';
  if (status === '报告已完成') return '报告已发布，可查看完整诊断并预约报告解读。';
  return 'GeoGi 已收到资料，将进入诊断处理流程。';
}

function buildPendingReport({ lead, project, report, order }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const reportFields = (report && report.fields) || {};
  const brandName = text(leadFields.品牌名称) || text(projectFields.品牌名称) || text(reportFields.品牌名称);
  return {
    title: `${brandName || '品牌'} AI 可见度诊断`,
    status: order.status,
    version: '',
    createdAt: '',
    updatedAt: order.updatedAt,
    summary: order.nextAction,
    conclusion: '',
    overallScore: 0,
    dimensions: [],
    platforms: [],
    keyFindings: [],
    recommendations: [],
    scope: [
      `品牌：${brandName || '待确认'}`,
      `行业：${text(leadFields.一级行业) || '待确认'} / ${text(leadFields.细分业务) || '待确认'}`
    ],
    evidenceCount: 0,
    reportLink: ''
  };
}

function buildReportTemplate({ lead, project, report, analyses, tests }) {
  const leadFields = (lead && lead.fields) || {};
  const projectFields = (project && project.fields) || {};
  const reportFields = (report && report.fields) || {};
  const brandName = text(leadFields.品牌名称) || text(reportFields.品牌名称);
  const dimensions = buildDimensions(analyses);
  const overallScore = dimensions.length
    ? Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
    : 0;
  const platforms = buildPlatforms({ analyses, tests, brandName });
  const issueSummary = buildIssueSummary({ analyses, brandName });

  return {
    title: `${brandName || '品牌'} AI 可见度诊断报告`,
    status: '报告已完成',
    version: text(reportFields.报告版本),
    createdAt: text(reportFields.创建时间),
    updatedAt: text(reportFields.更新时间),
    summary: text(reportFields.交付说明) || 'GeoGi 已完成本次品牌 AI 可见度诊断。',
    overallScore,
    conclusion: buildConclusion({ overallScore, issueSummary, brandName }),
    dimensions,
    platforms,
    keyFindings: issueSummary.keyFindings,
    recommendations: splitLines(text(reportFields.下一步建议)).length
      ? splitLines(text(reportFields.下一步建议))
      : issueSummary.recommendations,
    scope: [
      `品牌：${brandName || '待确认'}`,
      `行业：${text(leadFields.一级行业) || '待确认'} / ${text(leadFields.细分业务) || '待确认'}`,
      `目标市场：${text(leadFields.主要市场) || '待确认'}`,
      `测试平台：${platforms.map((item) => item.name).join('、') || '待确认'}`
    ],
    evidenceCount: tests.length,
    reportLink: text(reportFields.报告链接)
  };
}

function buildDimensions(analyses) {
  const scores = analyses.map((record) => record.fields || {});
  if (!scores.length) return [];

  return [
    {
      key: 'brand',
      name: '品牌识别',
      score: average(scores.map((item) => numberText(item.品牌识别得分))),
      desc: 'AI 是否能识别品牌主体、业务和适用场景。'
    },
    {
      key: 'recommend',
      name: '主动推荐',
      score: average(scores.map((item) => numberText(item.主动推荐得分))),
      desc: '用户提出真实需求时，品牌是否进入推荐候选。'
    },
    {
      key: 'accuracy',
      name: '信息准确',
      score: average(scores.map((item) => numberText(item.信息准确得分))),
      desc: '回答中关于业务、优势、市场和品牌信息是否准确。'
    },
    {
      key: 'source',
      name: '信源可信',
      score: sourceScore(scores),
      desc: '回答是否有可追溯、可信赖的外部来源支撑。'
    }
  ].map((item) => ({
    ...item,
    level: scoreLevel(item.score)
  }));
}

function buildPlatforms({ analyses, tests, brandName }) {
  if (!tests.length && !analyses.length) return [];

  const analysisByPlatform = new Map();
  const analysesByPlatform = new Map();
  analyses.forEach((record) => {
    const fields = record.fields || {};
    const platform = canonicalPlatform(text(fields.平台));
    if (platform && !analysisByPlatform.has(platform)) analysisByPlatform.set(platform, fields);
    if (platform) {
      if (!analysesByPlatform.has(platform)) analysesByPlatform.set(platform, []);
      analysesByPlatform.get(platform).push(fields);
    }
  });

  const testsByPlatform = new Map();
  tests.forEach((record) => {
    const fields = record.fields || {};
    const platform = canonicalPlatform(text(fields.平台)) || '未标注平台';
    if (!testsByPlatform.has(platform)) testsByPlatform.set(platform, []);
    testsByPlatform.get(platform).push(fields);
  });

  return REPORT_PLATFORMS.map((platform) => {
    const platformTests = testsByPlatform.get(platform) || [];
    const representative = platformTests[0] || {};
    const platformAnalyses = analysesByPlatform.get(platform) || [];
    const analysis = platformAnalyses[0] || analysisByPlatform.get(platform) || {};
    const mentionedCount = platformTests.filter((fields) => text(fields.是否提到品牌) === '是').length;
    const recommendedCount = platformTests.filter((fields) => text(fields.是否主动推荐) === '是').length;
    const answer = text(representative.回答原文);

    return {
      name: platform,
      questionId: text(representative.问题编号),
      question: text(representative.提问内容) || '检测问题未展示',
      answerPreview: answer.slice(0, 260),
      mentioned: `${mentionedCount}/${platformTests.length || 0}`,
      recommended: `${recommendedCount}/${platformTests.length || 0}`,
      accurate: average(platformTests.map((fields) => yesScore(fields.信息是否准确))) ? '部分准确' : '待复核',
      competitors: firstValue(platformTests, '提到的竞品') || '未发现明显竞品压制',
      issue: text(analysis.核心问题) || (answer.includes(brandName) ? 'AI 已提到品牌，需结合推荐理由继续分析。' : 'AI 回答中品牌可见度不足。'),
      advice: text(analysis.优化建议),
      link: firstValue(platformTests, '证据截图/链接') || firstValue(platformTests, '引用或信源'),
      status: platformTests.length ? `已检测 ${platformTests.length} 条` : '无有效检测记录'
    };
  }).filter((item) => item.status !== '无有效检测记录');
}

function buildIssueSummary({ analyses, brandName }) {
  const keyFindings = analyses.map((record) => text(record.fields && record.fields.核心问题)).filter(Boolean);
  const recommendations = analyses.map((record) => text(record.fields && record.fields.优化建议)).filter(Boolean);
  if (!keyFindings.length) {
    return {
      keyFindings: ['正式报告已发布，具体结论请以 PDF 报告为准。'],
      recommendations: [`结合 ${brandName || '品牌'} 当前诊断结果制定后续 GEO 优化计划。`]
    };
  }
  return {
    keyFindings: unique(keyFindings).slice(0, 5),
    recommendations: unique(recommendations).slice(0, 5)
  };
}

function buildConclusion({ overallScore, issueSummary, brandName }) {
  if (!overallScore) return `${brandName || '品牌'}的正式诊断报告已发布，请查看报告正文。`;
  if (overallScore >= 75) return `${brandName || '品牌'}在 AI 平台已有一定识别基础，下一步重点是强化可信信源和推荐理由。`;
  if (overallScore >= 50) return `${brandName || '品牌'}已有部分平台识别，但主动推荐和信源支撑仍需要补强。`;
  return `${brandName || '品牌'}当前 AI 可见度偏弱，需要优先建设品牌实体信息、业务解释和第三方可信来源。`;
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

async function listByProject({ tenantToken, tableId, projectId }) {
  if (!tableId) return [];
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return records.filter((record) => text(record.fields && record.fields.项目编号) === projectId);
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

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return 0;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function sourceScore(scores) {
  const values = scores.map((item) => text(item.信源可信度));
  if (!values.length) return 0;
  const numeric = values.map((value) => {
    if (/已自动读取|可作为/.test(value)) return 72;
    if (/部分|复核/.test(value)) return 46;
    if (/受限|补充/.test(value)) return 28;
    return 50;
  });
  return average(numeric);
}

function scoreLevel(score) {
  if (!score) return '待检测';
  if (score >= 75) return '较好';
  if (score >= 55) return '可优化';
  return '待补强';
}

function numberText(value) {
  const match = text(value).match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

function yesScore(value) {
  const content = text(value);
  if (content === '是') return 80;
  if (content === '否') return 30;
  return NaN;
}

function firstValue(items, field) {
  for (const item of items || []) {
    const value = text(item && item[field]);
    if (value) return value;
  }
  return '';
}

function canonicalPlatform(value) {
  const content = text(value);
  const lowered = content.toLowerCase();
  if (content.includes('豆包') || lowered.includes('doubao')) return '豆包';
  if (content.includes('元宝') || lowered.includes('yuanbao') || lowered.includes('yb.tencent')) return '元宝';
  if (content.includes('千问') || lowered.includes('qianwen') || lowered.includes('qwen')) return '千问';
  if (lowered.includes('deepseek')) return 'DeepSeek';
  if (lowered.includes('kimi')) return 'Kimi';
  return content;
}

function splitLines(value) {
  return String(value || '')
    .split(/\n|；|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clean(value) {
  return String(value || '').trim();
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.name) return String(value.name);
    if (value.value) return String(value.value);
    if (value.link) return String(value.link);
    return JSON.stringify(value);
  }
  return String(value || '').trim();
}

function fail(userMessage) {
  return {
    ok: false,
    userMessage
  };
}

module.exports = {
  listCustomerProjects,
  getCustomerReport
};
