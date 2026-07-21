const initialForm = {
  brandName: '',
  companyName: '',
  industry: '',
  segment: '',
  officialChannel: '',
  offerings: '',
  audiences: '',
  competitors: '',
  goals: [],
  contactName: '',
  contactMethod: '',
  message: '',
  privacyAccepted: false
};

const { post, isApiConfigured } = require('../../utils/request');

Page({
  data: {
    step: 1,
    submitting: false,
    form: { ...initialForm },
    industries: ['旅游与文旅', '教育培训', '医疗健康', '本地生活', '消费品牌', 'B2B 服务', '其他行业'],
    goalOptions: [
      { label: '确认 AI 是否能搜到品牌', selected: false },
      { label: '检查品牌信息是否准确', selected: false },
      { label: '比较竞品推荐情况', selected: false },
      { label: '找到内容和信源缺口', selected: false },
      { label: '准备做 GEO 优化', selected: false }
    ]
  },

  onLoad() {
    const draft = wx.getStorageSync('geogi_diagnosis_draft');
    if (draft) {
      const form = { ...initialForm, ...draft };
      this.setData({
        form,
        goalOptions: this.syncGoalOptions(form.goals)
      });
    }
  },

  updateField(event) {
    const key = event.currentTarget.dataset.key;
    const value = event.detail.value;
    this.setFormValue(key, value);
  },

  chooseIndustry(event) {
    this.setFormValue('industry', event.currentTarget.dataset.value);
  },

  toggleGoal(event) {
    const value = event.currentTarget.dataset.value;
    const goals = [...this.data.form.goals];
    const index = goals.indexOf(value);

    if (index >= 0) {
      goals.splice(index, 1);
    } else if (goals.length < 3) {
      goals.push(value);
    } else {
      wx.showToast({ title: '最多选择 3 项', icon: 'none' });
      return;
    }

    this.setFormValue('goals', goals);
    this.setData({ goalOptions: this.syncGoalOptions(goals) });
  },

  togglePrivacy() {
    this.setFormValue('privacyAccepted', !this.data.form.privacyAccepted);
  },

  setFormValue(key, value) {
    const form = {
      ...this.data.form,
      [key]: value
    };

    this.setData({ form });
    wx.setStorageSync('geogi_diagnosis_draft', form);
  },

  syncGoalOptions(selectedGoals) {
    return this.data.goalOptions.map((item) => ({
      ...item,
      selected: selectedGoals.indexOf(item.label) >= 0
    }));
  },

  nextStep() {
    if (!this.validateStep(this.data.step)) return;
    this.setData({ step: Math.min(this.data.step + 1, 3) });
  },

  prevStep() {
    this.setData({ step: Math.max(this.data.step - 1, 1) });
  },

  validateStep(step) {
    const { form } = this.data;
    if (step === 1 && (!form.brandName || !form.industry || !form.segment)) {
      wx.showToast({ title: '请补全品牌和行业信息', icon: 'none' });
      return false;
    }
    if (step === 2 && (!form.offerings || form.goals.length === 0)) {
      wx.showToast({ title: '请填写核心业务并选择诊断目标', icon: 'none' });
      return false;
    }
    if (step === 3 && (!form.contactName || !form.contactMethod || !form.privacyAccepted)) {
      wx.showToast({ title: '请填写联系方式并确认授权', icon: 'none' });
      return false;
    }
    return true;
  },

  submit() {
    if (!this.validateStep(3) || this.data.submitting) return;

    this.setData({ submitting: true });
    const submittedAt = new Date().toISOString();
    const payload = {
      ...this.data.form,
      submittedAt
    };

    if (!isApiConfigured()) {
      wx.showToast({
        title: '请先配置服务器域名',
        icon: 'none'
      });
      this.setData({ submitting: false });
      return;
    }

    post('/api/diagnosis/submit', {
        form: payload,
        source: 'wechat_miniprogram'
      })
      .then((result) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: result && result.userMessage ? result.userMessage : '提交失败，请稍后重试',
            icon: 'none'
          });
          return;
        }

        wx.setStorageSync('geogi_last_submission', {
          ...payload,
          clientId: result.clientId,
          projectId: result.projectId,
          recordUrl: result.recordUrl || ''
        });
        wx.removeStorageSync('geogi_diagnosis_draft');
        this.resetForm();
        wx.navigateTo({ url: '/pages/submit-success/submit-success' });
      })
      .catch((error) => {
        const message = error && error.message === 'API_BASE_URL_NOT_CONFIGURED'
          ? '请先配置服务器域名'
          : '提交失败，资料已保留';
        wx.showToast({
          title: message,
          icon: 'none'
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  resetForm() {
      this.setData({
        submitting: false,
        form: { ...initialForm },
        goalOptions: this.syncGoalOptions([]),
        step: 1
      });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goServices() {
    wx.navigateTo({ url: '/pages/services/services' });
  }
});
