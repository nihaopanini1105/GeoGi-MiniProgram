Page({
  data: {
    submission: null,
    nextSteps: [
      'GeoGi 已收到您的申请，并同步进入诊断工作台',
      '顾问会在 1 个工作日内确认检测范围',
      '确认后进入品牌研究、AI 平台检测和报告整理'
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
