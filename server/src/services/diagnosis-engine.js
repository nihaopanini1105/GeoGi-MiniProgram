const DEFAULT_PLATFORMS = ['DeepSeek', 'Kimi', '豆包', '通义千问', '腾讯元宝'];

const INDUSTRY_PROFILE_BASE = {
  '旅游与文旅': {
    userRole: '游客、亲子家庭或文旅项目负责人',
    decisionVerb: '选择',
    productWord: '文旅服务',
    purchaseCriteria: ['目的地资源', '行程体验', '服务保障', '价格透明', '安全合规', '口碑评价', '交通住宿', '售后响应'],
    sourceAngles: [
      ['官方资质和经营主体', '资质信源', '核验旅行社、景区、酒店或文旅项目主体与资质'],
      ['真实游玩和服务体验', '体验信源', '观察游客评价、笔记、攻略和投诉'],
      ['价格套餐和预订渠道', '交易信源', '核验套餐内容、预订方式、退款改期规则'],
      ['目的地内容和达人攻略', '内容信源', '判断AI是否理解目的地、线路和适合人群'],
      ['安全、保险和应急保障', '风险信源', '核验安全提醒、保险、应急和售后机制']
    ],
    hotKeywords: ['旅行推荐', '亲子游推荐', '研学旅行', '景区攻略', '酒店民宿推荐', '定制旅行', '目的地怎么玩', '旅游避坑'],
    brandKeywordTemplates: ['{brand} 怎么样', '{brand} 攻略', '{brand} 价格', '{brand} 评价', '{brand} 适合亲子吗', '{brand} 预订', '{brand} 避坑'],
    scenarios: ['亲子出游', '周末短途', '团队出行', '研学活动', '自由行规划', '预算有限', '第一次到访'],
    riskChecks: ['资质不清', '实际体验和宣传不一致', '退改规则不清', '安全保障不足', '差评和投诉']
  },
  '企业服务': {
    userRole: '企业负责人、市场负责人或业务部门负责人',
    decisionVerb: '选择',
    productWord: '企业服务商',
    purchaseCriteria: ['专业能力', '行业经验', '案例结果', '价格和交付周期', '服务响应', '团队资质', '数据安全', '长期合作价值'],
    sourceAngles: [
      ['官网服务说明和案例', '官方信源', '核验服务范围、交付流程、案例和联系方式'],
      ['客户案例和行业口碑', '案例口碑信源', '判断服务商是否有真实行业经验和可验证结果'],
      ['团队资质和主体信息', '资质信源', '核验工商主体、团队背景、资质和合作伙伴'],
      ['行业内容和专业观点', '内容信源', '判断是否有专业文章、白皮书、方法论和公开观点'],
      ['风险与合同边界', '风险信源', '核验交付边界、收费方式、售后和争议风险']
    ],
    hotKeywords: ['企业服务商推荐', '品牌营销公司', '咨询公司推荐', '人力资源服务', '财税法务服务', '销售获客', '企业培训'],
    brandKeywordTemplates: ['{brand} 是什么', '{brand} 案例', '{brand} 价格', '{brand} 口碑', '{brand} 服务范围', '{brand} 对比', '{brand} 靠谱吗'],
    scenarios: ['首次采购', '预算有限', '需要快速交付', '长期合作', '替换服务商', '验证案例真实性'],
    riskChecks: ['案例真实性不足', '交付边界不清', '报价不透明', '售后响应不稳定', '资质和团队背景不清']
  },
  '软件与互联网': {
    userRole: '企业负责人或业务团队',
    decisionVerb: '选型',
    productWord: '软件系统',
    purchaseCriteria: ['功能匹配', '易用性', '价格', '数据安全', '集成能力', '服务响应', '案例', '部署方式'],
    sourceAngles: [
      ['产品功能说明', '产品信源', '核验核心功能、适用对象和使用流程'],
      ['客户案例和行业方案', '案例信源', '证明产品在真实行业里的使用效果'],
      ['价格和版本', '选型信源', '核验套餐、试用、交付周期和费用边界'],
      ['安全和合规', '风险信源', '核验数据安全、权限、隐私和系统稳定性'],
      ['集成和部署', '技术信源', '核验API、系统对接、私有化或云部署能力']
    ],
    hotKeywords: ['SaaS软件推荐', '企业软件选型', '好用的AI工具', '业务系统推荐', '软件价格', '软件对比', '数字化工具'],
    brandKeywordTemplates: ['{brand} 是什么', '{brand} 好用吗', '{brand} 价格', '{brand} 功能', '{brand} 案例', '{brand} 替代方案', '{brand} 对比'],
    scenarios: ['企业选型', '团队提效', '系统替换', '预算有限', '数据安全评估', '对接现有系统'],
    riskChecks: ['功能边界不清', '价格不透明', '客户案例不足', '数据安全说明不足', '售后服务不明确']
  },
  '消费品与零售': {
    userRole: '消费者或渠道采购负责人',
    decisionVerb: '购买',
    productWord: '消费品',
    purchaseCriteria: ['品质口碑', '价格优惠', '成分材质', '使用体验', '渠道便利', '售后保障', '品牌信任', '复购评价'],
    sourceAngles: [
      ['产品卖点和成分材质', '产品信源', '核验产品参数、成分、材质、规格和适用人群'],
      ['用户口碑和真实体验', '口碑信源', '观察小红书、抖音、电商和点评里的真实反馈'],
      ['价格渠道和促销', '交易信源', '核验官方旗舰店、渠道价格、优惠和售后'],
      ['测评榜单和达人内容', '测评信源', '判断AI是否引用测评、榜单、达人体验和种草内容'],
      ['质量投诉和风险舆情', '风险信源', '识别质量、假货、售后、过敏或安全争议']
    ],
    hotKeywords: ['好物推荐', '品牌推荐', '小红书推荐', '值得买吗', '测评', '性价比', '避坑', '旗舰店'],
    brandKeywordTemplates: ['{brand} 怎么样', '{brand} 值得买吗', '{brand} 测评', '{brand} 价格', '{brand} 旗舰店', '{brand} 口碑', '{brand} 避坑'],
    scenarios: ['首次购买', '送礼', '日常使用', '囤货复购', '对比竞品', '关注安全成分'],
    riskChecks: ['质量争议', '售后投诉', '成分材质不清', '真假货渠道混乱', '评价两极分化']
  },
  '教育培训': {
    userRole: '学生、家长、职场人或企业培训负责人',
    decisionVerb: '报名',
    productWord: '教育培训服务',
    purchaseCriteria: ['师资能力', '课程体系', '学习效果', '价格和课时', '证书认可', '服务督学', '口碑案例', '退费政策'],
    sourceAngles: [
      ['课程体系和师资', '课程信源', '核验课程内容、师资背景、适合人群和学习路径'],
      ['学员案例和口碑', '口碑信源', '观察学员反馈、通过率、作品和就业升学结果'],
      ['资质认证和证书', '资质信源', '核验办学资质、授权认证和证书含金量'],
      ['价格课时和退费', '交易信源', '核验收费、课时、合同和退费政策'],
      ['投诉与承诺风险', '风险信源', '识别夸大宣传、退费纠纷和效果承诺风险']
    ],
    hotKeywords: ['课程推荐', '培训机构推荐', '职业教育', '企业培训', '留学语培', 'K12素质教育', '知识付费', '教育科技'],
    brandKeywordTemplates: ['{brand} 课程怎么样', '{brand} 师资', '{brand} 价格', '{brand} 退费', '{brand} 学员评价', '{brand} 证书', '{brand} 靠谱吗'],
    scenarios: ['提升技能', '考试备考', '孩子素质培养', '企业内训', '留学申请', '转行就业'],
    riskChecks: ['师资不透明', '效果承诺过度', '退费纠纷', '证书认可度不清', '课程交付不稳定']
  },
  '医疗健康': {
    userRole: '患者、健康管理用户或家庭决策者',
    decisionVerb: '选择',
    productWord: '医疗健康服务',
    purchaseCriteria: ['专业资质', '医生团队', '安全性', '效果证据', '价格透明', '服务体验', '隐私保护', '售后复诊'],
    sourceAngles: [
      ['医疗资质和医生团队', '资质信源', '核验执业资质、医生背景、机构许可和备案'],
      ['服务项目和适用人群', '产品信源', '核验项目说明、适应症、禁忌和服务流程'],
      ['真实评价和案例', '口碑信源', '观察患者评价、案例展示和第三方平台反馈'],
      ['价格和风险告知', '交易风险信源', '核验价格、疗程、知情同意和风险提示'],
      ['投诉舆情和合规', '风险信源', '识别医疗安全、虚假宣传、隐私和售后争议']
    ],
    hotKeywords: ['健康管理推荐', '医院/诊所推荐', '医美口腔', '营养保健', '康复护理', '医疗科技', '医生评价', '靠谱吗'],
    brandKeywordTemplates: ['{brand} 靠谱吗', '{brand} 医生', '{brand} 价格', '{brand} 效果', '{brand} 评价', '{brand} 资质', '{brand} 风险'],
    scenarios: ['初次咨询', '比较机构', '关注安全风险', '复诊护理', '长期健康管理', '家人决策'],
    riskChecks: ['资质不清', '效果夸大', '价格不透明', '隐私合规不足', '医疗投诉和安全风险']
  },
  '其他行业': {
    userRole: '目标客户或采购决策人',
    decisionVerb: '选择',
    productWord: '产品或服务',
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
    riskChecks: ['官方信息不完整', '案例不足', '口碑不稳定', '竞品解释不清', '联系方式或主体不一致']
  }
};

