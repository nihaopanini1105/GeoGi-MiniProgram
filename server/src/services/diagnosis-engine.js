const DEFAULT_PLATFORMS = ['DeepSeek', 'Kimi', '豆包', '通义千问', '腾讯元宝'];

function generateDiagnosisAssets({ form, projectId, submittedAt }) {
  const context = buildContext(form);
  const sources = generateSources({ context, projectId, submittedAt });
  const keywords = generateKeywords({ context, projectId });
  const industryQuestions = generateIndustryQuestions({ context, projectId });
  const aiQuestions = generateAiQuestions({ industryQuestions, context, projectId });

  return {
    sources,
    keywords,
    industryQuestions,
    aiQuestions,
    summary: {
      sources: sources.length,
      keywords: keywords.length,
      industryQuestions: industryQuestions.length,
      aiQuestions: aiQuestions.length
    }
  };
}

function buildContext(form) {
  const brandName = clean(form.brandName);
  const companyName = clean(form.companyName);
  const industry = clean(form.industry);
  const segment = clean(form.segment);
  const officialChannel = clean(form.officialChannel);
  const targetMarkets = Array.isArray(form.targetMarket) ? form.targetMarket.map(clean).filter(Boolean) : [];
  const targetMarketOther = clean(form.targetMarketOther);
  const markets = unique(targetMarkets.concat(targetMarketOther ? [targetMarketOther] : []));
  const offerings = clean(form.offerings);
  const audiences = clean(form.audiences);
  const advantages = clean(form.advantages);
  const competitors = splitList(form.competitors).slice(0, 5);
  const goals = Array.isArray(form.goals) ? form.goals.map(clean).filter(Boolean) : [];
  const uploads = Array.isArray(form.uploads) ? form.uploads : [];

  return {
    brandName,
    companyName,
    industry,
    segment,
    officialChannel,
    markets,
    offerings,
    audiences,
    advantages,
    competitors,
    goals,
    uploads,
    isGlobal: markets.some((item) => /全球|海外|国际|出海|global|international|overseas/i.test(item))
  };
}

function generateSources({ context, projectId, submittedAt }) {
  const records = [];
  const officialUrls = extractUrls(context.officialChannel);

  if (context.officialChannel) {
    records.push({
      项目编号: projectId,
      品牌名称: context.brandName,
      信源名称: officialUrls.length ? '客户提供的官方渠道' : '客户提供的官方渠道说明',
      信源类型: '官方信源',
      链接: officialUrls[0] || '',
      是否官方: '是',
      可信度: '高',
      核心信息摘要: limitText(context.officialChannel, 300),
      问题或缺口: officialUrls.length ? '待核验页面内容是否完整覆盖品牌、业务、案例和联系方式' : '客户未提供可直接访问链接，需人工补充官方链接',
      采集时间: submittedAt
    });
  }

  for (const upload of context.uploads.slice(0, 3)) {
    records.push({
      项目编号: projectId,
      品牌名称: context.brandName,
      信源名称: upload.name || upload.fileId || '客户上传资料',
      信源类型: '客户资料',
      链接: upload.url || upload.fileId || '',
      是否官方: '是',
      可信度: '高',
      核心信息摘要: '客户在小程序提交的附件资料，可用于核验品牌介绍、业务范围、案例或资质。',
      问题或缺口: '需人工查看附件内容并提取可引用信息',
      采集时间: submittedAt
    });
  }

  const searchTasks = [
    [`${context.brandName} 官网`, '官网检索', '核验品牌官网、官方介绍和联系方式'],
    [`${context.companyName || context.brandName} 企业信息`, '企业信息检索', '核验工商主体、品牌归属和可信度'],
    [`${context.brandName} ${context.industry}`, '行业曝光检索', '查找行业文章、媒体报道、榜单或测评内容'],
    [`${context.brandName} 案例 客户`, '案例检索', '查找客户案例、合作案例或公开口碑'],
    [`${context.brandName} 推荐 可靠吗`, '口碑检索', '发现 AI 可能引用的推荐、评价和风险内容']
  ];

  for (const competitor of context.competitors.slice(0, 3)) {
    searchTasks.push([`${context.brandName} ${competitor} 对比`, '竞品对比检索', '查找品牌与竞品在公开内容中的对比关系']);
  }

  for (const [query, type, note] of searchTasks) {
    if (!query.trim()) continue;
    records.push({
      项目编号: projectId,
      品牌名称: context.brandName,
      信源名称: query,
      信源类型: type,
      链接: '',
      是否官方: '待核验',
      可信度: '待核验',
      核心信息摘要: `P1 自动生成的待检索任务：${query}`,
      问题或缺口: note,
      采集时间: submittedAt
    });
  }

  return dedupeBy(records, (item) => `${item.信源类型}:${item.信源名称}:${item.链接}`).slice(0, 12);
}

