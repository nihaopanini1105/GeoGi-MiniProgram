const { platforms } = require('../../config/platforms');
const { assets } = require('../../config/assets');

Page({
  data: {
    assets,
    platforms: platforms.filter((item) => item.enabled),
    services: [
      {
        key: 'diagnosis',
        icon: assets.icons.quickCheck,
        title: 'GEO 诊断',
        desc: '检测品牌在 AI 平台中的可见度、理解度与推荐表现。'
      },
      {
        key: 'optimization',
        icon: assets.icons.optimization,
        title: 'GEO 优化方案',
        desc: '分析品牌问题根因，制定行业和场景化优化方向。'
      },
      {
        key: 'execution',
        icon: assets.icons.research,
        title: 'GEO 优化执行',
        desc: '通过内容、信源和品牌信息治理持续提升 AI 表现。'
      }
    ],
    latestArticles: [
      {
        id: 'what-is-geo',
        category: 'GEO 基础',
        title: '什么是 GEO：AI 搜索时代品牌如何被看见',
        date: '2026-07-21'
      },
      {
        id: 'brand-entity',
        category: '品牌诊断',
        title: '品牌实体画像：让 AI 正确认识你的品牌',
        date: '2026-07-21'
      }
    ]
  },

  onShow() {
    this.safeTrack('home_view');
  },

  safeTrack(eventName, params) {
    try {
      const { track } = require('../../utils/analytics');
      track(eventName, params || {});
    } catch (error) {
      console.warn('analytics unavailable', error);
    }
  },

  goDiagnosis() {
    this.safeTrack('diagnosis_cta_click', { position: 'home' });
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  },

  goReport() {
    this.safeTrack('report_cta_click', { position: 'home' });
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  goResearch() {
    wx.switchTab({ url: '/pages/research/research' });
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  },

  openService(event) {
    const key = event.currentTarget.dataset.key;
    this.safeTrack('service_card_click', { key });
    if (key === 'diagnosis') {
      this.goDiagnosis();
    }
  },

  openArticle(event) {
    const id = event.currentTarget.dataset.id;
    this.safeTrack('research_card_click', { article_id: id });
    wx.switchTab({ url: '/pages/research/research' });
  }
});