const SEGMENT_PROFILE_OVERRIDES = {
  定制旅行: { productWord: '定制旅行服务', userRole: '高净值游客、家庭或企业出行负责人', purchaseCriteria: ['行程定制能力', '目的地资源', '顾问响应', '价格透明', '安全保障', '真实口碑'], scenarios: ['家庭度假', '蜜月旅行', '企业团建', '小众目的地', '预算确认'], hotKeywords: ['定制旅行推荐', '私人定制旅行', '高端旅行社', '旅行顾问', '小团定制游'] },
  目的地服务: { productWord: '目的地服务', userRole: '自由行游客、旅行社或地接合作方', purchaseCriteria: ['本地资源', '接待能力', '路线熟悉度', '应急响应', '价格透明', '评价口碑'], scenarios: ['自由行落地服务', '团队接待', '当地玩乐', '交通接送', '临时改行程'], hotKeywords: ['目的地服务', '当地地接', '自由行当地向导', '包车导游', '目的地怎么玩'] },
  '景区/乐园': { productWord: '景区乐园', userRole: '游客、亲子家庭或团体活动负责人', purchaseCriteria: ['游玩项目', '排队体验', '票价套餐', '交通便利', '安全管理', '游客评价'], scenarios: ['亲子游玩', '周末出行', '团体票', '节假日避坑', '夜场活动'], hotKeywords: ['景区攻略', '乐园推荐', '门票优惠', '亲子乐园', '景区避坑'] },
  酒店民宿: { productWord: '酒店民宿', userRole: '住客、亲子家庭或差旅用户', purchaseCriteria: ['位置交通', '卫生舒适', '价格套餐', '服务体验', '亲子设施', '真实评价'], scenarios: ['亲子入住', '商务差旅', '周末度假', '长住短租', '临近景区'], hotKeywords: ['酒店推荐', '民宿推荐', '亲子酒店', '酒店避坑', '住客评价'] },
  文旅营销: { productWord: '文旅营销服务', userRole: '景区、目的地或文旅项目负责人', purchaseCriteria: ['传播策划', '内容创意', '达人资源', '转化效果', '案例经验', '投放数据'], scenarios: ['目的地推广', '节庆活动', '招商引流', '短视频种草', '文旅IP打造'], hotKeywords: ['文旅营销公司', '目的地营销', '景区推广', '文旅IP', '短视频文旅营销'] },
  '研学/亲子游': { productWord: '研学亲子游服务', userRole: '家长、学校或研学机构负责人', purchaseCriteria: ['课程设计', '安全保障', '师资带队', '营地资源', '价格透明', '家长评价'], scenarios: ['暑期研学', '学校实践', '亲子营地', '户外活动', '安全评估'], hotKeywords: ['研学旅行推荐', '亲子游推荐', '研学机构', '营地教育', '研学安全'] },

  品牌营销: { productWord: '品牌营销服务', userRole: '品牌负责人或市场负责人', purchaseCriteria: ['策略能力', '创意内容', '投放转化', '行业案例', '数据复盘', '团队经验'], scenarios: ['新品上市', '品牌升级', '获客增长', '内容种草', '预算有限'], hotKeywords: ['品牌营销公司', '整合营销', '小红书营销', '抖音代运营', '品牌策划'] },
  咨询服务: { productWord: '咨询服务', userRole: '企业老板或业务负责人', purchaseCriteria: ['方法论', '顾问经验', '行业案例', '落地能力', '交付周期', '报价透明'], scenarios: ['战略调整', '组织优化', '增长诊断', '流程改善', '融资前梳理'], hotKeywords: ['咨询公司推荐', '管理咨询', '战略咨询', '企业诊断', '咨询顾问'] },
  人力资源: { productWord: '人力资源服务', userRole: 'HR负责人或企业管理者', purchaseCriteria: ['招聘效率', '人才质量', '合规用工', '服务响应', '行业人才库', '价格透明'], scenarios: ['批量招聘', '高端猎头', '灵活用工', '薪酬绩效', '用工合规'], hotKeywords: ['人力资源公司', '猎头推荐', '灵活用工', '招聘外包', '薪酬绩效'] },
  财税法务: { productWord: '财税法务服务', userRole: '创业者、企业老板或财务负责人', purchaseCriteria: ['专业资质', '合规经验', '响应速度', '收费透明', '风险提示', '案例经验'], scenarios: ['公司注册', '税务筹划', '合同审核', '知识产权', '劳动纠纷'], hotKeywords: ['财税公司', '法律服务', '税务筹划', '代理记账', '合同审核'] },
  销售获客: { productWord: '销售获客服务', userRole: '销售负责人或增长负责人', purchaseCriteria: ['线索质量', '转化率', '渠道合规', '行业资源', '数据透明', '交付周期'], scenarios: ['B2B获客', '电话销售', '私域增长', '渠道拓展', '销售外包'], hotKeywords: ['销售获客', 'B2B获客', '线索获取', '销售外包', '私域增长'] },
  企业培训: { productWord: '企业培训服务', userRole: 'HR、培训负责人或业务管理者', purchaseCriteria: ['课程实用性', '讲师经验', '行业案例', '落地工具', '培训效果', '定制能力'], scenarios: ['新员工培训', '管理干部培训', '销售培训', '内训体系', '年度培训计划'], hotKeywords: ['企业培训机构', '内训课程', '管理培训', '销售培训', '培训讲师'] },

  'SaaS 软件': { productWord: 'SaaS软件', userRole: '企业负责人、IT负责人或业务团队', hotKeywords: ['SaaS软件推荐', 'SaaS选型', '企业SaaS', '软件价格', '软件对比'] },
  'AI 工具': { productWord: 'AI工具', userRole: '业务团队、运营人员或企业负责人', purchaseCriteria: ['生成效果', '易用性', '价格额度', '数据安全', '场景模板', '集成能力'], scenarios: ['内容生成', '客服提效', '数据分析', '办公自动化', '私有化部署'], hotKeywords: ['AI工具推荐', 'AI办公工具', 'AI客服', 'AI写作', 'AI数据分析'] },
  数据服务: { productWord: '数据服务', userRole: '数据负责人、市场负责人或业务分析团队', purchaseCriteria: ['数据覆盖', '准确性', '更新频率', '接口能力', '合规来源', '分析能力'], scenarios: ['市场调研', '竞品监测', '用户画像', '风控合规', '数据接口'], hotKeywords: ['数据服务公司', '数据接口', '行业数据', '用户画像', '数据分析平台'] },
  电商平台: { productWord: '电商平台', userRole: '消费者、商家或品牌运营负责人', purchaseCriteria: ['商品供给', '价格优惠', '物流售后', '商家服务', '流量资源', '平台规则'], scenarios: ['开店入驻', '购物比价', '直播带货', '私域电商', '售后维权'], hotKeywords: ['电商平台推荐', '开店平台', '直播电商', '私域电商', '电商代运营'] },
  内容社区: { productWord: '内容社区', userRole: '内容创作者、品牌运营或兴趣用户', purchaseCriteria: ['用户活跃', '内容质量', '社区氛围', '商业化能力', '审核规则', '增长机制'], scenarios: ['内容种草', '社区运营', '创作者变现', '品牌阵地', '用户互动'], hotKeywords: ['内容社区', '社区运营', '创作者平台', '内容平台推荐', '品牌社区'] },
  开发者服务: { productWord: '开发者服务', userRole: '开发者、技术负责人或产品团队', purchaseCriteria: ['API稳定性', '文档完整', '价格计费', '技术支持', '生态兼容', '安全合规'], scenarios: ['API接入', '云服务选型', '应用开发', '技术迁移', '故障排查'], hotKeywords: ['开发者服务', 'API平台', '云服务推荐', '开发工具', '技术文档'] },

  食品饮料: { productWord: '食品饮料', userRole: '消费者、渠道采购或门店经营者', purchaseCriteria: ['口味', '品质安全', '价格优惠', '配料成分', '渠道便利', '复购口碑'], scenarios: ['日常购买', '送礼', '囤货', '新品尝鲜', '低糖健康'], hotKeywords: ['食品饮料推荐', '好喝推荐', '零食饮料', '配料表', '食品安全'] },
  美妆个护: { productWord: '美妆个护产品', userRole: '护肤彩妆消费者或美妆渠道采购', purchaseCriteria: ['肤质适配', '成分功效', '安全温和', '价格', '真实测评', '售后渠道'], scenarios: ['敏感肌', '抗老美白', '化妆通勤', '送礼', '成分党比较'], hotKeywords: ['美妆推荐', '护肤品推荐', '成分测评', '敏感肌', '美妆避坑'] },
  服饰配饰: { productWord: '服饰配饰', userRole: '穿搭消费者或渠道买手', purchaseCriteria: ['版型尺码', '材质做工', '风格适配', '价格', '退换货', '穿搭口碑'], scenarios: ['通勤穿搭', '送礼', '换季购买', '尺码选择', '品牌对比'], hotKeywords: ['服装品牌推荐', '穿搭推荐', '尺码避坑', '配饰推荐', '材质测评'] },
  母婴亲子: { productWord: '母婴亲子产品', userRole: '宝妈宝爸或亲子家庭', purchaseCriteria: ['安全材质', '年龄适配', '专业认证', '真实口碑', '价格', '售后保障'], scenarios: ['新手爸妈', '宝宝用品', '亲子活动', '送礼', '安全认证'], hotKeywords: ['母婴产品推荐', '宝宝用品', '儿童安全', '亲子推荐', '母婴避坑'] },
  家居生活: { productWord: '家居生活产品', userRole: '家庭用户、租房用户或装修用户', purchaseCriteria: ['实用性', '材质环保', '安装售后', '空间适配', '价格', '耐用性'], scenarios: ['新房装修', '租房改造', '收纳清洁', '智能家居', '家庭送礼'], hotKeywords: ['家居好物', '智能家居', '收纳推荐', '家居避坑', '装修清单'] },
  线下零售: { productWord: '线下零售服务', userRole: '本地消费者或门店经营者', purchaseCriteria: ['门店位置', '商品丰富度', '价格优惠', '服务体验', '会员权益', '售后便利'], scenarios: ['附近购买', '会员优惠', '到店体验', '节日采购', '售后退换'], hotKeywords: ['附近门店', '零售品牌推荐', '会员优惠', '门店评价', '线下购物'] },

  职业教育: { productWord: '职业教育课程', userRole: '职场人、转行人群或求职者', purchaseCriteria: ['就业结果', '课程实战', '师资经验', '证书认可', '价格课时', '服务督学'], scenarios: ['转行就业', '升职加薪', '考证备考', '技能提升', '作品集'], hotKeywords: ['职业教育推荐', '转行课程', '考证培训', '就业培训', '技能提升'] },
  'K12/素质教育': { productWord: 'K12/素质教育课程', userRole: '家长和学生', purchaseCriteria: ['师资水平', '课程体系', '孩子兴趣', '学习效果', '安全管理', '家长评价'], scenarios: ['课后提升', '兴趣培养', '升学准备', '寒暑假课程', '线上线下选择'], hotKeywords: ['素质教育', 'K12培训', '儿童编程', '艺术培训', '家长评价'] },
  留学语培: { productWord: '留学语培服务', userRole: '留学生、家长或国际教育申请人', purchaseCriteria: ['提分效果', '申请案例', '顾问经验', '师资背景', '费用透明', '服务流程'], scenarios: ['雅思托福', '留学申请', '背景提升', '文书服务', '面试辅导'], hotKeywords: ['留学机构推荐', '雅思培训', '托福培训', '留学申请', '语培机构'] },
  知识付费: { productWord: '知识付费课程', userRole: '职场人、创业者或兴趣学习者', purchaseCriteria: ['内容质量', '老师背景', '案例实用', '社群服务', '价格', '更新频率'], scenarios: ['碎片学习', '副业提升', '创业学习', '社群陪跑', '课程复购'], hotKeywords: ['知识付费课程', '线上课程推荐', '付费社群', '课程评价', '课程避坑'] },
  教育科技: { productWord: '教育科技产品', userRole: '学校、机构、老师或学习者', purchaseCriteria: ['教学效果', '产品易用', '数据能力', '系统集成', '内容资源', '服务支持'], scenarios: ['智慧校园', '在线学习', '教学管理', 'AI教育', '学习数据分析'], hotKeywords: ['教育科技', '智慧校园', '在线学习平台', 'AI教育工具', '教学系统'] },

  健康管理: { productWord: '健康管理服务', userRole: '个人用户、家庭或企业员工健康负责人', purchaseCriteria: ['专业资质', '检测准确', '方案个性化', '长期跟踪', '隐私保护', '服务体验'], scenarios: ['体检后管理', '慢病管理', '减重控糖', '企业健康', '家庭健康'], hotKeywords: ['健康管理推荐', '体检后管理', '慢病管理', '减重控糖', '企业健康'] },
  医疗服务: { productWord: '医疗服务机构', userRole: '患者或家庭决策者', purchaseCriteria: ['医生资质', '诊疗能力', '就诊效率', '价格透明', '医保支付', '患者评价'], scenarios: ['初诊咨询', '复诊转诊', '专科选择', '家人就医', '费用比较'], hotKeywords: ['医院推荐', '诊所推荐', '医生评价', '专科医院', '就医攻略'] },
  医美口腔: { productWord: '医美口腔服务', userRole: '求美者或口腔治疗用户', purchaseCriteria: ['医生资质', '案例效果', '安全风险', '价格套餐', '材料设备', '售后复诊'], scenarios: ['正畸种牙', '皮肤医美', '术前咨询', '价格比较', '风险评估'], hotKeywords: ['医美机构推荐', '口腔诊所推荐', '种牙价格', '正畸医院', '医美避坑'] },
  营养保健: { productWord: '营养保健产品', userRole: '健康消费用户或家庭购买者', purchaseCriteria: ['成分功效', '适用人群', '安全认证', '品牌口碑', '价格', '服用风险'], scenarios: ['送父母', '运动营养', '孕产营养', '控糖控脂', '长期服用'], hotKeywords: ['保健品推荐', '营养品', '成分功效', '保健品避坑', '适合人群'] },
  康复护理: { productWord: '康复护理服务', userRole: '患者家属、术后人群或老人家庭', purchaseCriteria: ['护理资质', '康复方案', '安全照护', '上门便利', '价格透明', '家属评价'], scenarios: ['术后康复', '老人护理', '居家护理', '长期照护', '康复训练'], hotKeywords: ['康复护理', '上门护理', '老人护理', '术后康复', '护理机构'] },
  医疗科技: { productWord: '医疗科技产品', userRole: '医疗机构、医生或健康科技团队', purchaseCriteria: ['临床价值', '合规认证', '数据安全', '系统集成', '医生使用体验', '案例证据'], scenarios: ['医院采购', '科室试点', 'AI辅助诊断', '数据管理', '远程医疗'], hotKeywords: ['医疗科技', '医疗AI', '医疗系统', '远程医疗', '临床案例'] },

  本地生活: { productWord: '本地生活服务', userRole: '本地消费者或社区用户', purchaseCriteria: ['距离便利', '价格透明', '服务质量', '用户评价', '预约效率', '售后保障'], scenarios: ['附近服务', '临时预约', '家庭维修', '美容美发', '社区消费'], hotKeywords: ['附近服务', '本地生活推荐', '到店服务', '上门服务', '大众点评'] },
  专业服务: { productWord: '专业服务', userRole: '企业或个人决策者', purchaseCriteria: ['专业资质', '经验案例', '响应效率', '收费透明', '合规风险', '口碑评价'], scenarios: ['紧急咨询', '长期顾问', '项目交付', '资质核验', '对比服务商'], hotKeywords: ['专业服务推荐', '服务商靠谱', '顾问服务', '专业机构', '案例口碑'] },
  制造业: { productWord: '制造业产品或解决方案', userRole: '采购负责人、工程师或渠道客户', purchaseCriteria: ['产品质量', '产能交期', '认证资质', '价格', '售后服务', '定制能力'], scenarios: ['供应商选择', '样品测试', '批量采购', '交期评估', '质量认证'], hotKeywords: ['制造商推荐', '供应商选择', '工厂资质', '产品质量', 'OEM/ODM'] },
  '房地产/空间': { productWord: '房地产/空间服务', userRole: '购房租房用户、业主或空间运营方', purchaseCriteria: ['地段交通', '价格租金', '空间品质', '物业服务', '政策合规', '投资风险'], scenarios: ['租房买房', '办公选址', '商业空间', '园区招商', '物业服务'], hotKeywords: ['房产服务', '办公选址', '空间运营', '物业评价', '商业地产'] },
  '公益/机构': { productWord: '公益机构或公共服务', userRole: '捐赠人、志愿者、合作机构或受益群体', purchaseCriteria: ['机构公信力', '项目透明', '资金使用', '社会影响', '合作案例', '合规资质'], scenarios: ['捐赠前核验', '志愿服务', '公益合作', '项目评估', '信息公开'], hotKeywords: ['公益机构', '公益项目', '捐赠透明', '志愿服务', '社会组织'] }
};

