const { platforms } = require('../../config/platforms');
const { assets } = require('../../config/assets');
const { track } = require('../../utils/analytics');

Page({
  data: {
    assets,
    platforms: platforms.filter((item) => item.enabled),
    values: [
      { icon: assets.icons.eye, text: 'AI 是否认识并推荐你的品牌' },
      { icon: assets.icons.competitors, text: '哪些竞品正在被优先推荐' },
      { icon: assets.icons.accuracy, text: '品牌信息是否准确、完整' },
      { icon: assets.icons.optimization, text: '应该优先优化的内容与信源' }
    ],
    flow: ['提交信息', '品牌研究', 'AI 平台检测', '获得报告'],
    latestArticles: [
      {
        id: 'what-is-geo',
        category: 'GEO 基础',
        title: '什么是 GEO：AI 搜索时代的品牌增长方法',
        date: '2026-07-21'
      },
      {
        id: 'brand-entity',
        category: '品牌诊断',
        title: '品牌实体画像：让 AI 知道你是谁',
        date: '2026-07-21'
      }
    ]
  },

  onShow() {
    track('home_view');
  },

  onReady() {
    track('platform_section_view', {
      visible_platforms: this.data.platforms.map((item) => item.name).join(',')
    });
  },

  goDiagnosis() {
    track('diagnosis_cta_click', { position: 'home' });
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.navigateTo({ url: '/pages/diagnosis/diagnosis?start=1' });
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
    const article = this.data.latestArticles.find((item) => item.id === id);
    track('research_card_click', {
      article_id: id,
      category: article ? article.category : ''
    });
    wx.switchTab({ url: '/pages/research/research' });
  }
});
