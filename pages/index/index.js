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
        title: 'GEO诊断',
        desc: '检测品牌在 AI 平台中的可见度、理解度与推荐表现。'
      },
      {
        key: 'optimization',
        icon: assets.icons.optimization,
        title: 'GEO优化方案',
        desc: '分析问题根因，形成品牌、内容与信源的优化优先级。'
      },
      {
        key: 'execution',
        icon: assets.icons.research,
        title: 'GEO优化执行',
        desc: '围绕内容、信源和品牌信息治理推进具体优化工作。'
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

  goResearch() {
    this.safeTrack('research_cta_click', { position: 'home' });
    wx.switchTab({ url: '/pages/research/research' });
  },

  goContact() {
    this.safeTrack('contact_advisor_click', { page: 'home', position: 'home_bottom' });
    wx.navigateTo({ url: '/pages/contact/contact' });
  },

  openService(event) {
    const key = event.currentTarget.dataset.key;
    this.safeTrack('service_card_click', { key });
    if (key === 'diagnosis') {
      this.goDiagnosis();
      return;
    }
    wx.navigateTo({ url: '/pages/services/services' });
  }
});
