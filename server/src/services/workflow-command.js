const {
  getTenantAccessToken,
  createBitableRecord,
  createBitableRecords,
  updateBitableRecord,
  listBitableRecords,
  sendWebhookText
} = require('./feishu');
const { generateDiagnosisAssets, buildDiagnosisContext } = require('./diagnosis-engine');
const { enrichConversationsWithSharedLinks } = require('./ai-share-extractor');

const AI_PLATFORMS = ['DeepSeek', 'Kimi', '豆包', '通义千问', '腾讯元宝'];

async function runWorkflowCommand(input = {}) {
  const commandText = clean(input.text || input.command || '');
  const projectId = clean(input.projectId || extractProjectId(commandText));

  if (!projectId) {
    return fail('请提供项目编号，例如：GG-P-202607-123456');
  }

  if (commandText.includes('查询') || input.action === 'status') {
    return queryProjectStatus(projectId);
  }

  if (commandText.includes('生成报告') || input.action === 'generate_report') {
    return generateReport({
      projectId,
      commandText,
      aiConversations: input.aiConversations || []
    });
  }

  if (commandText.includes('品牌信息补齐') || commandText.includes('问题生成') || input.action === 'generate_assets') {
    return generateBrandAssets(projectId);
  }

  return fail('未识别指令。可用指令：开始品牌信息补齐和问题生成、开始生成报告、查询项目状态');
}

async function generateBrandAssets(projectId) {
  const tenantToken = await getTenantAccessToken();
  const context = await loadProjectContext({ tenantToken, projectId });
  if (!context.ok) return context;

  const { form, leadRecord, projectRecord } = context;
  const submittedAt = text(leadRecord.fields.提交时间) || new Date().toISOString();
  const assets = generateDiagnosisAssets({ form, projectId, submittedAt });

  const brandProfileResult = await ensureSingleRecord({
    tenantToken,
    tableId: process.env.FEISHU_BRAND_PROFILE_TABLE_ID,
    projectId,
    fields: buildBrandProfileFields({ form, projectId, submittedAt })
  });
  const sourceResult = await refreshGeneratedRecords({
    tenantToken,
    tableId: process.env.FEISHU_SOURCES_TABLE_ID,
    projectId,
    records: assets.sources
  });
  const keywordResult = await refreshGeneratedRecords({
    tenantToken,
    tableId: process.env.FEISHU_KEYWORDS_TABLE_ID,
    projectId,
    records: assets.keywords
  });
  const questionResult = await refreshGeneratedRecords({
    tenantToken,
    tableId: process.env.FEISHU_QUESTIONS_TABLE_ID,
    projectId,
    records: assets.industryQuestions
  });
  const aiQuestionResult = await refreshGeneratedRecords({
    tenantToken,
    tableId: process.env.FEISHU_AI_QUESTION_TABLE_ID,
    projectId,
    records: assets.aiQuestions
  });

  await updateProjectAndLead({
    tenantToken,
    leadRecord,
    projectRecord,
    leadFields: {
      当前状态: '已生成诊断问题',
      下一步动作: '完成AI平台问答后，在飞书群触发开始生成报告'
    },
    projectFields: {
      当前阶段: '待AI平台问答',
      内部备注: appendNote(projectRecord && projectRecord.fields && projectRecord.fields.内部备注, `已生成品牌档案和P1诊断候选：${new Date().toISOString()}`)
    }
  });

  const summary = {
    brandProfile: brandProfileResult,
    sources: sourceResult,
    keywords: keywordResult,
    industryQuestions: questionResult,
    aiQuestions: aiQuestionResult
  };
  const message = [
    '【GeoGi 工作流】品牌信息补齐和问题生成已完成。',
    `项目编号：${projectId}`,
    `品牌：${form.brandName}`,
    `品牌档案：${brandProfileResult.created ? '已创建' : '已刷新'}`,
    `全网信源：新增 ${sourceResult.created} 条，刷新 ${sourceResult.updated} 条`,
    `品牌关键词：新增 ${keywordResult.created} 条，刷新 ${keywordResult.updated} 条`,
    `行业热门问题：新增 ${questionResult.created} 条，刷新 ${questionResult.updated} 条`,
    `AI检测问题：新增 ${aiQuestionResult.created} 条，刷新 ${aiQuestionResult.updated} 条`,
    '下一步：请在5个AI平台完成问答后，发送会话链接或回答原文，并触发“开始生成报告”。'
  ].join('\n');
  await notify(message);

  return {
    ok: true,
    projectId,
    status: '品牌信息补齐和问题生成已完成',
    summary
  };
}

