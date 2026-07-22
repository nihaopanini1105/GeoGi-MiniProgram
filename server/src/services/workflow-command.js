const {
  getTenantAccessToken,
  createBitableRecord,
  createBitableRecords,
  updateBitableRecord,
  deleteBitableRecords,
  listBitableRecords,
  sendWebhookText
} = require('./feishu');
const { generateDiagnosisAssets, buildDiagnosisContext } = require('./diagnosis-engine');
const { enrichConversationsWithSharedLinks } = require('./ai-share-extractor');
const { generateReportPdf } = require('./report-pdf');

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
  const linkedConversations = await enrichConversationsWithSharedLinks(parsedConversations);
  const conversations = expandConversationTurns(linkedConversations);

  const testedAt = new Date().toISOString();
  const testRecords = conversations.map((item, index) => buildTestRecord({
    item,
    index,
    form,
    projectId,
    testedAt
  }));
  const testReplace = await replaceProjectRecords({
    tenantToken,
    tableId: process.env.FEISHU_TEST_RECORDS_TABLE_ID,
    projectId,
    records: testRecords
  });

  const analyses = conversations.map((item) => buildAnalysisRecord({
    item,
    form,
    projectId
  }));
  const analysisReplace = await replaceProjectRecords({
    tenantToken,
    tableId: process.env.FEISHU_ANALYSIS_TABLE_ID,
    projectId,
    records: analyses
  });

  const report = buildReportFields({
    conversations,
    analyses,
    form,
    projectId,
    testedAt
  });
  const pdfResult = await generateReportPdf({
    projectId,
    form,
    conversations,
    analyses,
    report,
    testedAt
  });
  if (pdfResult.ok) {
    report.报告链接 = pdfResult.url;
  } else {
    report.交付说明 = `${report.交付说明}\nPDF生成状态：${pdfResult.userMessage || '生成失败，需检查服务器PDF依赖。'}`;
  }

  const removedReports = await clearProjectRecords({
    tenantToken,
    tableId: process.env.FEISHU_REPORTS_TABLE_ID,
    projectId
  });
  const reportResult = await createBitableRecord({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_REPORTS_TABLE_ID,
    fields: report
  });
  const reportRecordId = reportResult && reportResult.record && reportResult.record.record_id;
  if (pdfResult.ok && reportRecordId) {
    await updateBitableRecord({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId: process.env.FEISHU_REPORTS_TABLE_ID,
      recordId: reportRecordId,
      fields: {
        报告链接: pdfResult.url,
        更新时间: testedAt
      }
    });
  }

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
  const extracted = linkedConversations.filter((item) => item.extractionStatus === '已自动读取').length;
  const partial = linkedConversations.filter((item) => item.extractionStatus && item.extractionStatus !== '已自动读取').length;
  const message = [
    '【GeoGi 工作流】报告初稿已生成。',
    `项目编号：${projectId}`,
    `品牌：${form.brandName}`,
    `已读取AI平台分享链接：${linkedConversations.length} 条`,
    `已拆分问答记录：${conversations.length} 条`,
    `已生成分析结果：${analyses.length} 条`,
    `飞书记录刷新：平台测试删除旧版 ${testReplace.deleted} 条，回答分析删除旧版 ${analysisReplace.deleted} 条，报告删除旧版 ${removedReports} 条`,
    extracted ? `自动读取分享链接：${extracted} 条` : '',
    partial ? `部分平台读取受限或只读到摘要：${partial} 条` : '',
    needsAnswerText ? `提醒：有 ${needsAnswerText} 条链接未读取到回答正文，报告结论已标记为待补充。` : 'AI回答原文已纳入分析。',
    pdfResult.ok ? `PDF报告：${pdfResult.url}` : `PDF生成提醒：${pdfResult.userMessage || '生成失败，需在服务器检查PDF组件。'}`,
    '下一步：请在“报告管理”表中审核报告初稿，也可以直接打开PDF链接检查客户交付版。'
  ].filter(Boolean).join('\n');
  await notify(message);

  return {
    ok: true,
    projectId,
    status: '报告初稿已生成',
    conversations: conversations.length,
    needsAnswerText,
    pdfUrl: pdfResult.ok ? pdfResult.url : ''
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
  const featuredProduct = context.profile.featuredProduct || form.offerings || '';
  return {
    品牌分组: brandGroup(form, projectId),
    排序键: sortKey(form, projectId, '02 品牌基础档案', 1),
    项目编号: projectId,
    客户编号: form.clientId,
    品牌标准名称: form.brandName,
    所属企业: form.companyName,
    行业: form.industry,
    细分业务: form.segment,
    品类定位: context.profile.categoryName,
    客户提供产品: featuredProduct,
    产品归属判断: featuredProduct ? `“${featuredProduct}”按客户资料暂定为${form.brandName}的产品、系列或服务候选，不作为行业通用品类；需通过官方渠道和公开信源核验。` : '客户未单独提供产品名称，按核心产品/服务进行核验。',
    产品核验任务: featuredProduct ? [
      `${form.brandName} ${featuredProduct} 官方`,
      `${featuredProduct} ${form.brandName} 价格 口碑 卖点`,
      `${featuredProduct} 是什么 ${context.profile.productWord}`
    ].join('\n') : `${form.brandName} ${context.profile.productWord} 官方 产品 服务`,
    目标市场: form.targetMarket.join('、'),
    '核心产品/服务': form.offerings,
    主要客户: form.audiences,
    品牌优势: form.advantages,
    官方渠道: form.officialChannel || (officialUrls[0] || '客户未提供，需优先补充官网、公众号、小程序或主流社媒官方账号'),
    公开信源: publicSources.join('\n'),
    竞品品牌: form.competitors || `待人工补充同品类${context.profile.productWord}品牌，用于对比AI推荐结果`,
    风险备注: riskNotes || '需核验官方主体、公开信息一致性、客户口碑和竞品压制情况',
    档案状态: '待核验',
    最后更新: submittedAt,
    信息层级: '02 品牌基础档案',
    审核状态: '自动生成待复核'
  };
}

