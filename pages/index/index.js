const { platforms } = require('../../config/platforms');
const { assets } = require('../../config/assets');
const { get, getCustomerToken, isApiConfigured } = require('../../utils/request');
const { captureAttribution } = require('../../utils/attribution');

Page({
  data: {
    assets,
    channelShareToken: '',
    channelShareName: '',
    platforms: platforms.filter((item) => item.enabled),
    services: [
      {
        key: 'diagnosis',
        icon: assets.icons.quickCheck,
        title: '品牌研究与问题诊断',
        desc: '提交资料并付款后，完成品牌研究、AI 平台检测与正式 GEO 诊断报告。'
      },
      {
        key: 'platforms',
        icon: assets.icons.optimization,
        title: '主流 AI 平台检测',
        desc: '报告包含品牌理解、推荐、引用、事实准确性和竞品表现检查。'
      },
      {
        key: 'report',
        icon: assets.icons.research,
        title: '正式诊断报告',
        desc: '报告完成并审核后，可在小程序「我的」页面直接查看。'
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

  onLoad(options) {
    void captureAttribution(options || {});
  },

  onShow() {
    this.safeTrack('home_view');
    void this.loadChannelShareContext();
  },

  async loadChannelShareContext() {
    if (!isApiConfigured() || !getCustomerToken()) {
      this.setData({ channelShareToken: '', channelShareName: '' });
      return;
    }
    try {
      const result = await get('/api/customer/channel-dashboard', {});
      const channel = result && result.isChannel && result.channels && result.channels[0];
      this.setData({
        channelShareToken: channel && channel.shareSourceToken || '',
        channelShareName: channel && channel.name || ''
      });
    } catch (_error) {
      this.setData({ channelShareToken: '', channelShareName: '' });
    }
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
    const sourceToken = String(this.data.channelShareToken || '');
    this.safeTrack('share_app_message', {
      page: 'home',
      channel_share: Boolean(sourceToken)
    });
    return {
      title: sourceToken && this.data.channelShareName
        ? this.data.channelShareName + ' 推荐｜GeoGi 品牌 GEO 诊断'
        : 'GeoGi｜199 元品牌 GEO 诊断报告',
      path: sourceToken
        ? '/pages/index/index?src=' + encodeURIComponent(sourceToken)
        : '/pages/index/index'
    };
  },

  onShareTimeline() {
    this.safeTrack('share_timeline', {
      page: 'home'
    });

    const sourceToken = String(this.data.channelShareToken || '');
    return {
      title: 'GeoGi｜让品牌在 AI 时代被看见、被理解、被选择',
      query: sourceToken ? 'src=' + encodeURIComponent(sourceToken) : ''
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
    if (key === 'report') {
      wx.navigateTo({ url: '/pages/sample-report/sample-report' });
      return;
    }
    this.goDiagnosis();
  },

  openArticle(event) {
    const id = event.currentTarget.dataset.id;
    this.safeTrack('research_card_click', { article_id: id });
    wx.switchTab({ url: '/pages/research/research' });
  }
});