async function generateReport({ projectId, commandText, aiConversations }) {
  const tenantToken = await getTenantAccessToken();
  const context = await loadProjectContext({ tenantToken, projectId });
  if (!context.ok) return context;

  const { form, leadRecord, projectRecord } = context;
  const parsedConversations = normalizeConversations({ commandText, aiConversations, form });
  if (!parsedConversations.length) {
    return fail('没有识别到AI平台问答。请附上平台名称和会话链接，最好同时粘贴回答原文。');
  }
  const conversations = await enrichConversationsWithSharedLinks(parsedConversations);

  const testedAt = new Date().toISOString();
  const testRecords = conversations.map((item, index) => buildTestRecord({
    item,
    index,
    form,
    projectId,
    testedAt
  }));
  await createBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_TEST_RECORDS_TABLE_ID,
    records: testRecords
  });

  const analyses = conversations.map((item) => buildAnalysisRecord({
    item,
    form,
    projectId
  }));
  await createBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_ANALYSIS_TABLE_ID,
    records: analyses
  });

  const report = buildReportFields({
    conversations,
    analyses,
    form,
    projectId,
    testedAt
  });
  await createBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_REPORTS_TABLE_ID,
    fields: report
  });

  await updateProjectAndLead({
    tenantToken,
    leadRecord,
    projectRecord,
    leadFields: {
      当前状态: '报告初稿已生成',
      下一步动作: '审核报告内容并准备客户交付'
    },
    projectFields: {
      当前阶段: '报告初稿已生成',
      实际交付时间: testedAt,
      内部备注: appendNote(projectRecord && projectRecord.fields && projectRecord.fields.内部备注, `报告初稿已生成：${testedAt}`)
    }
  });

  const needsAnswerText = conversations.filter((item) => !hasUsableAnswer(item)).length;
  const extracted = conversations.filter((item) => item.extractionStatus === '已自动读取').length;
  const partial = conversations.filter((item) => item.extractionStatus && item.extractionStatus !== '已自动读取').length;
  const message = [
    '【GeoGi 工作流】报告初稿已生成。',
    `项目编号：${projectId}`,
    `品牌：${form.brandName}`,
    `已整理AI平台记录：${conversations.length} 条`,
    `已生成分析结果：${analyses.length} 条`,
    extracted ? `自动读取分享链接：${extracted} 条` : '',
    partial ? `部分平台读取受限或只读到摘要：${partial} 条` : '',
    needsAnswerText ? `提醒：有 ${needsAnswerText} 条链接未读取到回答正文，报告结论已标记为待补充。` : 'AI回答原文已纳入分析。',
    '下一步：请在“报告管理”表中审核报告初稿。'
  ].filter(Boolean).join('\n');
  await notify(message);

  return {
    ok: true,
    projectId,
    status: '报告初稿已生成',
    conversations: conversations.length,
    needsAnswerText
  };
}

