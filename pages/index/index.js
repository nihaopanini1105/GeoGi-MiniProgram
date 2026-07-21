Page({
  data: {
    metrics: [
      { value: '30秒', label: '理解服务价值' },
      { value: '2-3分钟', label: '提交品牌资料' },
      { value: '5平台', label: '人工证据测试' }
    ],
    pains: [
      'AI 没有提到你',
      '品牌信息说错了',
      '竞品排在你前面'
    ],
    abilities: [
      '品牌识别',
      '主动推荐',
      '信息准确',
      '跨平台一致',
      '竞品压制',
      '引用信源'
    ],
    services: [
      {
        tag: '体验',
        title: '品牌 AI 可见度体验',
        desc: '快速判断品牌是否被 AI 看见。'
      },
      {
        tag: '快检',
        title: 'AI 可见度快检',
        desc: '五平台测试，输出基础评分和解读。'
      },
      {
        tag: '全景',
        title: 'GEO 全景诊断',
        desc: '覆盖品牌、关键词、竞品和信源。'
      }
    ],
    flow: ['提交资料', '品牌研究', '问题测试', '分析报告', '解读优化'],
    latestArticles: [
      {
        id: 'what-is-geo',
        category: 'GEO 基础',
        title: '什么是 GEO：AI 搜索时代的品牌增长方法',
        desc: '理解生成式引擎优化如何影响品牌被发现、被解释和被推荐。',
        date: '2026-07-21'
      },
      {
        id: 'brand-entity',
        category: '品牌诊断',
        title: '品牌实体画像：让 AI 知道你是谁',
        desc: '从名称、业务、受众、优势和证据五个维度建立稳定识别。',
        date: '2026-07-21'
      },
      {
        id: 'source-chain',
        category: '指标与方法',
        title: 'AI 答案里的证据链：内容与权威信源如何协同',
        desc: '品牌要进入 AI 答案，需要可验证、可引用的信任结构。',
        date: '2026-07-21'
      }
    ],
    faqs: [
      { q: '没有官网可以提交吗？', a: '可以。公众号、店铺、媒体报道或其他公开页面都可以作为初始资料。' },
      { q: '一定要懂 GEO 才能填写吗？', a: '不需要。表单会使用正常经营语言，只问品牌、业务、目标和联系方式。' },
      { q: '第一阶段会自动调用 AI 平台吗？', a: '不会预先接入五个平台 API。测试由运营人员人工提问并保留截图和原始回答。' }
    ]
  },

  goDiagnosis() {
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  },

  goServices() {
    wx.navigateTo({ url: '/pages/services/services' });
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  },

  goResearch() {
    wx.switchTab({ url: '/pages/research/research' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/sample-report/sample-report' });
  },

  openArticle(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/research-detail/research-detail?id=${id}` });
  }
});
