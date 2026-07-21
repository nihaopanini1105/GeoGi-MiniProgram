Page({
  data: {
    metrics: [
      { value: 'AI', label: '答案可见度' },
      { value: 'GEO', label: '内容优化系统' },
      { value: '5项', label: '核心服务' }
    ],
    services: [
      {
        title: 'AI 可见度诊断',
        desc: '快速判断品牌是否能被主流 AI 问答、搜索与推荐场景准确识别。'
      },
      {
        title: 'GEO 全景诊断报告',
        desc: '从品牌实体、内容证据、权威信源与用户问题四个方向形成优化路线。'
      },
      {
        title: 'GEO 订阅优化服务',
        desc: '持续建设可被 AI 理解、引用和推荐的品牌内容资产。'
      }
    ],
    signals: ['品牌实体清晰', '内容证据完整', '权威信源可追溯']
  },

  goServices() {
    wx.switchTab({ url: '/pages/services/services' });
  },

  goContact() {
    wx.switchTab({ url: '/pages/contact/contact' });
  },

  goResearch() {
    wx.switchTab({ url: '/pages/research/research' });
  }
});
