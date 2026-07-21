const { platforms } = require('../../config/platforms');
const { assets } = require('../../config/assets');
const { post, uploadFile, isApiConfigured } = require('../../utils/request');
const { track } = require('../../utils/analytics');

const draftKey = 'geogi_diagnosis_draft';

const initialForm = {
  submissionId: '',
  brandName: '',
  companyName: '',
  industry: '',
  segment: '',
  officialChannel: '',
  targetMarket: [],
  targetMarketOther: '',
  offerings: '',
  audiences: '',
  advantages: '',
  competitors: '',
  goals: [],
  uploads: [],
  contactName: '',
  contactMethod: '',
  message: '',
  privacyAccepted: false
};

Page({
  data: {
    started: false,
    step: 1,
    submitting: false,
    fieldErrors: {},
    form: { ...initialForm },
    assets,
    platforms: platforms.filter((item) => item.enabled),
    checks: [
      '品牌是否被 AI 识别',
      '是否被主动推荐',
      '信息是否准确完整',
      '哪些竞品被优先推荐',
      '内容和信源缺口'
    ],
    deliveries: ['品牌基础研究', '跨平台检测证据', '诊断结论', '优化建议'],
    industries: ['旅游与文旅', '企业服务', '软件与互联网', '消费品与零售', '教育培训', '医疗健康', '其他行业'],
    markets: [
      { label: '全国市场', selected: false },
      { label: '本地市场', selected: false },
      { label: '海外市场', selected: false },
      { label: 'B2B 企业客户', selected: false },
      { label: 'C 端消费者', selected: false }
    ],
    goalOptions: [
      { label: 'AI 是否会主动推荐我的品牌', selected: false },
      { label: '检查品牌信息是否准确', selected: false },
      { label: '比较竞品推荐情况', selected: false },
      { label: '找到内容和信源缺口', selected: false },
      { label: '准备做 GEO 优化', selected: false }
    ]
  },

  onLoad(options) {
    const draft = wx.getStorageSync(draftKey);
    if (draft) {
      const form = this.normalizeForm({ ...initialForm, ...draft });
      this.setData({
        started: Boolean(options.start) || this.hasDraftContent(form),
        form,
        markets: this.syncMarketOptions(form.targetMarket),
        goalOptions: this.syncGoalOptions(form.goals)
      });
    } else if (options.start) {
      this.startForm();
    }
  },

  startForm() {
    const form = {
      ...this.data.form,
      submissionId: this.data.form.submissionId || this.makeSubmissionId()
    };
    this.setData({ started: true, form });
    wx.setStorageSync(draftKey, form);
    track('form_start', { source: 'diagnosis_entry' });
  },

  updateField(event) {
    const key = event.currentTarget.dataset.key;
    const value = event.detail.value;
    this.setFormValue(key, value);
  },

  chooseIndustry(event) {
    this.setFormValue('industry', event.currentTarget.dataset.value);
  },

  toggleMarket(event) {
    const value = event.currentTarget.dataset.value;
    const targetMarket = [...this.data.form.targetMarket];
    const index = targetMarket.indexOf(value);
    if (index >= 0) {
      targetMarket.splice(index, 1);
    } else {
      targetMarket.push(value);
    }
    this.setFormValue('targetMarket', targetMarket);
    this.setData({ markets: this.syncMarketOptions(targetMarket) });
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
      this.setData({
        fieldErrors: {
          ...this.data.fieldErrors,
          goals: '最多选择 3 项'
        }
      });
      return;
    }

    this.setFormValue('goals', goals);
    this.setData({ goalOptions: this.syncGoalOptions(goals) });
  },

  chooseUpload() {
    wx.chooseMessageFile({
      count: 3,
      type: 'file',
      success: ({ tempFiles }) => {
        const allowed = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'];
        const current = this.data.form.uploads || [];
        const next = [];
        const rejected = [];

        tempFiles.forEach((file) => {
          const ext = String(file.name || '').split('.').pop().toLowerCase();
          const sizeMb = Number(file.size || 0) / 1024 / 1024;
          if (!allowed.includes(ext)) {
            rejected.push(`${file.name} 类型不支持`);
            return;
          }
          if (sizeMb > 20) {
            rejected.push(`${file.name} 超过 20MB`);
            return;
          }
          next.push({
            name: file.name,
            size: file.size,
            path: file.path,
            uploaded: false
          });
        });

        this.setFormValue('uploads', current.concat(next).slice(0, 3));
        if (rejected.length) {
          this.setData({
            fieldErrors: {
              ...this.data.fieldErrors,
              uploads: rejected[0]
            }
          });
        }
      }
    });
  },

  removeUpload(event) {
    const index = Number(event.currentTarget.dataset.index);
    const uploads = [...(this.data.form.uploads || [])];
    uploads.splice(index, 1);
    this.setFormValue('uploads', uploads);
  },

  togglePrivacy() {
    this.setFormValue('privacyAccepted', !this.data.form.privacyAccepted);
  },

  setFormValue(key, value) {
    const fieldErrors = { ...this.data.fieldErrors };
    delete fieldErrors[key];

    const form = this.normalizeForm({
      ...this.data.form,
      [key]: value
    });

    this.setData({ form, fieldErrors });
    wx.setStorageSync(draftKey, form);
  },

  syncGoalOptions(selectedGoals) {
    return this.data.goalOptions.map((item) => ({
      ...item,
      selected: selectedGoals.indexOf(item.label) >= 0
    }));
  },

  syncMarketOptions(selectedMarkets) {
    return this.data.markets.map((item) => ({
      ...item,
      selected: selectedMarkets.indexOf(item.label) >= 0
    }));
  },

  nextStep() {
    if (!this.validateStep(this.data.step)) return;
    track('form_step_complete', { step: this.data.step });
    this.setData({ step: Math.min(this.data.step + 1, 3), fieldErrors: {} });
  },

  prevStep() {
    this.setData({ step: Math.max(this.data.step - 1, 1), fieldErrors: {} });
  },

  validateStep(step) {
    const { form } = this.data;
    const errors = {};

    if (step === 1) {
      if (!form.brandName) errors.brandName = '请填写品牌名称';
      if (!form.industry) errors.industry = '请选择所属行业';
      if (!form.segment) errors.segment = '请填写细分业务领域';
      if (!form.targetMarket.length && !form.targetMarketOther) errors.targetMarket = '请选择或填写主要市场';
    }

    if (step === 2) {
      if (!form.offerings) errors.offerings = '请填写核心产品或服务';
      if (!form.audiences) errors.audiences = '请填写主要客户与需求';
      if (this.splitCompetitors(form.competitors).length > 3) errors.competitors = '最多填写 3 个竞品';
      if (!form.goals.length) errors.goals = '请选择本次诊断目标';
    }

    if (step === 3) {
      if (!form.contactName) errors.contactName = '请填写联系人';
      if (!form.contactMethod) errors.contactMethod = '请填写手机号或微信号';
      if (!form.privacyAccepted) errors.privacyAccepted = '提交前需要同意隐私说明';
    }

    this.setData({ fieldErrors: errors });
    return Object.keys(errors).length === 0;
  },

  async submit() {
    if (!this.validateStep(3) || this.data.submitting) return;

    if (!isApiConfigured()) {
      this.setData({
        fieldErrors: {
          submit: '请先把 config/api.js 里的服务器域名换成正式 HTTPS 地址'
        }
      });
      return;
    }

    this.setData({ submitting: true, fieldErrors: {} });
    const submittedAt = new Date().toISOString();

    try {
      const uploadedFiles = await this.uploadAttachments();
      const form = {
        ...this.data.form,
        uploads: uploadedFiles,
        submittedAt
      };

      const result = await post('/api/leads', {
        form,
        source: 'wechat_miniprogram'
      });

      if (!result || !result.ok) {
        throw new Error(result && result.userMessage ? result.userMessage : '提交失败，请稍后重试');
      }

      wx.setStorageSync('geogi_last_submission', {
        clientId: result.clientId,
        projectId: result.projectId,
        status: result.status,
        submittedAt: result.submittedAt || submittedAt,
        notificationStatus: result.notificationStatus,
        recordUrl: result.recordUrl || ''
      });
      wx.removeStorageSync(draftKey);
      track('form_submit_success', {
        client_id: result.clientId,
        industry: form.industry
      });
      this.resetForm();
      wx.redirectTo({ url: '/pages/submit-success/submit-success' });
    } catch (error) {
      track('form_submit_fail', {
        error_code: error && error.message ? error.message : 'unknown'
      });
      this.setData({
        fieldErrors: {
          submit: error && error.message ? error.message : '提交失败，资料已保留'
        }
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  uploadAttachments() {
    const uploads = this.data.form.uploads || [];
    if (!uploads.length) return Promise.resolve([]);

    return uploads.reduce((chain, file) => {
      return chain.then(async (result) => {
        if (file.fileId || !file.path) return result.concat(file);
        const response = await uploadFile('/api/uploads', file.path, 'file', {
          submissionId: this.data.form.submissionId,
          fileName: file.name
        });
        return result.concat({
          ...file,
          fileId: response.fileId,
          url: response.url,
          uploaded: true,
          path: ''
        });
      });
    }, Promise.resolve([]));
  },

  normalizeForm(form) {
    return {
      ...form,
      targetMarket: Array.isArray(form.targetMarket) ? form.targetMarket : [],
      goals: Array.isArray(form.goals) ? form.goals : [],
      uploads: Array.isArray(form.uploads) ? form.uploads : []
    };
  },

  splitCompetitors(value) {
    return String(value || '')
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  },

  hasDraftContent(form) {
    return Boolean(form.brandName || form.companyName || form.industry || form.offerings || form.contactName);
  },

  makeSubmissionId() {
    return `mp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  },

  resetForm() {
    this.setData({
      started: false,
      submitting: false,
      fieldErrors: {},
      form: { ...initialForm },
      markets: this.syncMarketOptions([]),
      goalOptions: this.syncGoalOptions([]),
      step: 1
    });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goServices() {
    wx.navigateTo({ url: '/pages/services/services' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/sample-report/sample-report' });
  }
});
