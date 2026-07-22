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

  const baseContext = {
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
  const profile = inferCategoryProfile(baseContext);
  return {
    ...baseContext,
    profile
  };
}

function inferCategoryProfile(context) {
  const haystack = [
    context.brandName,
    context.industry,
    context.segment,
    context.offerings,
    context.audiences,
    context.advantages
  ].join(' ');

  if (/咖啡|茶饮|饮品|食品饮料|餐饮|烘焙|奶茶|现制饮品/.test(haystack)) {
    return {
      categoryName: '咖啡饮品与食品零售',
      userRole: '消费者',
      decisionVerb: '买',
      productWord: pickKnownProductWord(context, ['咖啡', '饮品', '食品饮料', '小黑杯', '拿铁', '美式']),
      featuredProduct: firstPhrase(context.offerings),
      purchaseCriteria: ['口味', '品质稳定', '价格和优惠', '门店便利', '外卖配送', '新品和联名', '热量配料', '会员权益'],
      sourceAngles: [
        ['口味与产品口碑', '产品体验信源', '观察消费者对口味、甜度、咖啡豆、奶基和热门单品的评价'],
        ['新品和爆款', '产品趋势信源', '判断AI是否知道品牌近期热门产品、联名或季节新品'],
        ['价格优惠和会员', '消费决策信源', '核验价格带、优惠券、会员权益和高性价比心智'],
        ['门店与外卖体验', '渠道体验信源', '核验门店覆盖、下单便利、出餐速度和配送体验'],
        ['配料热量和健康关注', '成分信息信源', '核验配料、热量、咖啡因、低糖低脂等消费者关心点'],
        ['食品安全与品控舆情', '风险舆情信源', '识别食品安全、品控稳定、投诉和争议内容']
      ],
      hotKeywords: ['咖啡推荐', '好喝的咖啡', '平价咖啡', '办公室咖啡', '上班族咖啡', '外卖咖啡', '低糖饮品', '新品咖啡', '咖啡优惠', '咖啡品牌排行'],
      brandKeywordTemplates: ['{brand} 哪款好喝', '{brand} 新品', '{brand} 优惠券', '{brand} 热量', '{brand} 外卖', '{brand} 门店', '{brand} 口味推荐', '{brand} 咖啡品质'],
      scenarios: ['上班通勤', '办公室下午茶', '外卖点单', '朋友聚会', '低糖低脂需求', '尝试新品', '对比价格和口味'],
      riskChecks: ['食品安全舆情', '产品口味两极分化', '价格优惠依赖', '门店体验不稳定', '配料和热量信息不清晰'],
      contentPlatforms: [
        ['大众点评', '门店口碑/评分/排队体验', '口味、环境、服务、门店稳定性'],
        ['美团/饿了么', '外卖和到店交易体验', '价格优惠、配送、出餐、评价'],
        ['小红书', '种草和真实体验笔记', '单品口味、热量、拍照、女性用户场景'],
        ['抖音/快手', '短视频热度和团购转化', '新品传播、团购套餐、达人推荐'],
        ['B站/知乎', '深度测评和理性讨论', '咖啡豆、口味、品牌对比、争议解释'],
        ['黑猫投诉/社媒舆情', '投诉与风险', '食品安全、服务体验、退款售后']
      ]
    };
  }

  if (/旅游保险|旅行社保险|旅责险|旅意险|保险|文旅保险|出单/.test(haystack)) {
    return {
      categoryName: '旅游保险与旅行社服务',
      userRole: '旅行社或文旅机构负责人',
      decisionVerb: '选择',
      productWord: pickProductWord(context, ['旅游保险', '旅行社保险服务', '保险出单平台']),
      featuredProduct: firstPhrase(context.offerings),
      purchaseCriteria: ['保障范围', '承保保险公司', '出单效率', '价格', '理赔服务', '批量投保', '合规资质', '客服响应'],
      sourceAngles: [
        ['保险产品和保障范围', '产品信源', '核验旅行社责任险、旅游意外险、研学险等产品覆盖'],
        ['承保方和合规资质', '资质信源', '核验保险公司、经纪/代理资质、备案和业务边界'],
        ['出单系统体验', '服务体验信源', '核验批量投保、保单管理、对账和出单效率'],
        ['理赔和售后', '服务口碑信源', '观察理赔流程、材料指导、客服响应和投诉'],
        ['旅行社场景案例', '客户案例信源', '查找旅行社、研学、户外、团建等实际使用场景'],
        ['风险和投诉', '风险舆情信源', '识别拒赔、资质不清、误导销售和服务争议']
      ],
      hotKeywords: ['旅行社责任险', '旅游意外险', '旅责险怎么买', '旅行社保险平台', '旅游保险出单', '研学保险', '户外活动保险', '旅行社保险理赔'],
      brandKeywordTemplates: ['{brand} 是什么', '{brand} 旅游保险', '{brand} 旅行社保险', '{brand} 出单平台', '{brand} 理赔', '{brand} 资质', '{brand} 承保公司'],
      scenarios: ['旅行社续保', '研学团出行', '户外活动投保', '批量名单出单', '游客理赔咨询', '比较保险方案'],
      riskChecks: ['保险资质不清', '承保方不明确', '理赔流程不透明', '平台与保险公司关系表述不清', '旅行社责任边界误解'],
      contentPlatforms: [
        ['国家金融监督管理总局/保险行业协会', '监管资质与行业规则', '保险中介资质、承保主体、合规边界'],
        ['企业信用/商标信息平台', '主体和品牌归属', '工商主体、商标、域名、关联公司'],
        ['官网/公众号/飞书文档资料', '官方产品说明', '产品条款、承保公司、服务流程、联系方式'],
        ['旅行社和文旅行业媒体', '行业场景和客户案例', '研学、户外、组团、地接等真实需求'],
        ['知乎/百度知道/行业问答', '用户问答场景', '怎么买、理赔、责任边界、价格比较'],
        ['黑猫投诉/裁判文书/舆情平台', '风险和投诉', '拒赔争议、资质争议、服务投诉']
      ]
    };
  }

  if (/SaaS|软件|系统|平台|AI工具|数据|互联网|小程序|开发/.test(haystack)) {
    return {
      categoryName: '软件与互联网服务',
      userRole: '企业负责人或业务团队',
      decisionVerb: '选型',
      productWord: pickProductWord(context, ['软件系统', 'SaaS服务', '互联网平台']),
      featuredProduct: firstPhrase(context.offerings),
      purchaseCriteria: ['功能匹配', '易用性', '价格', '数据安全', '集成能力', '服务响应', '案例', '部署方式'],
      sourceAngles: [
        ['产品功能说明', '产品信源', '核验核心功能、适用对象和使用流程'],
        ['客户案例和行业方案', '案例信源', '证明产品在真实行业里的使用效果'],
        ['价格和版本', '选型信源', '核验套餐、试用、交付周期和费用边界'],
        ['安全和合规', '风险信源', '核验数据安全、权限、隐私和系统稳定性'],
        ['集成和部署', '技术信源', '核验API、系统对接、私有化或云部署能力'],
        ['竞品测评和口碑', '第三方信源', '判断AI是否引用测评、榜单、评价和对比']
      ],
      hotKeywords: ['SaaS软件推荐', '企业软件选型', '好用的AI工具', '业务系统推荐', '软件价格', '软件对比', '数字化工具'],
      brandKeywordTemplates: ['{brand} 是什么', '{brand} 好用吗', '{brand} 价格', '{brand} 功能', '{brand} 案例', '{brand} 替代方案', '{brand} 对比'],
      scenarios: ['企业选型', '团队提效', '系统替换', '预算有限', '数据安全评估', '对接现有系统'],
      riskChecks: ['功能边界不清', '价格不透明', '客户案例不足', '数据安全说明不足', '售后服务不明确'],
      contentPlatforms: [
        ['官网/产品文档/帮助中心', '官方产品能力', '功能、版本、集成、部署、使用流程'],
        ['飞书/企业微信/钉钉应用市场', '生态适配', '企业协同场景和第三方应用能力'],
        ['36氪/钛媒体/人人都是产品经理', '行业报道和产品分析', '融资、案例、产品定位、竞品动态'],
        ['知乎/B站/公众号', '用户讨论和经验分享', '选型经验、替代方案、优缺点'],
        ['G2/Capterra/Product Hunt', '全球软件评价', '海外用户评价、评分、替代产品'],
        ['安全合规公开资料', '安全与合规', '隐私政策、数据安全、认证、服务协议']
      ]
    };
  }

  return {
    categoryName: context.segment || context.industry || '品牌服务',
    userRole: context.audiences ? normalizeQuestionPhrase(firstPhrase(context.audiences)) : '目标客户',
    decisionVerb: '选择',
    productWord: pickProductWord(context, ['产品或服务']),
    featuredProduct: firstPhrase(context.offerings),
    purchaseCriteria: ['适用场景', '价格', '服务能力', '案例口碑', '专业度', '交付效率', '售后服务', '风险保障'],
    sourceAngles: [
      ['官方介绍', '官方信源', '核验品牌主体、产品服务、联系方式和业务边界'],
      ['产品服务能力', '产品信源', '核验核心产品、服务流程和适用场景'],
      ['客户案例和口碑', '案例口碑信源', '查找客户评价、案例、合作品牌和复购信息'],
      ['行业测评和榜单', '第三方信源', '判断AI是否能引用行业文章、榜单或测评'],
      ['竞品对比', '竞品信源', '查找与竞品的差异、优势和短板'],
      ['风险舆情', '风险舆情信源', '识别投诉、争议、资质或信息不一致问题']
    ],
    hotKeywords: ['服务商推荐', '品牌推荐', '怎么选', '价格', '口碑', '案例', '哪家好', '对比'],
    brandKeywordTemplates: ['{brand} 是什么', '{brand} 怎么样', '{brand} 价格', '{brand} 案例', '{brand} 口碑', '{brand} 对比'],
    scenarios: ['初次了解', '采购决策', '对比竞品', '预算有限', '验证可信度', '寻找替代方案'],
    riskChecks: ['官方信息不完整', '案例不足', '口碑不稳定', '竞品解释不清', '联系方式或主体不一致'],
    contentPlatforms: [
      ['官网/公众号/小程序', '官方信息', '品牌主体、产品服务、联系方式、案例'],
      ['小红书/抖音/知乎', '消费决策和口碑', '真实体验、评价、问题讨论'],
      ['行业媒体/垂直社区', '行业认知', '榜单、测评、案例、专家观点'],
      ['企业信用/商标/备案平台', '主体核验', '工商主体、商标、资质、备案'],
      ['地图/点评/电商/应用市场', '交易和服务评价', '门店、商品、评分、成交、评论'],
      ['投诉和舆情平台', '风险核验', '投诉、争议、负面反馈']
    ]
  };
}

