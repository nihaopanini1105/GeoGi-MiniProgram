const { platforms } = require('../../config/platforms');
const { assets } = require('../../config/assets');
const { track } = require('../../utils/analytics');

Page({
  data: {
    assets,
    platforms: platforms.filter((item) => item.enabled),
    entries: [
      {
        icon: assets.icons.quickCheck,
        title: 'AI 可见度快检',
        desc: '快速了解品牌是否被 AI 识别和推荐',
        action: 'goDiagnosis'
      },
      {
        icon: assets.icons.research,
        title: 'GeoGi 研究中心',
        desc: '洞察行业趋势，获取 GEO 实战知识',
        action: 'goResearch'
      }
    ],
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
    const article = this.data.latestArticles.find((item) => item.id === id);
    track('research_card_click', {
      article_id: id,
      category: article ? article.category : ''
    });
    wx.switchTab({ url: '/pages/research/research' });
  },

  openEntry(event) {
    const action = event.currentTarget.dataset.action;
    if (action && this[action]) {
      this[action]();
    }
  }
});
