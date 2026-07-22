const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');

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
      const project = projectById.get(projectId);
      const report = reportByProject.get(projectId);
      return normalizeOrder({
        lead,
        project,
        report
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
    return fail('订单读取失败，请稍后重试');
  }
}

async function getCustomerReport({ clientId, projectId }) {
  try {
    const cleanClientId = clean(clientId);
    const cleanProjectId = clean(projectId);
    if (!cleanClientId || !cleanProjectId) return fail('缺少客户编号或项目编号');

    const tenantToken = await getTenantAccessToken();
    const lead = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      predicate: (fields) => text(fields.客户编号) === cleanClientId && text(fields.项目编号) === cleanProjectId
    });
    if (!lead) return fail('没有找到这条诊断订单');

    const project = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      predicate: (fields) => text(fields.项目编号) === cleanProjectId
    });
    const report = await findOne({
      tenantToken,
      tableId: process.env.FEISHU_REPORTS_TABLE_ID,
      predicate: (fields) => text(fields.项目编号) === cleanProjectId
    });
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
      order: normalizeOrder({ lead, project, report }),
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
  const projectStage = text(projectFields.当前阶段);
  const leadStatus = text(leadFields.当前状态);

  return {
    clientId: text(leadFields.客户编号),
    projectId: text(leadFields.项目编号) || text(projectFields.项目编号) || text(reportFields.项目编号),
    brandName: text(leadFields.品牌名称) || text(projectFields.品牌名称) || text(reportFields.品牌名称),
    companyName: text(leadFields.企业名称),
    industry: text(leadFields.一级行业),
    segment: text(leadFields.细分业务),
    submittedAt: text(leadFields.提交时间) || text(projectFields.开始时间),
    status: reportStatus || projectStage || leadStatus || '诊断准备中',
    reportReady: Boolean(reportStatus && !reportStatus.includes('待补充')),
    reportLink: text(reportFields.报告链接),
    reportStatus,
    projectStage,
    nextAction: text(leadFields.下一步动作) || text(reportFields.下一步建议),
    updatedAt: text(reportFields.更新时间) || text(projectFields.实际交付时间) || text(projectFields.开始时间)
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
    status: text(reportFields.报告状态) || text(projectFields.当前阶段) || '诊断中',
    version: text(reportFields.报告版本),
    createdAt: text(reportFields.创建时间),
    updatedAt: text(reportFields.更新时间),
    summary: text(reportFields.交付说明) || '报告正在生成中，完成后会展示诊断摘要、平台表现、问题证据和优化建议。',
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
      `测试平台：${platforms.map((item) => item.name).join('、') || '待测试'}`
    ],
    evidenceCount: tests.length,
    reportLink: text(reportFields.报告链接)
  };
}

function buildDimensions(analyses) {
  const scores = analyses.map((record) => record.fields || {});
  if (!scores.length) {
    return [
      { key: 'brand', name: '品牌识别', score: 0, level: '待检测', desc: '等待AI平台问答完成后生成。' },
      { key: 'recommend', name: '主动推荐', score: 0, level: '待检测', desc: '等待AI平台问答完成后生成。' },
      { key: 'accuracy', name: '信息准确', score: 0, level: '待检测', desc: '等待AI平台问答完成后生成。' },
      { key: 'source', name: '信源可信', score: 0, level: '待检测', desc: '等待AI平台问答完成后生成。' }
    ];
  }

  return [
    {
      key: 'brand',
      name: '品牌识别',
      score: average(scores.map((item) => numberText(item.品牌识别得分))),
      desc: 'AI是否能识别品牌主体、业务和适用场景。'
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
      desc: '回答中关于业务、优势、市场和联系方式是否准确。'
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
  const analysisByKey = new Map();
  const analysisByPlatform = new Map();
  analyses.forEach((record) => {
    const fields = record.fields || {};
    const platform = text(fields.平台);
    const questionId = text(fields.问题编号);
    if (platform && questionId) analysisByKey.set(`${platform}:${questionId}`, fields);
    if (platform && !analysisByPlatform.has(platform)) analysisByPlatform.set(platform, fields);
  });

  return tests.map((record) => {
    const fields = record.fields || {};
    const platform = text(fields.平台) || '未标注平台';
    const questionId = text(fields.问题编号);
    const analysis = analysisByKey.get(`${platform}:${questionId}`) || analysisByPlatform.get(platform) || {};
    const answer = text(fields.回答原文);
    const mentioned = text(fields.是否提到品牌);
    const recommended = text(fields.是否主动推荐);

    return {
      name: platform,
      questionId,
      question: text(fields.提问内容),
      answerPreview: answer.slice(0, 260),
      mentioned,
      recommended,
      accurate: text(fields.信息是否准确),
      competitors: text(fields.提到的竞品) || '未发现明显竞品压制',
      issue: text(analysis.核心问题) || (answer.includes(brandName) ? 'AI已提到品牌，需继续复核推荐理由。' : 'AI回答中品牌可见度不足。'),
      advice: text(analysis.优化建议),
      link: text(fields['证据截图/链接']) || text(fields.引用或信源),
      status: text(analysis.分析状态) || '待分析'
    };
  });
}

function buildIssueSummary({ analyses, brandName }) {
  const keyFindings = analyses.map((record) => text(record.fields && record.fields.核心问题)).filter(Boolean);
  const recommendations = analyses.map((record) => text(record.fields && record.fields.优化建议)).filter(Boolean);
  if (!keyFindings.length) {
    return {
      keyFindings: [
        '诊断报告尚未生成，当前订单仍处于资料审核或AI平台问答阶段。',
        '报告完成后，这里会展示品牌识别、主动推荐、信息准确和信源可信四类结论。'
      ],
      recommendations: [
        `优先补充${brandName || '品牌'}官网、品牌介绍、客户案例和可信第三方信源。`,
        '完成五个平台问答后，再进行正式报告复核。'
      ]
    };
  }
  return {
    keyFindings: unique(keyFindings).slice(0, 5),
    recommendations: unique(recommendations).slice(0, 5)
  };
}

function buildConclusion({ overallScore, issueSummary, brandName }) {
  if (!overallScore) return `${brandName || '品牌'}的诊断报告正在准备中。`;
  if (overallScore >= 75) return `${brandName || '品牌'}在AI平台已有一定识别基础，下一步重点是强化可信信源和推荐理由。`;
  if (overallScore >= 50) return `${brandName || '品牌'}已有部分平台识别，但主动推荐和信源支撑仍需要补强。`;
  return `${brandName || '品牌'}当前AI可见度偏弱，需要优先建设品牌实体信息、业务解释和第三方可信来源。`;
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
