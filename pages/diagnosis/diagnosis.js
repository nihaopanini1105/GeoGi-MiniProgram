const { platforms } = require('../../config/platforms');
const { assets } = require('../../config/assets');
const { post, uploadFile, isApiConfigured } = require('../../utils/request');
const { track } = require('../../utils/analytics');

const draftKey = 'geogi_diagnosis_draft';

const initialForm = {
  submissionId: '', brandName: '', companyName: '', industry: '', segment: '',
  officialChannel: '', targetMarket: [], offerings: '', audiences: '', advantages: '',
  competitors: '', goals: [], uploads: [], contactName: '', contactMethod: '',
  message: '', privacyAccepted: false
};

Page({
  data: {
    started: false,
    phoneAuthorized: false,
    phoneAuthLoading: false,
    phoneAuthError: '',
    phoneDisplay: '',
    step: 1,
    submitting: false,
    fieldErrors: {},
    form: { ...initialForm },
    assets,
    platforms: platforms.filter((item) => item.enabled)
  },

  async onGetPhoneNumber(event) {
    const detail = event.detail || {};
    if (!/ok/i.test(detail.errMsg || '') || !detail.code) {
      this.setData({ phoneAuthError: '提交诊断需要手机号，用于确认报告归属和同步处理状态。' });
      return;
    }

    this.setData({ phoneAuthLoading: true, phoneAuthError: '' });
    try {
      const result = await post('/api/wechat/phone', { code: detail.code });
      if (!result || !result.ok || !result.phoneNumber || !result.customerToken) {
        throw new Error(result && result.userMessage ? result.userMessage : '手机号授权失败');
      }

      wx.setStorageSync('geogi_phone_auth', {
        phoneNumber: result.phoneNumber,
        authorizedAt: new Date().toISOString()
      });
      wx.setStorageSync('geogi_customer_token', result.customerToken);

      this.setData({
        phoneAuthorized: true,
        phoneDisplay: result.phoneNumber,
        phoneAuthError: ''
      });
      this.setFormValue('contactMethod', result.phoneNumber);
      wx.showToast({ title: '手机号已授权', icon: 'success' });
    } catch (error) {
      this.setData({
        phoneAuthError: error.message || '手机号授权失败，请稍后重试'
      });
    } finally {
      this.setData({ phoneAuthLoading: false });
    }
  }

  // other existing methods remain unchanged
});
