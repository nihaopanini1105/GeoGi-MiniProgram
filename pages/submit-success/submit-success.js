const { assets } = require('../../config/assets');

Page({
  data: {
    assets,
    submission: {},
    nextSteps: [
      {
        title: '资料核对',
        desc: '核对品牌、业务与联系人信息是否完整。'
      },
      {
        title: '诊断分析',
        desc: '结合品牌资料与主流 AI 平台表现完成诊断。'
      },
      {
        title: '报告发布',
        desc: '完成审核后，正式报告会出现在「报告」页面。'
      }
    ]
  },

  onShow() {
    const submission = wx.getStorageSync('geogi_last_submission') || {};
    this.setData({ submission });
  },

  previewWecomQr() {
    wx.previewImage({
      current: this.data.assets.contact.wecomQr,
      urls: [this.data.assets.contact.wecomQr]
    });
  },

  goReport() {
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
