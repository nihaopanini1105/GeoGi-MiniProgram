'use strict';

const {
  getTenantAccessToken,
  listBitableRecords
} = require('./feishu');

const PLATFORM_MAP = new Map([
  ['DeepSeek', 'deepseek'],
  ['deepseek', 'deepseek'],
  ['Kimi', 'kimi'],
  ['kimi', 'kimi'],
  ['豆包', 'doubao'],
  ['doubao', 'doubao'],
  ['通义千问', 'tongyi_qianwen'],
  ['千问', 'tongyi_qianwen'],
  ['qianwen', 'tongyi_qianwen'],
  ['腾讯元宝', 'tencent_yuanbao'],
  ['元宝', 'tencent_yuanbao'],
  ['yuanbao', 'tencent_yuanbao']
]);

const CANONICAL_PLATFORMS = [
  'doubao',
  'deepseek',
  'tencent_yuanbao',
  'tongyi_qianwen',
  'kimi'
];

const APPROVED_REVIEW_STATUSES = new Set([
  '已确认',
  '已批准',
  '审核通过',
  '通过',
  'approved'
]);

const REQUIRED_TABLES = [
  'FEISHU_LEADS_TABLE_ID',
  'FEISHU_PROJECTS_TABLE_ID',
  'FEISHU_QUESTIONS_TABLE_ID',
  'FEISHU_AI_QUESTION_TABLE_ID'
];