function generateKeywords({ context, projectId }) {
  const records = [];
  const add = (keyword, type, intent, priority = '中', note = 'P1 自动生成，待人工审核') => {
    const cleanKeyword = clean(keyword);
    if (!cleanKeyword) return;
    records.push({
      项目编号: projectId,
      品牌名称: context.brandName,
      关键词: cleanKeyword,
      关键词类型: type,
      用户意图: intent,
      优先级: priority,
      备注: note
    });
  };

  add(context.brandName, '品牌词', '用户直接查询品牌', '高');
  add(context.companyName, '品牌词', '用户通过企业主体查询品牌', '中');
  add(context.industry, '行业词', '用户查找行业服务或解决方案', '高');
  add(context.segment, '业务词', '用户查找细分服务能力', '高');

  for (const phrase of extractPhrases(context.offerings).slice(0, 6)) {
    add(phrase, '业务词', '用户寻找具体产品、服务或能力', '高');
  }
  for (const phrase of extractPhrases(context.audiences).slice(0, 4)) {
    add(phrase, '场景词', '目标客户描述自身需求或身份', '中');
  }
  for (const phrase of extractPhrases(context.advantages).slice(0, 4)) {
    add(phrase, '优势词', '用户关注品牌优势和选择理由', '中');
  }
  for (const market of context.markets) {
    add(market, '市场词', '用户按服务市场筛选品牌', market.includes('全球') ? '高' : '中');
  }
  for (const competitor of context.competitors) {
    add(competitor, '竞品词', '用户比较竞品与替代方案', '中');
  }
  for (const goal of context.goals) {
    add(goal, '诊断目标词', '本次 GEO 诊断关注点', '高');
  }

  add('AI 搜索推荐', 'GEO 诊断词', '用户希望 AI 推荐合适品牌', '高');
  add('品牌 AI 可见度', 'GEO 诊断词', '判断品牌是否能被 AI 正确识别', '高');
  add('信源可信度', 'GEO 诊断词', '判断 AI 回答背后的公开依据是否可靠', '中');

  return dedupeBy(records, (item) => item.关键词).slice(0, 24);
}