async function queryProjectStatus(projectId) {
  const tenantToken = await getTenantAccessToken();
  const context = await loadProjectContext({ tenantToken, projectId });
  if (!context.ok) return context;

  const counts = {};
  const tableMap = {
    客户与品牌: process.env.FEISHU_LEADS_TABLE_ID,
    诊断项目: process.env.FEISHU_PROJECTS_TABLE_ID,
    品牌基础档案: process.env.FEISHU_BRAND_PROFILE_TABLE_ID,
    全网信源: process.env.FEISHU_SOURCES_TABLE_ID,
    品牌关键词: process.env.FEISHU_KEYWORDS_TABLE_ID,
    行业热门问题: process.env.FEISHU_QUESTIONS_TABLE_ID,
    AI检测问题: process.env.FEISHU_AI_QUESTION_TABLE_ID,
    平台测试记录: process.env.FEISHU_TEST_RECORDS_TABLE_ID,
    回答分析结果: process.env.FEISHU_ANALYSIS_TABLE_ID,
    报告管理: process.env.FEISHU_REPORTS_TABLE_ID
  };

  for (const [name, tableId] of Object.entries(tableMap)) {
    counts[name] = tableId ? (await listByProject({ tenantToken, tableId, projectId })).length : 0;
  }

  const message = [
    '【GeoGi 工作流】项目状态查询',
    `项目编号：${projectId}`,
    `品牌：${context.form.brandName}`,
    `客户状态：${text(context.leadRecord.fields.当前状态) || '未记录'}`,
    `项目阶段：${context.projectRecord ? text(context.projectRecord.fields.当前阶段) : '未创建'}`,
    `信源 ${counts.全网信源} 条，关键词 ${counts.品牌关键词} 条，行业问题 ${counts.行业热门问题} 条，AI检测问题 ${counts.AI检测问题} 条`,
    `测试记录 ${counts.平台测试记录} 条，分析结果 ${counts.回答分析结果} 条，报告 ${counts.报告管理} 条`
  ].join('\n');
  await notify(message);

  return {
    ok: true,
    projectId,
    status: '查询完成',
    counts
  };
}

async function loadProjectContext({ tenantToken, projectId }) {
  const leadRecord = await findOneByProject({
    tenantToken,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    projectId
  });
  if (!leadRecord) return fail(`没有找到项目：${projectId}`);

  const projectRecord = await findOneByProject({
    tenantToken,
    tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
    projectId
  });

  return {
    ok: true,
    leadRecord,
    projectRecord,
    form: formFromLead(leadRecord.fields || {})
  };
}

function formFromLead(fields) {
  return {
    submissionId: text(fields.提交ID),
    clientId: text(fields.客户编号),
    brandName: text(fields.品牌名称),
    companyName: text(fields.企业名称),
    industry: text(fields.一级行业),
    segment: text(fields.细分业务),
    officialChannel: text(fields.官方渠道),
    targetMarket: splitList(text(fields.主要市场)),
    targetMarketOther: '',
    offerings: text(fields.核心业务),
    audiences: text(fields.主要客户),
    advantages: text(fields.核心优势),
    competitors: text(fields.竞品或对标品牌),
    goals: splitList(text(fields.诊断目标)).slice(0, 3),
    uploads: [],
    contactName: text(fields.联系人),
    contactMethod: text(fields.联系方式),
    message: text(fields.补充说明),
    privacyAccepted: true,
    submittedAt: text(fields.提交时间)
  };
}

function buildBrandProfileFields({ form, projectId, submittedAt }) {
  const context = buildDiagnosisContext(form);
  const officialUrls = extractUrls(context.officialChannel);
  const publicSources = [
    context.officialChannel ? `客户提供官方渠道：${context.officialChannel}` : `${context.brandName} 官网/公众号/小程序/视频号/抖音/小红书待核验`,
    ...context.profile.sourceAngles.slice(0, 5).map(([angle]) => `${context.brandName} ${angle}`),
    ...context.profile.purchaseCriteria.slice(0, 4).map((criterion) => `${context.brandName} ${context.profile.productWord} ${criterion}`)
  ];
  const riskNotes = context.profile.riskChecks.map((item) => `需核验${item}`).join('；');
  return {
    项目编号: projectId,
    客户编号: form.clientId,
    品牌标准名称: form.brandName,
    所属企业: form.companyName,
    行业: form.industry,
    细分业务: form.segment,
    目标市场: form.targetMarket.join('、'),
    '核心产品/服务': form.offerings,
    主要客户: form.audiences,
    品牌优势: form.advantages,
    官方渠道: form.officialChannel || (officialUrls[0] || '客户未提供，需优先补充官网、公众号、小程序或主流社媒官方账号'),
    公开信源: publicSources.join('\n'),
    竞品品牌: form.competitors || `待人工补充同品类${context.profile.productWord}品牌，用于对比AI推荐结果`,
    风险备注: riskNotes || '需核验官方主体、公开信息一致性、客户口碑和竞品压制情况',
    档案状态: '待核验',
    最后更新: submittedAt
  };
}