async function buildOsIntakeHandoff({ projectId, allowUnreviewed = false } = {}) {
  const cleanProjectId = clean(projectId);
  if (!cleanProjectId) throw new Error('缺少项目编号');

  const missing = REQUIRED_TABLES.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`缺少飞书表配置：${missing.join(', ')}`);
  }

  const tenantToken = await getTenantAccessToken();
  const [leadRows, projectRows, brandRows, questionRows, aiQuestionRows] = await Promise.all([
    listProjectRows({ tenantToken, tableId: process.env.FEISHU_LEADS_TABLE_ID, projectId: cleanProjectId }),
    listProjectRows({ tenantToken, tableId: process.env.FEISHU_PROJECTS_TABLE_ID, projectId: cleanProjectId }),
    process.env.FEISHU_BRAND_PROFILE_TABLE_ID
      ? listProjectRows({ tenantToken, tableId: process.env.FEISHU_BRAND_PROFILE_TABLE_ID, projectId: cleanProjectId })
      : Promise.resolve([]),
    listProjectRows({ tenantToken, tableId: process.env.FEISHU_QUESTIONS_TABLE_ID, projectId: cleanProjectId }),
    listProjectRows({ tenantToken, tableId: process.env.FEISHU_AI_QUESTION_TABLE_ID, projectId: cleanProjectId })
  ]);

  if (!leadRows.length) throw new Error(`没有找到客户提交记录：${cleanProjectId}`);
  if (!projectRows.length) throw new Error(`没有找到诊断项目：${cleanProjectId}`);
  if (!aiQuestionRows.length) throw new Error(`项目尚未生成 AI 检测问题：${cleanProjectId}`);

  const lead = leadRows[0].fields || {};
  const project = projectRows[0].fields || {};
  const brand = (brandRows[0] && brandRows[0].fields) || {};
  const clientId = text(lead.客户编号) || text(project.客户编号);
  if (!clientId) throw new Error(`项目缺少客户编号：${cleanProjectId}`);

  const industryReviewByText = new Map();
  for (const row of questionRows) {
    const fields = row.fields || {};
    const questionText = text(fields.问题);
    if (!questionText) continue;
    industryReviewByText.set(questionText, {
      included: text(fields.是否纳入检测) !== '否',
      reviewStatus: text(fields.审核状态),
      priority: text(fields.优先级),
      questionType: text(fields.问题类型),
      userScenario: text(fields.用户场景)
    });
  }

  const grouped = new Map();
  for (const row of aiQuestionRows) {
    const fields = row.fields || {};
    const queryText = text(fields.检测问题);
    const platform = canonicalPlatform(text(fields.目标平台));
    if (!queryText || !platform) continue;

    const sourceQuestionId = logicalQuestionId(text(fields.问题编号), queryText);
    const key = `${sourceQuestionId}::${queryText}`;
    if (!grouped.has(key)) {
      const review = industryReviewByText.get(queryText) || {};
      grouped.set(key, {
        sourceQuestionId,
        queryText,
        questionType: text(fields.问题类型) || review.questionType || '',
        userScenario: review.userScenario || '',
        priority: review.priority || '',
        expectedSignal: text(fields.预期识别点),
        detectionStatus: text(fields.检测状态),
        sourceReviewStatus: review.reviewStatus || text(fields.审核状态),
        included: review.included !== false,
        platforms: [],
        platformQuestionIds: {}
      });
    }

    const item = grouped.get(key);
    if (!item.platforms.includes(platform)) item.platforms.push(platform);
    item.platformQuestionIds[platform] = text(fields.问题编号);
  }

  const allQuestions = [...grouped.values()]
    .filter((item) => item.included)
    .map((item) => {
      const sourcePlatforms = CANONICAL_PLATFORMS.filter((platform) => item.platforms.includes(platform));
      const missingSourcePlatforms = CANONICAL_PLATFORMS.filter((platform) => !sourcePlatforms.includes(platform));
      return {
        ...item,
        // The reviewed logical query is the source of execution semantics. Historical
        // workbench rows may be missing one duplicated platform row; V1 still expands
        // every selected query to the canonical five-platform scope while retaining
        // the source-row gap as audit metadata instead of fabricating a source record.
        sourcePlatforms,
        missingSourcePlatforms,
        platforms: [...CANONICAL_PLATFORMS],
        reviewStatus: isApproved(item.sourceReviewStatus) ? 'approved' : 'needs_review'
      };
    })
    .sort((a, b) => questionOrder(a.sourceQuestionId) - questionOrder(b.sourceQuestionId));

  const approvedQuestions = allQuestions.filter((item) => item.reviewStatus === 'approved');
  const selectedQuestions = allowUnreviewed ? allQuestions : approvedQuestions;

  if (!selectedQuestions.length) {
    throw new Error(
      allowUnreviewed
        ? `项目没有可执行的 AI 检测问题：${cleanProjectId}`
        : `H4 尚未批准任何问题。请先在“行业热门问题”表将审核状态改为“已确认/已批准”，或联调时使用 --allow-unreviewed。`
    );
  }

  const missingPlatformRows = selectedQuestions.filter(
    (item) => item.missingSourcePlatforms.length > 0
  );

  return {
    handoffVersion: '1.0.0',
    handoffType: 'geogi_customer_delivery_os_intake',
    sourceSystem: 'geogi_miniprogram_feishu',
    generatedAt: new Date().toISOString(),
    project: {
      projectId: cleanProjectId,
      clientId,
      brandName: text(lead.品牌名称) || text(brand.品牌标准名称),
      companyName: text(lead.企业名称) || text(brand.所属企业),
      industry: text(lead.一级行业) || text(brand.行业),
      segment: text(lead.细分业务) || text(brand.细分业务),
      officialChannel: text(lead.官方渠道) || text(brand.官方渠道),
      targetMarkets: splitList(text(lead.主要市场) || text(brand.目标市场)),
      offerings: text(lead.核心业务) || text(brand['核心产品/服务']),
      audiences: text(lead.主要客户) || text(brand.主要客户),
      advantages: text(lead.核心优势) || text(brand.品牌优势),
      competitors: splitList(text(lead.竞品或对标品牌) || text(brand.竞品品牌)),
      goals: splitList(text(lead.诊断目标)),
      submittedAt: text(lead.提交时间),
      projectStage: text(project.当前阶段),
      projectReviewStatus: text(project.审核状态)
    },
    brandProfile: {
      category: text(brand.品类定位),
      featuredProduct: text(brand.客户提供产品),
      productOwnershipAssessment: text(brand.产品归属判断),
      publicSources: splitLines(text(brand.公开信源)),
      riskNotes: splitList(text(brand.风险备注)),
      reviewStatus: text(brand.审核状态)
    },
    platforms: CANONICAL_PLATFORMS,
    questions: selectedQuestions,
    review: {
      h4Required: true,
      allowUnreviewed,
      totalQuestionCount: allQuestions.length,
      approvedQuestionCount: approvedQuestions.length,
      exportedQuestionCount: selectedQuestions.length,
      missingPlatformQuestionIds: missingPlatformRows.map((item) => item.sourceQuestionId),
      missingPlatformDetails: missingPlatformRows.map((item) => ({
        sourceQuestionId: item.sourceQuestionId,
        missingSourcePlatforms: item.missingSourcePlatforms
      }))
    }
  };
}

async function listProjectRows({ tenantToken, tableId, projectId }) {
  if (!tableId) return [];
  const rows = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return rows.filter((row) => text((row.fields || {}).项目编号).includes(projectId));
}

function canonicalPlatform(value) {
  const raw = clean(value);
  return PLATFORM_MAP.get(raw) || '';
}

function logicalQuestionId(rawId, queryText) {
  const match = clean(rawId).match(/^(Q\d{3})/i);
  if (match) return match[1].toUpperCase();
  let hash = 2166136261;
  for (const char of String(queryText || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `Q-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function questionOrder(value) {
  const match = clean(value).match(/Q(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function isApproved(value) {
  return APPROVED_REVIEW_STATUSES.has(clean(value));
}

function splitList(value) {
  return String(value || '')
    .split(/[、,，;；\n\r]/)
    .map(clean)
    .filter(Boolean);
}

function splitLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean);
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.name) return String(value.name).trim();
    if (value.value) return String(value.value).trim();
    if (value.link) return String(value.link).trim();
    return JSON.stringify(value);
  }
  return String(value || '').trim();
}

function clean(value) {
  return String(value || '').trim();
}

module.exports = {
  CANONICAL_PLATFORMS,
  buildOsIntakeHandoff,
  canonicalPlatform,
  logicalQuestionId
};