function generateIndustryQuestions({ context, projectId }) {
  const brand = context.brandName || '这个品牌';
  const industry = context.industry || '相关行业';
  const segment = context.segment || context.offerings || '相关服务';
  const audience = firstPhrase(context.audiences) || '企业客户';
  const competitor = context.competitors[0];
  const market = context.markets[0] || '中国市场';
  const records = [];

  const add = (question, type, scene, priority = '中', included = '是') => {
    records.push({
      项目编号: projectId,
      行业: industry,
      问题: question,
      问题类型: type,
      用户场景: scene,
      优先级: priority,
      是否纳入检测: included,
      备注: 'P1 自动生成，需确认是否符合客户真实业务'
    });
  };

  add(`${industry}领域有哪些值得推荐的${segment}品牌或服务商？`, '推荐型', `${audience}寻找服务商`, '高');
  add(`${market}做${segment}，应该优先了解哪些品牌？`, '推荐型', '用户初步选型', '高');
  add(`如果我要解决${context.offerings || segment}相关问题，AI 会推荐${brand}吗？`, '推荐型', '检验品牌是否被主动推荐', '高');
  add(`${brand}是做什么的？主要适合哪些客户？`, '品牌识别型', '检验 AI 是否正确理解品牌', '高');
  add(`${brand}靠谱吗？有哪些公开信息可以参考？`, '信任型', '用户验证可信度', '高');
  add(`选择${segment}服务时应该关注哪些能力和指标？`, '选购型', '用户建立评估标准', '中');
  add(`${industry}企业在做 AI 搜索或品牌可见度时常见问题有哪些？`, '场景型', '用户了解行业痛点', '中');
  add(`${audience}如果想提升 AI 推荐结果，应该怎么做？`, '场景型', '用户寻找解决方案', '中');

  if (competitor) {
    add(`${brand}和${competitor}有什么区别？`, '比较型', '用户比较品牌和竞品', '高');
    add(`${brand}相比${competitor}有哪些优势和不足？`, '比较型', '用户做采购决策', '高');
  } else {
    add(`${brand}和同类品牌相比有什么优势和不足？`, '比较型', '用户做采购决策', '高');
  }

  if (context.isGlobal) {
    add(`Which ${segment} brands are suitable for global markets?`, '全球化推荐型', '海外或全球市场检索', '中');
    add(`Is ${brand} suitable for international customers?`, '全球化信任型', '英文 AI 检索品牌可信度', '中');
  }

  return dedupeBy(records, (item) => item.问题).slice(0, 15);
}

function generateAiQuestions({ industryQuestions, context, projectId }) {
  const selected = industryQuestions
    .filter((item) => item.是否纳入检测 === '是')
    .sort((a, b) => priorityScore(b.优先级) - priorityScore(a.优先级))
    .slice(0, 6);
  const records = [];

  selected.forEach((question, questionIndex) => {
    DEFAULT_PLATFORMS.forEach((platform, platformIndex) => {
      records.push({
        项目编号: projectId,
        问题编号: `Q${String(questionIndex + 1).padStart(3, '0')}-${String(platformIndex + 1).padStart(2, '0')}`,
        检测问题: question.问题,
        问题类型: question.问题类型,
        目标平台: platform,
        预期识别点: buildExpectedSignal(context, question),
        检测状态: '待测试',
        负责人: process.env.DEFAULT_OWNER || 'GeoGi 负责人',
        备注: 'P1 自动生成。测试时需记录 AI 原始回答、是否提及品牌、是否主动推荐、引用信源。'
      });
    });
  });

  return records;
}

function buildExpectedSignal(context, question) {
  const signals = [
    `是否正确识别${context.brandName}`,
    context.segment ? `是否理解其细分业务：${context.segment}` : '',
    question.问题类型.includes('推荐') ? '是否主动推荐该品牌' : '',
    question.问题类型.includes('比较') && context.competitors.length ? `是否准确比较竞品：${context.competitors.join('、')}` : '',
    question.问题类型.includes('信任') ? '是否给出可信公开信源或案例' : ''
  ].filter(Boolean);

  return signals.join('；');
}

function extractUrls(value) {
  return String(value || '').match(/https?:\/\/[^\s，,、；;]+/g) || [];
}

function extractPhrases(value) {
  return unique(String(value || '')
    .split(/[、,，;；\n\r。\.\/|]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 36));
}

function firstPhrase(value) {
  return extractPhrases(value)[0] || '';
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return unique(String(value || '')
    .split(/[、,，;；\n\r]/)
    .map((item) => item.trim())
    .filter(Boolean));
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function priorityScore(priority) {
  if (priority === '高') return 3;
  if (priority === '中') return 2;
  if (priority === '低') return 1;
  return 0;
}

function unique(items) {
  return [...new Set(items.map(clean).filter(Boolean))];
}

function clean(value) {
  return String(value || '').trim();
}

function limitText(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

module.exports = {
  generateDiagnosisAssets
};
