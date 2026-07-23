const app = getApp();
const { track } = require('../../utils/analytics');

Page({
  data: {
    email: app.globalData.contactEmail,
    wechatId: 'GeoGi-Advisor',
    workHours: '工作日 10:00-19:00'
  },

  copyWechat() {
    track('contact_advisor_click', { page: 'contact', position: 'wechat' });
    wx.setClipboardData({
      data: this.data.wechatId,
      success: () => {
        wx.showToast({ title: '微信号已复制', icon: 'success' });
      }
    });
  },

  copyEmail() {
    track('contact_advisor_click', { page: 'contact', position: 'email' });
    wx.setClipboardData({
      data: this.data.email,
      success: () => {
        wx.showToast({ title: '邮箱已复制', icon: 'success' });
      }
    });
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.navigateTo({ url: '/pages/diagnosis/diagnosis?start=1' });
  }
});