function buildTestRecord({ item, index, form, projectId, testedAt }) {
  const context = buildDiagnosisContext(form);
  const answer = buildAnalysisCorpus(item);
  const assets = normalizeAssets(item.assets, answer);
  const usableAnswer = hasUsableAnswer(item) ? answer : '';
  const mentioned = usableAnswer ? matchesBrand(usableAnswer, form) : false;
  const recommended = mentioned && hasRecommendationSignal(usableAnswer);
  const accurate = usableAnswer ? hasAccuracySignal(usableAnswer, form, item.question) : false;
  const sourceEvidence = detectSourceEvidence(usableAnswer, context);
  const extractionPrefix = item.extractionStatus
    ? `【链接读取状态】${item.extractionStatus}${item.extractionNote ? `：${item.extractionNote}` : ''}\n`
    : '';
  return {
    品牌分组: brandGroup(form, projectId),
    排序键: sortKey(form, projectId, `06 平台测试/${item.platform || '未标注平台'}`, index + 1),
    项目编号: projectId,
    问题编号: item.questionId || `MANUAL-${String(index + 1).padStart(2, '0')}`,
    平台: item.platform || '未标注平台',
    提问内容: item.question || '从会话链接整理，提问内容待补充',
    回答原文: answer ? `${extractionPrefix}${answer}` : `${extractionPrefix}已收到会话链接，但未读取到完整回答原文`,
    内容格式: buildContentFormat({ answer, assets }),
    图片链接: formatAssetEntries(assets.images),
    视频链接: formatAssetEntries(assets.videos),
    表格内容: formatAssetEntries(assets.tables),
    外部链接: formatAssetEntries(assets.links),
    读取完整性: buildReadCompleteness({ item, answer, assets }),
    原始内容长度: answer ? String(answer.length) : '0',
    是否提到品牌: usableAnswer ? yesNo(mentioned) : '待判断',
    是否主动推荐: usableAnswer ? yesNo(recommended) : '待判断',
    信息是否准确: usableAnswer ? yesNo(accurate) : '待判断',
    提到的竞品: findCompetitors(usableAnswer, form.competitors),
    引用或信源: sourceEvidence.length ? sourceEvidence.join('、') : item.link || '',
    '证据截图/链接': item.link || '',
    测试时间: testedAt,
    测试人: 'GeoGi 工作流',
    信息层级: `06 平台测试/${item.platform || '未标注平台'}`,
    审核状态: '自动生成待复核'
  };
}

