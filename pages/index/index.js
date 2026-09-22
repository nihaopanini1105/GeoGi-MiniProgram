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
        title: '¥199 品牌 GEO 诊断报告',
        desc: '提交品牌资料并支付 199 元，获取主流 AI 平台检测与 GEO 诊断报告。'
      },
      {
        key: 'optimization',
        icon: assets.icons.optimization,
        title: '报告后的 GEO 优化服务',
        desc: '根据诊断结果进一步制定优化方案；不包含在 199 元诊断报告内。'
      },
      {
        key: 'execution',
        icon: assets.icons.research,
        title: '持续 GEO 服务',
        desc: '内容、信源和品牌信息优化属于后续服务，不包含在 199 元诊断报告内。'
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

  onShareAppMessage() {
    this.safeTrack('share_app_message', {
      page: 'home'
    });

    return {
      title: 'GeoGi｜199元品牌 GEO 诊断报告',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    this.safeTrack('share_timeline', {
      page: 'home'
    });

    return {
      title: 'GeoGi｜让品牌在 AI 时代被看见、被理解、被选择',
      query: ''
    };
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