const INDUSTRY_CONTENT_PLATFORMS = {
  '旅游与文旅': [
    ['携程/飞猪/同程/马蜂窝', 'OTA与攻略平台', '价格套餐、预订评价、游玩攻略和真实体验'],
    ['大众点评/小红书/抖音', '体验口碑平台', '游客笔记、探店视频、亲子体验和避坑内容'],
    ['文旅局/景区官网/公众号', '官方资质信源', '资质、票务、活动、路线和安全公告'],
    ['地图平台/OTA评价', '位置与交易评价', '交通、周边、评分、退改和服务反馈'],
    ['黑猫投诉/社媒舆情', '风险舆情', '退改纠纷、虚假宣传、安全事故和投诉']
  ],
  '企业服务': [
    ['官网/公众号/案例库', '官方案例信源', '服务范围、方法论、客户案例和联系方式'],
    ['企业信用/商标/备案平台', '主体资质信源', '工商主体、资质、商标和备案'],
    ['36氪/钛媒体/行业媒体', '行业报道信源', '融资、案例、行业观点和专业影响力'],
    ['知乎/公众号/视频号', '专业内容信源', '方法论文章、用户讨论和服务评价'],
    ['招投标/合作公告/客户官网', '客户验证信源', '真实合作、采购公告和客户背书']
  ],
  '软件与互联网': [
    ['官网/产品文档/帮助中心', '官方产品信源', '功能、价格、API、部署和使用流程'],
    ['应用市场/插件市场/GitHub', '生态与技术信源', '安装量、评分、集成和开发者反馈'],
    ['36氪/钛媒体/人人都是产品经理', '行业报道信源', '产品定位、融资、案例和竞品动态'],
    ['知乎/B站/公众号', '用户经验信源', '选型经验、教程、测评和替代方案'],
    ['G2/Capterra/Product Hunt', '全球评价信源', '海外用户评分、评论和竞品对比']
  ],
  '消费品与零售': [
    ['天猫/京东/抖音电商/拼多多', '电商交易信源', '销量、价格、评价、售后和旗舰店信息'],
    ['小红书/抖音/快手', '种草内容信源', '真实体验、达人测评、使用场景和口碑'],
    ['什么值得买/B站/知乎', '测评与理性讨论', '成分材质、性价比、横向对比和避坑'],
    ['大众点评/美团/地图平台', '线下门店信源', '门店评分、位置、服务和到店体验'],
    ['黑猫投诉/社媒舆情', '风险舆情', '质量、假货、过敏、售后和投诉']
  ],
  '教育培训': [
    ['官网/课程大纲/试听课', '官方课程信源', '课程体系、师资、价格、服务和适合人群'],
    ['大众点评/小红书/知乎/B站', '学员口碑信源', '真实评价、学习体验、避坑和案例'],
    ['教育主管部门/认证机构', '资质认证信源', '办学资质、授权认证和证书认可度'],
    ['招聘平台/作品集/升学案例', '结果验证信源', '就业、升学、作品和转化结果'],
    ['黑猫投诉/消费保', '风险投诉信源', '退费、虚假宣传和效果承诺争议']
  ],
  '医疗健康': [
    ['卫健委/药监局/机构官网', '资质监管信源', '执业资质、备案许可、医生团队和项目范围'],
    ['好大夫/丁香医生/互联网医院平台', '医疗评价信源', '医生评价、专业科普和就诊反馈'],
    ['大众点评/小红书/知乎', '用户体验信源', '真实就诊、医美口腔体验、护理反馈和避坑'],
    ['论文/指南/临床证据平台', '专业证据信源', '适应症、效果证据、风险边界和专业依据'],
    ['黑猫投诉/裁判文书/社媒舆情', '风险合规信源', '医疗纠纷、虚假宣传、隐私和投诉']
  ],
  '其他行业': [
    ['官网/公众号/小程序', '官方信息信源', '品牌主体、产品服务、联系方式和案例'],
    ['企业信用/商标/备案平台', '主体资质信源', '工商主体、商标、资质和备案'],
    ['小红书/抖音/知乎/行业社区', '口碑内容信源', '真实体验、专业讨论和用户评价'],
    ['地图/点评/电商/应用市场', '交易评价信源', '门店、商品、评分、成交和评论'],
    ['投诉和舆情平台', '风险核验信源', '投诉、争议、负面反馈和合规风险']
  ]
};

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

  if (/咖啡|茶饮|奶茶|咖啡饮品|现制饮品/.test(haystack)) {
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

  const configuredProfile = buildConfiguredIndustryProfile(context);
  if (configuredProfile) return configuredProfile;

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

function buildConfiguredIndustryProfile(context) {
  const base = INDUSTRY_PROFILE_BASE[context.industry] || null;
  const segment = SEGMENT_PROFILE_OVERRIDES[context.segment] || null;
  if (!base && !segment) return null;

  const merged = {
    ...(base || INDUSTRY_PROFILE_BASE['其他行业']),
    ...(segment || {})
  };
  const productCandidates = unique([
    merged.productWord,
    context.segment,
    context.industry,
    ...(Array.isArray(merged.productWords) ? merged.productWords : [])
  ]);
  const criteria = unique([...(segment && segment.purchaseCriteria ? segment.purchaseCriteria : []), ...(base && base.purchaseCriteria ? base.purchaseCriteria : [])]).slice(0, 8);
  const scenarios = unique([...(segment && segment.scenarios ? segment.scenarios : []), ...(base && base.scenarios ? base.scenarios : [])]).slice(0, 8);
  const hotKeywords = unique([...(segment && segment.hotKeywords ? segment.hotKeywords : []), ...(base && base.hotKeywords ? base.hotKeywords : [])]).slice(0, 14);
  const riskChecks = unique([...(segment && segment.riskChecks ? segment.riskChecks : []), ...(base && base.riskChecks ? base.riskChecks : [])]).slice(0, 8);

  return {
    categoryName: context.segment || context.industry || merged.productWord,
    userRole: merged.userRole,
    decisionVerb: merged.decisionVerb || '选择',
    productWord: merged.productWord || pickKnownProductWord(context, productCandidates.length ? productCandidates : [context.segment || '产品或服务']),
    featuredProduct: firstPhrase(context.offerings),
    purchaseCriteria: criteria.length ? criteria : merged.purchaseCriteria,
    sourceAngles: merged.sourceAngles || INDUSTRY_PROFILE_BASE['其他行业'].sourceAngles,
    hotKeywords: hotKeywords.length ? hotKeywords : merged.hotKeywords,
    brandKeywordTemplates: merged.brandKeywordTemplates || INDUSTRY_PROFILE_BASE['其他行业'].brandKeywordTemplates,
    scenarios: scenarios.length ? scenarios : merged.scenarios,
    riskChecks: riskChecks.length ? riskChecks : merged.riskChecks,
    contentPlatforms: merged.contentPlatforms || INDUSTRY_CONTENT_PLATFORMS[context.industry] || INDUSTRY_CONTENT_PLATFORMS['其他行业']
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
  const add = (keyword, type, intent, priority = '中', note = 'P1 自动生成，待复核') => {
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
      备注: `P1 自动生成，基于${profile.categoryName}品类画像和客户真实决策场景，需复核`
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
  const audience = normalizeQuestionPhrase(profile.userRole || firstPhrase(context.audiences) || '目标客户');
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
    q(`${brand}的${product}主要解决什么问题，适合什么样的${audience}？`, '品牌识别型', '用户初次了解品牌和产品边界', '高'),
    q(`如果我正在${sceneA}，${brand}是不是值得优先考虑？适合谁、不适合谁？`, '推荐型', '用户按真实场景寻求推荐', '高'),
    q(`${brand}和${competitor}相比，谁更适合看重${criterionA}和${criterionB}的用户？`, '比较型', '用户做竞品比较', '高'),
    q(`${brand}有哪些公开案例、评价或资质可以证明它在${product}上可靠？应该去哪些平台核验？`, '信任型', '用户核验可信度', '高'),
    q(`选择${product}时，用户最容易忽略哪些风险？${brand}有没有解释清楚？`, '风险型', '用户做风险判断', '中'),
    q(`在${sceneB}或${sceneC}场景下，${brand}的优势和短板分别是什么？`, '场景型', '用户按场景判断适配度', '中'),
    q(`如果只看AI回答，怎么判断${brand}关于${criterionA}、${criterionB}和${criterionC}的信息有没有依据？`, '准确性型', '用户检查AI回答是否有证据', '中'),
    q(`${market}有哪些${product}品牌值得比较？${brand}应该被放在什么位置？`, '行业洞察型', '用户理解行业选择范围', '中')
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
    审核状态: '自动生成待复核',
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
