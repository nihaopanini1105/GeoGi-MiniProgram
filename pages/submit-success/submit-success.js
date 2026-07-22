Page({
  data: {
    submission: null,
    nextSteps: [
      '资料已同步进入 GeoGi 诊断工作台，等待人工审核',
      '审核完成后启动品牌信息补齐和问题生成',
      '完成 AI 平台问答后生成报告初稿'
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
    wx.switchTab({ url: '/pages/research/research' });
  }
});