function buildTestRecord({ item, index, form, projectId, testedAt }) {
  const answer = clean(item.answer);
  const usableAnswer = hasUsableAnswer(item) ? answer : '';
  const extractionPrefix = item.extractionStatus
    ? `【链接读取状态】${item.extractionStatus}${item.extractionNote ? `：${item.extractionNote}` : ''}\n`
    : '';
  return {
    项目编号: projectId,
    问题编号: item.questionId || `MANUAL-${String(index + 1).padStart(2, '0')}`,
    平台: item.platform || '未标注平台',
    提问内容: item.question || '从会话链接整理，提问内容待补充',
    回答原文: answer ? `${extractionPrefix}${answer}` : `${extractionPrefix}已收到会话链接，但未读取到完整回答原文`,
    是否提到品牌: usableAnswer ? yesNo(usableAnswer.includes(form.brandName)) : '待判断',
    是否主动推荐: usableAnswer ? yesNo(usableAnswer.includes(form.brandName) && /推荐|可以考虑|适合|值得/.test(usableAnswer)) : '待判断',
    信息是否准确: usableAnswer ? yesNo(usableAnswer.includes(form.industry) || usableAnswer.includes(form.segment) || usableAnswer.includes(form.brandName)) : '待判断',
    提到的竞品: findCompetitors(usableAnswer, form.competitors),
    引用或信源: item.link || '',
    '证据截图/链接': item.link || '',
    测试时间: testedAt,
    测试人: 'GeoGi 工作流'
  };
}

function buildAnalysisRecord({ item, form, projectId }) {
  const answer = hasUsableAnswer(item) ? clean(item.answer) : '';
  const mentioned = answer && answer.includes(form.brandName);
  const recommended = mentioned && /推荐|可以考虑|适合|值得/.test(answer);
  const accurate = answer && (answer.includes(form.industry) || answer.includes(form.segment) || answer.includes(form.brandName));
  const competitorMentions = findCompetitors(answer, form.competitors);

  return {
    项目编号: projectId,
    平台: item.platform || '未标注平台',
    品牌识别得分: answer ? String(mentioned ? 80 : 20) : '待补充',
    主动推荐得分: answer ? String(recommended ? 75 : 30) : '待补充',
    信息准确得分: answer ? String(accurate ? 75 : 35) : '待补充',
    竞品压制情况: competitorMentions ? `回答中出现竞品：${competitorMentions}` : '未发现明显竞品压制',
    信源可信度: buildSourceCredibility(item),
    核心问题: answer ? buildCoreIssue({ mentioned, recommended, accurate }) : buildMissingAnswerIssue(item),
    优化建议: buildOptimizationAdvice({ form, mentioned, recommended, accurate, hasAnswer: Boolean(answer) }),
    分析状态: answer ? (item.extractionStatus ? `已生成初步分析（${item.extractionStatus}）` : '已生成初步分析') : '待补充回答原文'
  };
}

function buildReportFields({ conversations, analyses, form, projectId, testedAt }) {
  const answered = conversations.filter(hasUsableAnswer).length;
  const mentioned = conversations.filter((item) => hasUsableAnswer(item) && item.answer.includes(form.brandName)).length;
  const recommended = conversations.filter((item) => hasUsableAnswer(item) && item.answer.includes(form.brandName) && /推荐|可以考虑|适合|值得/.test(item.answer)).length;
  const reportSummary = [
    `本次共收到 ${conversations.length} 条AI平台问答线索，其中 ${answered} 条包含回答原文。`,
    `品牌被提及 ${mentioned} 次，出现主动推荐倾向 ${recommended} 次。`,
    buildExtractionSummary(conversations),
    answered < conversations.length ? '部分平台的分享页未暴露完整正文，需要换成公开可访问链接、截图或导出内容后再生成正式报告。' : '当前回答原文已可支撑初步报告。'
  ].join('\n');

  return {
    项目编号: projectId,
    客户编号: form.clientId,
    品牌名称: form.brandName,
    报告版本: `v-${Date.now()}`,
    报告状态: answered ? '报告初稿已生成' : '待补充回答原文',
    报告链接: '',
    交付说明: reportSummary,
    客户反馈: '',
    下一步建议: [
      '审核平台测试记录和回答分析结果。',
      `优先补充${form.brandName}的官网、案例、品牌介绍和可信第三方信源。`,
      '确认AI回答中说错、漏说或被竞品压制的内容，形成正式优化清单。'
    ].join('\n'),
    创建时间: testedAt,
    更新时间: testedAt
  };
}