function buildAnalysisRecord({ item, form, projectId }) {
  const context = buildDiagnosisContext(form);
  const answer = hasUsableAnswer(item) ? buildAnalysisCorpus(item) : '';
  const question = clean(item.question);
  const questionType = inferQuestionType(question);
  const mentioned = answer && matchesBrand(answer, form);
  const recommended = mentioned && hasRecommendationSignal(answer);
  const accurate = answer && hasAccuracySignal(answer, form, question);
  const competitorMentions = findCompetitors(answer, form.competitors);
  const sourceAssessment = assessSourceCredibility({ item, answer, context });

  return {
    品牌分组: brandGroup(form, projectId),
    排序键: sortKey(form, projectId, `07 回答分析/${item.platform || '未标注平台'}`, 1),
    项目编号: projectId,
    平台: item.platform || '未标注平台',
    问题编号: item.questionId || '',
    提问内容: question,
    回答摘要: answer ? summarizeAnswer(answer) : '',
    命中证据: sourceAssessment.evidence.join('、'),
    品牌识别得分: answer ? String(scoreBrandRecognition({ mentioned, answer, form })) : '待补充',
    主动推荐得分: answer ? String(scoreRecommendation({ questionType, mentioned, recommended, answer })) : '待补充',
    信息准确得分: answer ? String(scoreAccuracy({ accurate, answer, context, question })) : '待补充',
    竞品压制情况: competitorMentions ? `回答中出现竞品：${competitorMentions}` : '未发现明显竞品压制',
    信源可信度: sourceAssessment.summary,
    核心问题: answer ? buildCoreIssue({ item, form, context, questionType, mentioned, recommended, accurate, sourceAssessment }) : buildMissingAnswerIssue(item),
    优化建议: buildOptimizationAdvice({ item, form, context, questionType, mentioned, recommended, accurate, sourceAssessment, hasAnswer: Boolean(answer) }),
    分析状态: answer ? (item.extractionStatus ? `已生成初步分析（${item.extractionStatus}）` : '已生成初步分析') : '待补充回答原文',
    信息层级: `07 回答分析/${item.platform || '未标注平台'}`,
    审核状态: answer ? '自动生成待复核' : '待补充材料'
  };
}