function generateSources({ context, projectId, submittedAt }) {
  const records = [];
  const officialUrls = extractUrls(context.officialChannel);
  let order = 0;
  const addRecord = (layer, fields) => {
    records.push(withWorkbenchMeta({ context, projectId, layer, order: order += 1, fields }));
  };

  if (context.officialChannel) {
    addRecord('01 官方与主体', {
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
  } else {
    addRecord('01 官方与主体', {
      项目编号: projectId,
      品牌名称: context.brandName,
      信源名称: `${context.brandName} 官方渠道检索`,
      信源类型: '官方信源',
      链接: '',
      是否官方: '待核验',
      可信度: '待核验',
      核心信息摘要: `需优先确认${context.brandName}官网、小程序、公众号、视频号、抖音或小红书等官方渠道。`,
      问题或缺口: '客户未提供官方渠道，AI可能无法确认品牌主体、产品和联系方式',
      采集时间: submittedAt
    });
  }

  for (const upload of context.uploads.slice(0, 3)) {
    addRecord('01 官方与主体', {
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
    [`${context.brandName} 官网 官方`, '官网检索', '核验品牌官网、官方介绍、产品服务和联系方式'],
    [`${context.companyName || context.brandName} 企业信息`, '企业信息检索', '核验工商主体、品牌归属、资质和经营范围'],
    [`${context.brandName} ${context.profile.productWord}`, '品牌品类检索', `核验品牌与${context.profile.productWord}的关联是否清晰`]
  ];

  if (context.profile.featuredProduct) {
    searchTasks.push(
      [`${context.brandName} ${context.profile.featuredProduct} 官方`, '产品归属检索', `核验“${context.profile.featuredProduct}”是否为${context.brandName}官方产品、系列或服务`],
      [`${context.profile.featuredProduct} ${context.brandName} 口碑 价格 卖点`, '产品卖点检索', `了解“${context.profile.featuredProduct}”的产品特性、市场卖点、用户评价和风险点`],
      [`${context.profile.featuredProduct} 是什么 ${context.profile.productWord}`, '产品品类检索', `判断“${context.profile.featuredProduct}”属于具体产品、系列名还是行业通用品类`]
    );
  }

  for (const [angle, type, note] of context.profile.sourceAngles) {
    searchTasks.push([`${context.brandName} ${angle}`, type, note]);
  }

  for (const [platform, type, note] of (context.profile.contentPlatforms || [])) {
    const queryParts = [
      context.brandName,
      context.profile.featuredProduct,
      context.profile.productWord,
      note
    ].filter(Boolean);
    searchTasks.push([
      `${platform} ${queryParts.join(' ')}`,
      type,
      `优先在${platform}核验：${note}`
    ]);
  }

  for (const criterion of context.profile.purchaseCriteria.slice(0, 6)) {
    searchTasks.push([`${context.brandName} ${context.profile.productWord} ${criterion}`, '用户决策信源', `围绕用户关心的“${criterion}”收集公开证据`]);
  }

  for (const risk of context.profile.riskChecks.slice(0, 3)) {
    searchTasks.push([`${context.brandName} ${risk}`, '风险检索', `核验是否存在${risk}相关争议或信息缺口`]);
  }

  for (const competitor of context.competitors.slice(0, 3)) {
    searchTasks.push([`${context.brandName} ${competitor} ${context.profile.productWord} 对比`, '竞品对比检索', `查找${context.profile.productWord}场景下品牌与竞品的差异`]);
  }

  for (const [query, type, note] of searchTasks) {
    if (!query.trim()) continue;
    addRecord(layerFromSourceType(type), {
      项目编号: projectId,
      品牌名称: context.brandName,
      信源名称: query,
      信源类型: type,
      链接: buildSearchUrl(query),
      是否官方: '待核验',
      可信度: '待核验',
      核心信息摘要: `围绕${context.profile.categoryName}自动生成的待检索任务：${query}`,
      问题或缺口: note,
      采集时间: submittedAt
    });
  }

  return dedupeBy(records, (item) => `${item.信源类型}:${item.信源名称}:${item.链接}`).slice(0, 30);
}

function generateKeywords({ context, projectId }) {
  const records = [];
  let order = 0;
  const add = (keyword, type, intent, priority = '中', note = 'P1 自动生成，待人工审核') => {
    const cleanKeyword = normalizeKeyword(keyword);
    if (!cleanKeyword) return;
    order += 1;
    records.push(withWorkbenchMeta({
      context,
      projectId,
      layer: layerFromKeywordType(type),
      order,
      fields: {
      项目编号: projectId,
      品牌名称: context.brandName,
      关键词: cleanKeyword,
      关键词类型: type,
      用户意图: intent,
      优先级: priority,
      备注: note
      }
    }));
  };

  add(context.brandName, '品牌词', '用户直接查询品牌', '高');
  add(context.companyName, '品牌词', '用户通过企业主体查询品牌', '中');
  add(context.industry, '行业词', '用户查找行业服务或解决方案', '高');
  add(context.segment, '业务词', '用户查找细分服务能力', '高');
  add(context.profile.categoryName, '品类词', '用户按品类寻找可选品牌', '高');
  add(context.profile.productWord, '品类词', '用户直接搜索产品或服务品类', '高');
  add(context.profile.featuredProduct, '产品词', '用户查询品牌具体产品、服务或单品', '高');

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
  for (const keyword of context.profile.hotKeywords) {
    add(keyword, '行业热门词', `用户围绕${context.profile.productWord}做真实搜索或选购`, '高', `来自${context.profile.categoryName}品类画像`);
  }
  for (const template of context.profile.brandKeywordTemplates) {
    add(template.replace('{brand}', context.brandName), '品牌热门词', '用户带品牌名查询产品、口碑、价格、体验或风险', '高', `来自${context.profile.categoryName}品类画像`);
  }
  for (const criterion of context.profile.purchaseCriteria) {
    add(`${context.profile.productWord} ${criterion}`, '决策关注词', `用户选择${context.profile.productWord}时关注${criterion}`, '中', `来自${context.profile.categoryName}品类画像`);
  }
  for (const scene of context.profile.scenarios) {
    add(`${scene} ${context.profile.productWord}`, '场景词', `用户在${scene}场景下提出需求`, '中', `来自${context.profile.categoryName}品类画像`);
  }
  for (const competitor of context.competitors) {
    add(competitor, '竞品词', '用户比较竞品与替代方案', '中');
  }
  for (const goal of context.goals) {
    add(goal, '诊断目标词', '本次GEO诊断关注点', '高');
  }

  add('AI搜索推荐', 'GEO诊断词', '用户希望AI推荐合适品牌', '高');
  add('品牌AI可见度', 'GEO诊断词', '判断品牌是否能被AI正确识别', '高');
  add('AI回答信源可信度', 'GEO诊断词', '判断AI回答背后的公开依据是否可靠', '中');

  return dedupeBy(records, (item) => item.关键词).slice(0, 36);
}

function generateIndustryQuestions({ context, projectId }) {
  const industry = context.industry || '相关行业';
  const profile = context.profile;
  const records = [];
  let order = 0;

  const add = ({ question, type, scene, priority = '中', included = '是' }) => {
    order += 1;
    records.push(withWorkbenchMeta({
      context,
      projectId,
      layer: layerFromQuestionType(type),
      order,
      fields: {
      项目编号: projectId,
      行业: industry,
      问题: question,
      问题类型: type,
      用户场景: scene,
      优先级: priority,
      是否纳入检测: included,
      备注: `P1 自动生成，基于${profile.categoryName}品类画像和客户真实决策场景，需人工审核`
      }
    }));
  };

  buildRealUserQuestions(context).forEach(add);

  return dedupeBy(records, (item) => item.问题).slice(0, 15);
}

function buildRealUserQuestions(context) {
  const brand = context.brandName || '这个品牌';
  const profile = context.profile;
  const product = profile.productWord || '产品服务';
  const featuredProduct = profile.featuredProduct && profile.featuredProduct !== product ? profile.featuredProduct : '';
  const criterionA = profile.purchaseCriteria[0] || '体验';
  const criterionB = profile.purchaseCriteria[1] || '价格';
  const criterionC = profile.purchaseCriteria[2] || '服务';
  const sceneA = profile.scenarios[0] || '日常选择';
  const sceneB = profile.scenarios[1] || '预算有限';
  const sceneC = profile.scenarios[2] || '对比选择';
  const audience = normalizeQuestionPhrase(firstPhrase(context.audiences) || profile.userRole);
  const competitor = context.competitors[0] || `同类${product}品牌`;
  const market = context.markets[0] || '中国市场';
  const globalMarket = context.markets.find((item) => /全球|海外|国际|出海/.test(item)) || '海外市场';

  if (/咖啡|饮品|食品零售|茶饮/.test(profile.categoryName)) {
    return [
      q(`我平时上班想点一杯不踩雷的咖啡，${brand}有哪些单品值得试？`, '推荐型', '消费者按日常饮用场景寻求单品推荐', '高'),
      q(`${brand}的${featuredProduct || '热门系列'}适合什么口味的人？和普通拿铁、美式有什么区别？`, '产品识别型', '消费者了解品牌具体产品', '高'),
      q(`如果我更在意${criterionA}和${criterionB}，${brand}和${competitor}怎么选？`, '比较型', '消费者在同品类品牌之间比较', '高'),
      q(`外卖点${brand}时，哪些饮品比较稳定，哪些情况容易踩雷？`, '场景型', '外卖消费前的风险判断', '高'),
      q(`${brand}的热量、甜度、咖啡因和配料信息可靠吗？我应该看哪些官方或第三方资料？`, '信任型', '消费者核验健康和成分信息', '中'),
      q(`最近想尝试咖啡新品，${brand}有没有比星巴克、库迪更适合年轻人的选择？`, '推荐型', '新品尝鲜和品牌对比', '中'),
      q(`${market}现在平价咖啡品牌很多，${brand}真正的优势和短板是什么？`, '行业洞察型', '用户理解品类竞争格局', '中'),
      q(`如果我只看大众点评、小红书和外卖评价，怎么判断${brand}的口味和门店体验是否稳定？`, '信源型', '用户验证多平台口碑', '中')
    ];
  }

  if (/旅游保险|旅行社服务|保险/.test(profile.categoryName)) {
    return [
      q(`旅行社要给研学团或团队游买保险，应该怎么判断${brand}是否靠谱？`, '推荐型', '旅行社负责人按业务场景寻找保险服务商', '高'),
      q(`${brand}主要做什么业务？它和旅游保险、旅行社责任险、旅意险有什么关系？`, '品牌识别型', '客户先确认品牌主体和业务边界', '高'),
      q(`${brand}的出单效率、承保公司、理赔服务和客服响应怎么样？`, '选型型', '旅行社评估服务能力', '高'),
      q(`如果我正在比较${brand}和${competitor}，谁更适合旅行社长期合作？`, '比较型', '用户比较服务商和替代方案', '高'),
      q(`${brand}有哪些官方资质、承保信息或公开案例能证明它不是普通中介介绍？`, '信任型', '用户核验资质和可信信源', '高'),
      q(`旅行社买保险时最容易忽略哪些责任边界、理赔材料和拒赔风险？${brand}能不能讲清楚？`, '风险型', '用户关注理赔和合规风险', '中'),
      q(`做研学、户外或团建活动时，${brand}能提供哪些更匹配场景的保险方案？`, '场景型', '用户按出行场景询问方案', '中'),
      q(`如果只看AI回答，怎么判断${brand}关于保险产品和承保方的信息是否准确？`, '准确性型', '用户检查AI回答是否可靠', '中')
    ];
  }

  if (/软件|互联网|SaaS/.test(profile.categoryName)) {
    return [
      q(`我们团队想选一套${product}，${brand}适合什么规模和场景的公司？`, '推荐型', '企业客户按使用场景选型', '高'),
      q(`${brand}的核心功能、价格、部署方式和售后支持分别是什么？`, '品牌识别型', '用户确认产品边界', '高'),
      q(`如果我在比较${brand}和${competitor}，谁更适合看重${criterionA}和${criterionB}的团队？`, '比较型', '企业选型对比', '高'),
      q(`${brand}有没有公开客户案例、产品文档或第三方评价可以参考？`, '信任型', '用户核验信源', '高'),
      q(`${brand}在数据安全、权限管理和系统对接上有什么需要提前确认的？`, '风险型', '企业采购前风险确认', '中'),
      q(`预算有限但想提升效率，${brand}是不是比同类${product}更值得试用？`, '选型型', '预算敏感型选型', '中')
    ];
  }

  return [
    q(`第一次了解${brand}，它主要解决什么问题，适合什么样的${audience}？`, '品牌识别型', '用户初次了解品牌', '高'),
    q(`如果我正在${sceneA}，${brand}是不是值得优先考虑？为什么？`, '推荐型', '用户按真实场景寻求推荐', '高'),
    q(`${brand}和${competitor}相比，谁更适合看重${criterionA}和${criterionB}的用户？`, '比较型', '用户做竞品比较', '高'),
    q(`${brand}有哪些公开案例、评价或资质可以证明它在${product}上可靠？`, '信任型', '用户核验可信度', '高'),
    q(`选择${product}时，用户最容易忽略哪些风险？${brand}有没有解释清楚？`, '风险型', '用户做风险判断', '中'),
    q(`在${sceneB}或${sceneC}场景下，${brand}的优势和短板分别是什么？`, '场景型', '用户按场景判断适配度', '中')
  ];
}

function q(question, type, scene, priority = '中', included = '是') {
  return { question, type, scene, priority, included };
}

function generateAiQuestions({ industryQuestions, context, projectId }) {
  const selected = industryQuestions
    .filter((item) => item.是否纳入检测 === '是')
    .sort((a, b) => priorityScore(b.优先级) - priorityScore(a.优先级))
    .slice(0, 6);
  const records = [];

  selected.forEach((question, questionIndex) => {
    DEFAULT_PLATFORMS.forEach((platform, platformIndex) => {
      records.push(withWorkbenchMeta({
        context,
        projectId,
        layer: `05 AI检测/${platform}`,
        order: questionIndex * DEFAULT_PLATFORMS.length + platformIndex + 1,
        fields: {
        项目编号: projectId,
        问题编号: `Q${String(questionIndex + 1).padStart(3, '0')}-${String(platformIndex + 1).padStart(2, '0')}`,
        检测问题: question.问题,
        问题类型: question.问题类型,
        目标平台: platform,
        预期识别点: buildExpectedSignal(context, question),
        检测状态: '待测试',
        负责人: process.env.DEFAULT_OWNER || 'GeoGi 负责人',
        备注: 'P1 自动生成。测试时需记录AI原始回答、是否提及品牌、是否主动推荐、引用信源。'
        }
      }));
    });
  });

  return records;
}

function buildExpectedSignal(context, question) {
  const type = clean(question.问题类型);
  const text = clean(question.问题);
  const profile = context.profile;
  const criteria = profile.purchaseCriteria.slice(0, 3).join('、');
  const featuredProduct = profile.featuredProduct && text.includes(profile.featuredProduct) ? profile.featuredProduct : '';
  const competitor = context.competitors.find((item) => text.includes(item)) || context.competitors[0] || '';
  const platformSources = (profile.contentPlatforms || []).slice(0, 3).map(([name]) => name).join('、');
  const signals = [];

  signals.push(`必须识别品牌主体：${context.brandName}`);
  if (profile.productWord) signals.push(`必须贴合品类/业务：${profile.productWord}`);
  if (featuredProduct) signals.push(`必须说明“${featuredProduct}”是${context.brandName}的产品/系列/服务候选，而不是行业通用品类`);

  if (/推荐/.test(type)) {
    signals.push(`需要站在${profile.userRole}决策场景给出是否推荐、适合谁、不适合谁`);
    signals.push(criteria ? `推荐理由需覆盖：${criteria}` : '推荐理由需覆盖真实选择因素');
  } else if (/产品/.test(type)) {
    signals.push('需要解释产品卖点、适用人群、与主品牌的关系和常见误解');
  } else if (/比较/.test(type)) {
    signals.push(competitor ? `需要与${competitor}按同一维度比较，不只给泛泛优缺点` : '需要与同类品牌按同一维度比较');
    signals.push(criteria ? `比较维度优先使用：${criteria}` : '比较维度需贴近用户决策');
  } else if (/信任|信源|准确/.test(type)) {
    signals.push(platformSources ? `需要给出可核验信源方向：${platformSources}` : '需要给出官方、第三方和用户口碑信源');
    signals.push('需要区分已证实信息、待核验信息和AI推测内容');
  } else if (/风险/.test(type)) {
    signals.push(`需要指出${profile.riskChecks.slice(0, 3).join('、')}等潜在风险`);
    signals.push('需要给出用户下一步核验动作');
  } else {
    signals.push(criteria ? `回答应覆盖用户关注点：${criteria}` : '回答应贴近用户真实决策场景');
  }

  return unique(signals).join('；');
}

function withWorkbenchMeta({ context, projectId, layer, order, fields }) {
  return {
    品牌分组: brandGroup(context, projectId),
    排序键: sortKey(context, projectId, layer, order),
    信息层级: layer,
    审核状态: '待人工审核',
    ...fields
  };
}

function brandGroup(context, projectId) {
  return `${context.brandName || '未命名品牌'}｜${projectId}`;
}

function sortKey(context, projectId, layer, order) {
  return [
    context.brandName || '未命名品牌',
    projectId,
    layer || '99',
    String(order || 0).padStart(3, '0')
  ].join('｜');
}

function layerFromSourceType(type) {
  if (/官方|官网|企业|资质/.test(type)) return '01 官方与主体';
  if (/产品/.test(type)) return '02 产品与品类';
  if (/用户|口碑|体验|趋势|渠道|成分|案例/.test(type)) return '03 用户决策';
  if (/竞品/.test(type)) return '04 竞品对比';
  if (/风险|舆情/.test(type)) return '06 风险核验';
  return '03 用户决策';
}

function layerFromKeywordType(type) {
  if (/品牌/.test(type)) return '01 品牌词';
  if (/品类|产品|业务|行业/.test(type)) return '02 品类产品词';
  if (/热门|决策|场景|优势/.test(type)) return '03 用户需求词';
  if (/竞品/.test(type)) return '04 竞品词';
  return '05 诊断词';
}

function layerFromQuestionType(type) {
  if (/品牌|产品/.test(type)) return '01 品牌产品理解';
  if (/推荐|选购|选型|场景/.test(type)) return '02 用户决策问题';
  if (/比较|竞品/.test(type)) return '03 竞品比较问题';
  if (/信任|信源|准确/.test(type)) return '04 信源准确问题';
  if (/风险/.test(type)) return '05 风险核验问题';
  return '02 用户决策问题';
}

function normalizeKeyword(value) {
  return clean(value)
    .replace(/\bAI\s+/gi, 'AI')
    .replace(/\s+AI\b/gi, 'AI')
    .replace(/\bGEO\s+/gi, 'GEO')
    .replace(/\s+GEO\b/gi, 'GEO')
    .replace(/\s+/g, ' ');
}

function normalizeQuestionPhrase(value) {
  return clean(value)
    .replace(/[。；;，,]+$/g, '')
    .replace(/\s+/g, '');
}

function extractUrls(value) {
  return String(value || '').match(/https?:\/\/[^\s，,、；;]+/g) || [];
}

function buildSearchUrl(query) {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
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

function pickProductWord(context, fallbacks) {
  const candidates = [
    firstPhrase(context.offerings),
    context.segment,
    context.industry
  ].map(normalizeQuestionPhrase).filter(Boolean);
  const selected = candidates.find((item) => item.length >= 2 && item.length <= 14);
  return selected || fallbacks[0] || '产品服务';
}

function pickKnownProductWord(context, candidates) {
  const haystack = [
    context.brandName,
    context.industry,
    context.segment,
    context.offerings,
    context.audiences,
    context.advantages
  ].join(' ');
  return candidates.find((item) => haystack.includes(item) && /咖啡|旅游保险|旅行社保险|SaaS|软件/.test(item))
    || candidates.find((item) => haystack.includes(item) && /饮品|食品饮料/.test(item))
    || candidates.find((item) => haystack.includes(item))
    || candidates[0]
    || pickProductWord(context, candidates);
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
  generateDiagnosisAssets,
  buildDiagnosisContext: buildContext
};
