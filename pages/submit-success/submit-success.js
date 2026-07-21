Page({
  data: {
    submission: null,
    nextSteps: [
      '我们会在 24 小时内初步审核资料',
      '必要时通过企业微信补充最多 3 个关键信息',
      '确认范围后进入品牌研究、问题设计和五平台测试'
    ],
    articles: [
      { id: 'what-is-geo', title: '什么是 GEO：AI 搜索时代的品牌增长方法' },
      { id: 'brand-entity', title: '品牌实体画像：让 AI 知道你是谁' }
    ]
  },

  onLoad() {
    this.setData({ submission: wx.getStorageSync('geogi_last_submission') || null });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goResearch() {
    wx.switchTab({ url: '/pages/research/research' });
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  },

  openArticle(event) {
    wx.navigateTo({ url: `/pages/research-detail/research-detail?id=${event.currentTarget.dataset.id}` });
  }
});