function buildReportFields({ conversations, analyses, form, projectId, testedAt }) {
  const answered = conversations.filter(hasUsableAnswer).length;
  const mentioned = conversations.filter((item) => {
    const answer = buildAnalysisCorpus(item);
    return hasUsableAnswer(item) && matchesBrand(answer, form);
  }).length;
  const recommended = conversations.filter((item) => {
    const answer = buildAnalysisCorpus(item);
    return hasUsableAnswer(item) && matchesBrand(answer, form) && hasRecommendationSignal(answer);
  }).length;
  const context = buildDiagnosisContext(form);
  const professionalReport = buildProfessionalReport({
    conversations,
    analyses,
    form,
    context,
    projectId,
    testedAt,
    answered,
    mentioned,
    recommended
  });
  const reportSummary = [
    `本次共拆分 ${conversations.length} 条AI问答记录，其中 ${answered} 条包含可分析回答原文。`,
    `品牌被提及 ${mentioned} 次，出现主动推荐倾向 ${recommended} 次。`,
    buildExtractionSummary(conversations),
    answered < conversations.length ? '部分平台的分享页未暴露完整正文，需要换成公开可访问链接、截图或导出内容后再生成正式报告。' : '当前回答原文已可支撑初步报告。'
  ].join('\n');
  const targetedAdvice = unique(analyses.map((item) => text(item.优化建议)).filter(Boolean)).slice(0, 6);

  return {
    品牌分组: brandGroup(form, projectId),
    排序键: sortKey(form, projectId, '08 报告管理', 1),
    项目编号: projectId,
    客户编号: form.clientId,
    品牌名称: form.brandName,
    报告版本: `v-${Date.now()}`,
    报告状态: answered ? '报告初稿已生成' : '待补充回答原文',
    报告链接: '',
    报告正文: professionalReport,
    交付说明: reportSummary,
    客户反馈: '',
    下一步建议: (targetedAdvice.length ? targetedAdvice : [
      '审核平台测试记录和回答分析结果。',
      `优先补充${form.brandName}的官网、案例、品牌介绍和可信第三方信源。`,
      '确认AI回答中说错、漏说或被竞品压制的内容，形成正式优化清单。'
    ]).join('\n'),
    创建时间: testedAt,
    更新时间: testedAt,
    信息层级: '08 报告管理',
    审核状态: answered ? '报告待复核' : '待补充材料'
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

function expandConversationTurns(conversations) {
  const expanded = [];

  conversations.forEach((conversation, conversationIndex) => {
    const turns = Array.isArray(conversation.turns) ? conversation.turns : [];
    if (turns.length) {
      turns.forEach((turn, turnIndex) => {
        expanded.push({
          ...conversation,
          questionId: turn.questionId || `${conversation.questionId || `LINK-${conversationIndex + 1}`}-T${turnIndex + 1}`,
          question: clean(turn.question) || clean(conversation.question),
          answer: clean(turn.answer),
          turnIndex: turnIndex + 1,
          totalTurns: turns.length
        });
      });
      return;
    }

    expanded.push({
      ...conversation,
      questionId: conversation.questionId || `MANUAL-${String(conversationIndex + 1).padStart(2, '0')}`,
      turnIndex: 1,
      totalTurns: 1
    });
  });

  return expanded;
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

async function replaceProjectRecords({ tenantToken, tableId, projectId, records }) {
  const deleted = await clearProjectRecords({ tenantToken, tableId, projectId });
  await createBitableRecords({
    tenantToken,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId,
    records
  });
  return {
    created: records.length,
    deleted
  };
}

async function clearProjectRecords({ tenantToken, tableId, projectId }) {
  if (!tableId) return 0;
  const existing = await listByProject({ tenantToken, tableId, projectId });
  const recordIds = existing.map((record) => record.record_id).filter(Boolean);
  for (let index = 0; index < recordIds.length; index += 100) {
    await deleteBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId,
      recordIds: recordIds.slice(index, index + 100)
    });
  }
  return recordIds.length;
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

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeToken(value) {
  return clean(value).replace(/\s+/g, '');
}

function stripBrandNoise(value) {
  return clean(value)
    .replace(/联调测试|质量测试|测试|可删除|样例|示例|demo|Demo|DEMO/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .trim();
}

function stripCompanySuffix(value) {
  return stripBrandNoise(value)
    .replace(/(股份)?有限公司|有限责任公司|集团|科技|信息技术|网络科技|中国/g, '')
    .trim();
}

function brandAliases(form) {
  return unique([
    clean(form.brandName),
    clean(form.companyName),
    stripBrandNoise(form.brandName),
    stripCategorySuffix(stripBrandNoise(form.brandName)),
    stripCompanySuffix(form.companyName),
    ...splitList(form.brandName),
    ...splitList(form.companyName)
  ])
    .map(normalizeToken)
    .filter((item) => item.length >= 2)
    .sort((a, b) => b.length - a.length);
}

function stripCategorySuffix(value) {
  return clean(value)
    .replace(/(咖啡|茶饮|饮品|食品|科技|旅行|旅游|保险|服务|平台|教育|培训|健康|医疗|家居|生活|品牌)$/g, '')
    .trim();
}

function matchesBrand(answer, form) {
  const normalized = normalizeToken(answer);
  return brandAliases(form).some((alias) => normalized.includes(alias));
}

function hasRecommendationSignal(answer) {
  return /推荐|优先考虑|可以考虑|适合|值得|首选|更适合|优先选择|建议|可选|常被选择|热门选择/.test(answer);
}

function hasAccuracySignal(answer, form, question = '') {
  const context = buildDiagnosisContext(form);
  const value = clean(answer);
  const mentioned = matchesBrand(value, form);
  const questionType = inferQuestionType(question);
  const categorySignals = [
    context.profile.productWord,
    context.profile.featuredProduct,
    context.profile.categoryName,
    form.industry,
    form.segment,
    ...context.profile.purchaseCriteria,
    ...extractPhrases(form.offerings).slice(0, 5)
  ].filter(Boolean);
  const hasCategory = categorySignals.some((item) => clean(item) && value.includes(clean(item)));

  if (/品牌|产品|准确|信任/.test(questionType)) return mentioned && hasCategory;
  if (/比较/.test(questionType)) return mentioned && (hasCategory || findCompetitors(value, form.competitors));
  return mentioned || hasCategory;
}

function yesNo(value) {
  return value ? '是' : '否';
}

function findCompetitors(answer, competitors) {
  const names = splitList(competitors);
  return names.filter((name) => answer && answer.includes(name)).join('、');
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

function hasUsableAnswer(item) {
  const answer = buildAnalysisCorpus(item);
  if (!answer) return false;
  if (item.extractionStatus === '部分读取' && answer.length < 120) return false;
  return answer.length >= 80;
}

function buildAnalysisCorpus(item) {
  const answer = clean(item && item.answer);
  const assets = normalizeAssets(item && item.assets, answer);
  const tables = formatAssetEntries(assets.tables);
  const links = formatAssetEntries(assets.links);
  const media = [
    assets.images.length ? `图片资料：${formatAssetEntries(assets.images)}` : '',
    assets.videos.length ? `视频资料：${formatAssetEntries(assets.videos)}` : ''
  ].filter(Boolean).join('\n');

  return [
    answer,
    tables ? `表格资料：\n${tables}` : '',
    links ? `外部链接：\n${links}` : '',
    media
  ].filter(Boolean).join('\n\n').trim();
}

function assessSourceCredibility({ item, answer, context }) {
  const evidence = detectSourceEvidence(answer, context);
  const platformEvidence = evidence.filter((name) => !/分享链接/.test(name));
  if (!answer) {
    return {
      level: '待补充',
      evidence,
      summary: item.extractionNote ? `待补充：${item.extractionNote}` : '待补充回答原文，暂不能判断信源可信度'
    };
  }
  if (platformEvidence.length >= 2) {
    return {
      level: '较强',
      evidence,
      summary: `较强：回答提到${platformEvidence.slice(0, 4).join('、')}等可核验信源方向`
    };
  }
  if (platformEvidence.length === 1) {
    return {
      level: '一般',
      evidence,
      summary: `一般：回答只出现${platformEvidence[0]}，仍需补充官方/第三方/用户评价交叉验证`
    };
  }
  if (item.extractionStatus === '已自动读取') {
    return {
      level: '偏弱',
      evidence: ['分享链接可读取'],
      summary: '偏弱：虽然分享链接可读取，但回答本身缺少明确官方、第三方或用户评价信源'
    };
  }
  if (item.extractionStatus === '部分读取') {
    return {
      level: '待复核',
      evidence: ['分享链接部分读取'],
      summary: `待复核：${item.extractionNote || '分享页只读取到部分内容'}`
    };
  }
  return {
    level: '偏弱',
    evidence,
    summary: item.link ? '偏弱：有会话链接，但回答未呈现可追溯信源' : '偏弱：未提供链接或引用来源'
  };
}

function detectSourceEvidence(answer, context) {
  const value = clean(answer);
  if (!value) return [];
  const evidence = [];
  const platformPairs = [
    ['官网/官方渠道', /官网|官方网站|官方公众号|小程序|官方旗舰店|官方客服|官方资料|官方网站|公众号/],
    ['企业信用/工商商标', /企查查|天眼查|爱企查|工商|统一社会信用代码|商标|注册号|备案|ICP/],
    ['监管/行业协会', /国家金融监督管理总局|银保监|保险行业协会|监管|牌照|资质|备案|承保|保险公司/],
    ['大众点评/美团评价', /大众点评|美团|饿了么|外卖|门店评分|团购/],
    ['小红书内容', /小红书|种草|笔记|探店|拔草/],
    ['抖音/快手短视频', /抖音|快手|直播|短视频|达人/],
    ['知乎/B站讨论', /知乎|B站|哔哩哔哩|测评|评测|问答/],
    ['投诉/风险舆情', /黑猫投诉|投诉|舆情|裁判文书|负面|争议|退款|拒赔/],
    ['行业媒体/案例', /36氪|钛媒体|人人都是产品经理|行业媒体|案例|客户案例|合作案例/],
    ['全球软件评价', /G2|Capterra|Product Hunt|海外评价|国际评价/]
  ];

  for (const [name, re] of platformPairs) {
    if (re.test(value)) evidence.push(name);
  }
  for (const [platform] of (context.profile.contentPlatforms || [])) {
    if (platform && value.includes(platform)) evidence.push(platform);
  }
  if (/https?:\/\//.test(value)) evidence.push('回答含外部链接');
  return unique(evidence);
}

function normalizeAssets(assets, answer = '') {
  const source = assets && typeof assets === 'object' ? assets : {};
  return {
    contentTypes: Array.isArray(source.contentTypes) ? source.contentTypes.filter(Boolean) : ['文字'],
    images: Array.isArray(source.images) ? source.images.filter(Boolean) : [],
    videos: Array.isArray(source.videos) ? source.videos.filter(Boolean) : [],
    links: Array.isArray(source.links) ? source.links.filter(Boolean) : [],
    tables: unique([
      ...(Array.isArray(source.tables) ? source.tables.filter(Boolean) : []),
      ...extractMarkdownTables(answer)
    ])
  };
}

function buildContentFormat({ answer, assets }) {
  const formats = new Set(assets.contentTypes || []);
  if (answer) formats.add('文字');
  if (assets.links.length) formats.add('链接');
  if (assets.images.length) formats.add('图片');
  if (assets.videos.length) formats.add('视频');
  if (assets.tables.length) formats.add('表格');
  return Array.from(formats).join('、') || '未识别';
}

function formatAssetEntries(entries) {
  return entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n');
}

function buildReadCompleteness({ item, answer, assets }) {
  const status = item.extractionStatus || (answer ? '人工提供' : '待补充');
  const note = item.extractionNote ? `；${item.extractionNote}` : '';
  const assetSummary = [
    assets.images.length ? `图片${assets.images.length}个` : '',
    assets.videos.length ? `视频${assets.videos.length}个` : '',
    assets.links.length ? `链接${assets.links.length}个` : '',
    assets.tables.length ? `表格${assets.tables.length}个` : ''
  ].filter(Boolean).join('，') || '未发现非文本附件';
  return `${status}${note}；正文${answer ? answer.length : 0}字；${assetSummary}`;
}

function extractMarkdownTables(value) {
  const lines = clean(value).split(/\n+/);
  const tables = [];
  let current = [];

  for (const line of lines) {
    if ((line.match(/\|/g) || []).length >= 2 && line.length <= 1200) {
      current.push(line.trim());
      continue;
    }
    if (current.length >= 2) tables.push(current.join('\n'));
    current = [];
  }
  if (current.length >= 2) tables.push(current.join('\n'));
  return tables.slice(0, 40);
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

function buildProfessionalReport({ conversations, analyses, form, context, projectId, testedAt, answered, mentioned, recommended }) {
  const sourceWeak = analyses.filter((item) => /偏弱|待复核|待补充|一般/.test(text(item.信源可信度))).length;
  const competitorPressure = analyses.filter((item) => !/未发现/.test(text(item.竞品压制情况))).length;
  const topIssues = unique(analyses.map((item) => text(item.核心问题)).filter(Boolean)).slice(0, 6);
  const advice = unique(analyses.map((item) => text(item.优化建议)).filter(Boolean)).slice(0, 6);
  const platformLines = analyses.slice(0, 10).map((item) => [
    `- ${text(item.平台)}｜${text(item.问题编号) || '未编号'}`,
    `  问题：${limitText(text(item.提问内容), 120)}`,
    `  结论：${limitText(text(item.核心问题), 140)}`,
    `  建议：${limitText(text(item.优化建议), 160)}`
  ].join('\n'));

  return [
    `# ${form.brandName} AI 可见度诊断报告`,
    '',
    `项目编号：${projectId}`,
    `生成时间：${testedAt}`,
    `行业/品类：${form.industry} / ${context.profile.categoryName}`,
    `核心产品/服务：${form.offerings}`,
    '',
    '## 一、诊断结论',
    `本次共拆分 ${conversations.length} 条AI问答记录，其中 ${answered} 条可分析。${form.brandName}被提及 ${mentioned} 次，主动推荐 ${recommended} 次。`,
    sourceWeak ? `主要短板是信源支撑不足：${sourceWeak} 条回答缺少清晰的官方、第三方或用户评价证据。` : '回答中的信源支撑相对完整，但仍需人工复核真实性。',
    competitorPressure ? `另有 ${competitorPressure} 条回答出现竞品，需要检查是否形成竞品压制。` : '暂未发现明显竞品压制。',
    '',
    '## 二、关键发现',
    ...topIssues.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 三、平台问答分析',
    ...platformLines,
    '',
    '## 四、优化建议',
    ...advice.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 五、交付前复核',
    `1. 核对${form.brandName}官方渠道、主体资质、产品边界和联系方式。`,
    `2. 核对${context.profile.contentPlatforms.slice(0, 5).map(([name]) => name).join('、')}等行业信源是否有真实证据。`,
    '3. 对读取受限或部分读取的平台，补充截图、导出文本或新的公开分享链接。'
  ].join('\n');
}

function inferQuestionType(question) {
  const value = clean(question);
  if (/对比|比较|相比|怎么选|谁更/.test(value)) return '比较型';
  if (/推荐|值得|优先考虑|适合|哪款|哪些|有没有/.test(value)) return '推荐型';
  if (/是什么|主要做什么|关系|产品|系列|单品|功能/.test(value)) return '品牌产品识别型';
  if (/信源|证明|资料|官方|资质|可靠|靠谱|可信|准确|判断/.test(value)) return '信任准确型';
  if (/风险|踩雷|忽略|注意|投诉|拒赔|争议/.test(value)) return '风险型';
  if (/场景|上班|外卖|研学|户外|团队|预算|试用/.test(value)) return '场景型';
  return '综合型';
}

function scoreBrandRecognition({ mentioned, answer, form }) {
  if (!answer) return 0;
  if (mentioned) return 82;
  return brandAliases(form).some((alias) => clean(answer).includes(alias.slice(0, 2))) ? 45 : 18;
}

function scoreRecommendation({ questionType, mentioned, recommended, answer }) {
  if (!answer) return 0;
  if (!/推荐|比较|场景|选型/.test(questionType)) return mentioned ? 68 : 35;
  if (mentioned && recommended) return 78;
  if (mentioned) return 55;
  return 25;
}

function scoreAccuracy({ accurate, answer, context, question }) {
  if (!answer) return 0;
  const type = inferQuestionType(question);
  const hasRiskBoundary = /待核验|不确定|需要确认|可能|公开信息|以官方为准|不建议猜测/.test(answer);
  const hasSpecificCriteria = context.profile.purchaseCriteria.filter((item) => answer.includes(item)).length;
  let score = accurate ? 72 : 36;
  if (hasSpecificCriteria >= 2) score += 8;
  if (/信任|准确|风险/.test(type) && hasRiskBoundary) score += 8;
  return Math.max(10, Math.min(score, 88));
}

function summarizeAnswer(answer) {
  const textValue = clean(answer)
    .replace(/^【链接读取状态】.*?\n/, '')
    .replace(/\n{2,}/g, '\n');
  return limitText(textValue, 360);
}

function buildCoreIssue({ item, form, context, questionType, mentioned, recommended, accurate, sourceAssessment }) {
  const platform = item.platform || '该平台';
  const question = clean(item.question);
  if (!mentioned) {
    return `${platform}在这个问题下没有把${form.brandName}纳入回答，说明该场景的品牌可见度不足。问题：${limitText(question, 90)}`;
  }
  if (/推荐|比较|场景|选型/.test(questionType) && !recommended) {
    return `${platform}能识别${form.brandName}，但没有形成明确推荐理由，用户决策场景下的主动推荐不足。`;
  }
  if (!accurate) {
    return `${platform}提到了${form.brandName}，但没有充分贴合${context.profile.productWord}、${context.profile.purchaseCriteria.slice(0, 3).join('、')}等关键判断维度。`;
  }
  if (/偏弱|一般|待复核|待补充/.test(sourceAssessment.summary)) {
    return `${platform}回答基本相关，但信源支撑不足，缺少能让用户信任的官方、行业平台或第三方证据。`;
  }
  return `${platform}回答已覆盖品牌和问题场景，下一步重点是补强更清晰的证据链和可交付表达。`;
}

function buildOptimizationAdvice({ item, form, context, questionType, mentioned, recommended, accurate, sourceAssessment, hasAnswer }) {
  if (!hasAnswer) return '补充AI回答原文后再进行准确诊断';
  const advice = [];
  const platformSources = (context.profile.contentPlatforms || []).slice(0, 3).map(([name]) => name).join('、');
  if (!mentioned) {
    advice.push(`围绕“${limitText(item.question, 70)}”补充${form.brandName}的官方介绍、产品说明和${context.profile.productWord}场景内容`);
  }
  if (/推荐|比较|场景|选型/.test(questionType) && !recommended) {
    advice.push(`增加面向${context.profile.userRole}的选择理由：${context.profile.purchaseCriteria.slice(0, 4).join('、')}`);
  }
  if (!accurate) {
    advice.push(`统一${form.brandName}的品类定位、核心产品和服务边界，避免AI把产品系列、行业品类或竞品关系说混`);
  }
  if (/偏弱|一般|待复核|待补充/.test(sourceAssessment.summary)) {
    advice.push(platformSources ? `优先补充${platformSources}上的可核验内容和证据` : '补充官方、第三方和用户口碑信源');
  }
  if (!advice.length) advice.push(`把这条回答沉淀为${form.brandName}的标准AI问答素材，并继续扩大同类问题覆盖`);
  return advice.join('；');
}

function appendNote(current, note) {
  const value = text(current);
  return value ? `${value}\n${note}` : note;
}

function extractPhrases(value) {
  return unique(String(value || '')
    .split(/[、,，;；\n\r。\.\/|]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 36));
}

function limitText(value, max) {
  const content = clean(value);
  if (content.length <= max) return content;
  return `${content.slice(0, Math.max(0, max - 8))}...`;
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