function normalizeConversations({ commandText, aiConversations, form }) {
  const fromInput = Array.isArray(aiConversations)
    ? aiConversations.map((item) => ({
      platform: clean(item.platform),
      questionId: clean(item.questionId),
      question: clean(item.question),
      answer: clean(item.answer || item.answerText),
      link: clean(item.link || item.url)
    })).filter((item) => item.platform || item.answer || item.link)
    : [];
  if (fromInput.length) return fromInput;

  const lines = commandText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const result = [];
  let current = null;

  for (const line of lines) {
    const platform = AI_PLATFORMS.find((name) => line.includes(name));
    if (platform) {
      if (current) result.push(current);
      current = {
        platform,
        question: '',
        answer: '',
        link: extractFirstUrl(line)
      };
      continue;
    }
    if (!current) continue;
    if (/^提问[:：]/.test(line)) {
      current.question = line.replace(/^提问[:：]\s*/, '');
    } else if (/^回答原文[:：]/.test(line) || /^回答[:：]/.test(line)) {
      current.answer = line.replace(/^回答原文[:：]\s*/, '').replace(/^回答[:：]\s*/, '');
    } else if (extractFirstUrl(line)) {
      current.link = extractFirstUrl(line);
    } else if (current.answer) {
      current.answer = `${current.answer}\n${line}`;
    }
  }
  if (current) result.push(current);

  const linked = result.filter((item) => item.link || item.answer);
  return linked.length ? linked : extractUrls(commandText).map((link, index) => ({
    platform: AI_PLATFORMS[index] || '未标注平台',
    question: '',
    answer: '',
    link
  }));
}

async function updateProjectAndLead({ tenantToken, leadRecord, projectRecord, leadFields, projectFields }) {
  if (leadRecord) {
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_LEADS_TABLE_ID,
      recordId: leadRecord.record_id,
      fields: leadFields
    });
  }
  if (projectRecord) {
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_PROJECTS_TABLE_ID,
      recordId: projectRecord.record_id,
      fields: projectFields
    });
  }
}

async function ensureSingleRecord({ tenantToken, tableId, projectId, fields }) {
  const existing = await listByProject({ tenantToken, tableId, projectId });
  if (existing.length) {
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId,
      recordId: existing[0].record_id,
      fields
    });
    return { created: 0, updated: 1, skipped: existing.length - 1 };
  }
  await createBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    fields
  });
  return { created: 1, updated: 0, skipped: 0 };
}

async function createIfEmpty({ tenantToken, tableId, projectId, records }) {
  const existing = await listByProject({ tenantToken, tableId, projectId });
  if (existing.length) {
    return { created: 0, skipped: existing.length };
  }
  await createBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    records
  });
  return { created: records.length, skipped: 0 };
}

async function refreshGeneratedRecords({ tenantToken, tableId, projectId, records }) {
  const existing = await listByProject({ tenantToken, tableId, projectId });
  let updated = 0;
  let created = 0;
  const updateCount = Math.min(existing.length, records.length);

  for (let index = 0; index < updateCount; index += 1) {
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId,
      recordId: existing[index].record_id,
      fields: records[index]
    });
    updated += 1;
  }

  const remaining = records.slice(updateCount);
  if (remaining.length) {
    await createBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId,
      records: remaining
    });
    created = remaining.length;
  }

  return {
    created,
    updated,
    skipped: Math.max(existing.length - records.length, 0)
  };
}

