const app = getApp();
const { track } = require('../../utils/analytics');

Page({
  data: {
    wecomQr: '/assets/contact/geogi-wecom-qr.png',
    email: app.globalData.contactEmail,
    website: app.globalData.officialWebsite
  },

  copyEmail() {
    try {
      track('contact_advisor_click', { page: 'contact', position: 'email' });
    } catch (error) {}
    wx.setClipboardData({
      data: this.data.email,
      success: () => wx.showToast({ title: '邮箱已复制', icon: 'success' })
    });
  },

  copyWebsite() {
    try {
      track('contact_advisor_click', { page: 'contact', position: 'website' });
    } catch (error) {}
    wx.setClipboardData({
      data: this.data.website,
      success: () => wx.showToast({ title: '官网地址已复制', icon: 'success' })
    });
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  }
});