async function findOneByProject({ tenantToken, tableId, projectId }) {
  if (!tableId) return null;
  const records = await listByProject({ tenantToken, tableId, projectId });
  return records[0] || null;
}

async function listByProject({ tenantToken, tableId, projectId }) {
  const records = await listBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    pageSize: 100
  });
  return records.filter((record) => text((record.fields || {}).项目编号).includes(projectId));
}

async function notify(message) {
  if (process.env.FEISHU_NOTIFY_WEBHOOK) {
    await sendWebhookText(message);
  }
}

function extractProjectId(value) {
  const match = String(value || '').match(/GG-P-\d{6}-\d{6}/);
  return match ? match[0] : '';
}

function extractUrls(value) {
  return String(value || '').match(/https?:\/\/[^\s，,、；;]+/g) || [];
}

function extractFirstUrl(value) {
  return extractUrls(value)[0] || '';
}

function splitList(value) {
  return String(value || '')
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function clean(value) {
  return String(value || '').trim();
}

function yesNo(value) {
  return value ? '是' : '否';
}

function findCompetitors(answer, competitors) {
  const names = splitList(competitors);
  return names.filter((name) => answer && answer.includes(name)).join('、');
}

function hasUsableAnswer(item) {
  const answer = clean(item && item.answer);
  if (!answer) return false;
  if (item.extractionStatus === '部分读取' && answer.length < 120) return false;
  return answer.length >= 80;
}

function buildSourceCredibility(item) {
  if (!item.link) return '未提供链接或引用来源';
  if (item.extractionStatus === '已自动读取') return '分享链接已自动读取，可作为本次诊断依据';
  if (item.extractionStatus === '部分读取') return `分享链接只读取到部分信息：${item.extractionNote || '未获得完整正文'}`;
  if (item.extractionStatus === '读取受限') return `分享链接读取受限：${item.extractionNote || '需要补充截图或原文'}`;
  return '有会话链接，需确认平台链接可访问';
}

function buildMissingAnswerIssue(item) {
  if (item.extractionNote) return `分享链接未读取到完整回答正文：${item.extractionNote}`;
  return '目前只有会话链接，缺少回答原文，无法完成深度诊断';
}

function buildExtractionSummary(conversations) {
  const extracted = conversations.filter((item) => item.extractionStatus === '已自动读取').length;
  const partial = conversations.filter((item) => item.extractionStatus === '部分读取').length;
  const blocked = conversations.filter((item) => item.extractionStatus === '读取受限').length;
  if (!extracted && !partial && !blocked) return '本次使用人工提供的回答原文进行分析。';
  return `分享链接自动读取结果：完整读取 ${extracted} 条，部分读取 ${partial} 条，读取受限 ${blocked} 条。`;
}

function buildCoreIssue({ mentioned, recommended, accurate }) {
  if (!mentioned) return 'AI回答未提及品牌，品牌可见度不足';
  if (!recommended) return 'AI能识别品牌，但主动推荐意愿不足';
  if (!accurate) return 'AI提到品牌，但业务理解或描述可能不完整';
  return 'AI已能识别品牌，需进一步强化可信信源和推荐理由';
}

function buildOptimizationAdvice({ form, mentioned, recommended, accurate, hasAnswer }) {
  if (!hasAnswer) return '补充AI回答原文后再进行准确诊断';
  const advice = [];
  if (!mentioned) advice.push(`补充${form.brandName}官网、品牌介绍和行业相关内容，提升AI识别概率`);
  if (!recommended) advice.push('增加客户案例、对比内容和第三方可信信源，提高AI主动推荐理由');
  if (!accurate) advice.push('统一品牌业务描述，减少AI误解或漏说');
  if (!advice.length) advice.push('继续补充高质量信源，并扩大平台测试问题覆盖范围');
  return advice.join('；');
}

function appendNote(current, note) {
  const value = text(current);
  return value ? `${value}\n${note}` : note;
}

function fail(userMessage) {
  return {
    ok: false,
    userMessage
  };
}

module.exports = {
  runWorkflowCommand
};
