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
    phoneAuthorized: false,
    phoneAuthLoading: false,
    phoneAuthError: '',
    phoneDisplay: '',
    step: 1,
    submitting: false,
    fieldErrors: {},
    form: { ...initialForm },
    industryIndex: 0,
    segmentIndex: 0,
    marketIndex: 0,
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
    industrySegments: {
      '旅游与文旅': ['定制旅行', '目的地服务', '景区/乐园', '酒店民宿', '文旅营销', '研学/亲子游', '其他文旅服务'],
      '企业服务': ['品牌营销', '咨询服务', '人力资源', '财税法务', '销售获客', '企业培训', '其他企业服务'],
      '软件与互联网': ['SaaS 软件', 'AI 工具', '数据服务', '电商平台', '内容社区', '开发者服务', '其他软件互联网'],
      '消费品与零售': ['食品饮料', '美妆个护', '服饰配饰', '母婴亲子', '家居生活', '线下零售', '其他消费零售'],
      '教育培训': ['职业教育', '企业培训', 'K12/素质教育', '留学语培', '知识付费', '教育科技', '其他教育培训'],
      '医疗健康': ['健康管理', '医疗服务', '医美口腔', '营养保健', '康复护理', '医疗科技', '其他医疗健康'],
      '其他行业': ['本地生活', '专业服务', '制造业', '房地产/空间', '公益/机构', '其他业务']
    },
    segmentOptions: ['定制旅行', '目的地服务', '景区/乐园', '酒店民宿', '文旅营销', '研学/亲子游', '其他文旅服务'],
    marketOptions: ['全国市场', '本地市场', '全球市场', '海外市场', 'B2B 企业客户', 'C 端消费者'],
    goalOptions: [
      { label: 'AI 是否会主动推荐我的品牌', selected: false },
      { label: '检查品牌信息是否准确', selected: false },
      { label: '比较竞品推荐情况', selected: false },
      { label: '找到内容和信源缺口', selected: false },
      { label: '准备做 GEO 优化', selected: false }
    ]
  },

  onLoad(options) {
    const phoneAuth = wx.getStorageSync('geogi_phone_auth') || {};
    const shouldStartNew = wx.getStorageSync('geogi_start_new_diagnosis') || options.start === '1';
    this.setData({
      phoneAuthorized: Boolean(phoneAuth.phoneNumber),
      phoneDisplay: phoneAuth.phoneNumber || ''
    });

    if (shouldStartNew) {
      wx.removeStorageSync('geogi_start_new_diagnosis');
      wx.removeStorageSync(draftKey);
      wx.removeStorageSync('geogi_last_submission');
      if (phoneAuth.phoneNumber) this.startForm({ forceNew: true });
      return;
    }

    const draft = wx.getStorageSync(draftKey);
    if (draft) {
      const form = this.normalizeForm({ ...initialForm, ...draft });
      this.setData({
        started: Boolean(options.start) || this.hasDraftContent(form),
        form,
        industryIndex: this.getOptionIndex(this.data.industries, form.industry),
        segmentOptions: this.getSegmentOptions(form.industry),
        segmentIndex: this.getOptionIndex(this.getSegmentOptions(form.industry), form.segment),
        marketIndex: this.getOptionIndex(this.data.marketOptions, form.targetMarket[0]),
        goalOptions: this.syncGoalOptions(form.goals)
      });
    } else if (options.start && this.data.phoneAuthorized) {
      this.startForm();
    }
  },

  onShow() {
    if (!wx.getStorageSync('geogi_start_new_diagnosis')) return;
    wx.removeStorageSync('geogi_start_new_diagnosis');
    wx.removeStorageSync(draftKey);
    wx.removeStorageSync('geogi_last_submission');
    if (this.data.phoneAuthorized) this.startForm({ forceNew: true });
  },

  async onGetPhoneNumber(event) {
    const detail = event.detail || {};
    if (!/ok/i.test(detail.errMsg || '') || !detail.code) {
      this.setData({ phoneAuthError: '需要先授权手机号，才能提交正式诊断申请。' });
      return;
    }

    if (!isApiConfigured()) {
      this.setData({ phoneAuthError: '请先配置服务器 HTTPS 地址，再进行手机号授权。' });
      return;
    }

    this.setData({ phoneAuthLoading: true, phoneAuthError: '' });
    try {
      const result = await post('/api/wechat/phone', { code: detail.code });
      if (!result || !result.ok || !result.phoneNumber) {
        throw new Error(result && result.userMessage ? result.userMessage : '手机号授权失败');
      }
      const phoneAuth = {
        phoneNumber: result.phoneNumber,
        purePhoneNumber: result.purePhoneNumber || result.phoneNumber,
        countryCode: result.countryCode || '',
        authorizedAt: new Date().toISOString()
      };
      wx.setStorageSync('geogi_phone_auth', phoneAuth);
      this.setData({
        phoneAuthorized: true,
        phoneDisplay: phoneAuth.phoneNumber,
        phoneAuthError: ''
      });
      this.setFormValue('contactMethod', phoneAuth.phoneNumber);
      this.startForm({ forceNew: true });
    } catch (error) {
      this.setData({
        phoneAuthError: error && error.message ? error.message : '手机号授权失败，请稍后重试'
      });
    } finally {
      this.setData({ phoneAuthLoading: false });
    }
  },

  startForm(options = {}) {
    const forceNew = Boolean(options.forceNew);
    const phoneAuth = wx.getStorageSync('geogi_phone_auth') || {};
    const form = {
      ...(forceNew ? initialForm : this.data.form),
      contactMethod: phoneAuth.phoneNumber || this.data.form.contactMethod || '',
      submissionId: forceNew ? this.makeSubmissionId() : (this.data.form.submissionId || this.makeSubmissionId())
    };
    this.setData({
      started: true,
      step: 1,
      submitting: false,
      fieldErrors: {},
      form,
      industryIndex: 0,
      segmentIndex: 0,
      segmentOptions: this.getSegmentOptions(this.data.industries[0]),
      marketIndex: 0,
      goalOptions: this.syncGoalOptions([])
    }, this.scrollToTop);
    wx.setStorageSync(draftKey, form);
    track('form_start', { source: 'diagnosis_entry' });
  },

  updateField(event) {
    const key = event.currentTarget.dataset.key;
    const value = event.detail.value;
    this.setFormValue(key, value);
  },

  chooseIndustry(event) {
    const index = Number(event.detail.value);
    const industry = this.data.industries[index];
    const segmentOptions = this.getSegmentOptions(industry);
    this.setData({ industryIndex: index });
    this.setData({ segmentOptions, segmentIndex: 0 });
    this.setFormValue('industry', industry);
    this.setFormValue('segment', '');
  },

  chooseSegment(event) {
    const index = Number(event.detail.value);
    this.setData({ segmentIndex: index });
    this.setFormValue('segment', this.data.segmentOptions[index]);
  },

  chooseMarket(event) {
    const index = Number(event.detail.value);
    this.setData({ marketIndex: index });
    this.setFormValue('targetMarket', [this.data.marketOptions[index]]);
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

  getOptionIndex(options, value) {
    const index = options.indexOf(value);
    return index >= 0 ? index : 0;
  },

  getSegmentOptions(industry) {
    return this.data.industrySegments[industry] || this.data.industrySegments['其他行业'];
  },

  nextStep() {
    if (!this.validateStep(this.data.step)) return;
    track('form_step_complete', { step: this.data.step });
    this.setData({ step: Math.min(this.data.step + 1, 3), fieldErrors: {} }, this.scrollToTop);
  },

  prevStep() {
    this.setData({ step: Math.max(this.data.step - 1, 1), fieldErrors: {} }, this.scrollToTop);
  },

  validateStep(step) {
    const { form } = this.data;
    const errors = {};

    if (step === 1) {
      if (!form.brandName) errors.brandName = '请填写品牌名称';
      if (!form.industry) errors.industry = '请选择所属行业';
    }

    if (step === 2) {
      if (!form.offerings) errors.offerings = '请填写核心产品或服务';
      if (!form.audiences) errors.audiences = '请填写主要客户与需求';
      if (!form.targetMarket.length) errors.targetMarket = '请选择主要市场';
      if (this.splitCompetitors(form.competitors).length > 3) errors.competitors = '最多填写 3 个竞品';
      if (!form.goals.length) errors.goals = '请选择本次诊断目标';
    }

    if (step === 3) {
      if (!form.contactName) errors.contactName = '请填写联系人';
      if (!this.data.phoneAuthorized || !form.contactMethod) errors.contactMethod = '请先完成手机号授权';
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
      this.saveOrderSnapshot({
        clientId: result.clientId,
        projectId: result.projectId,
        brandName: form.brandName,
        industry: form.industry,
        segment: form.segment,
        status: result.status,
        submittedAt: result.submittedAt || submittedAt
      });
      wx.removeStorageSync(draftKey);
      track('form_submit_success', {
        client_id: result.clientId,
        industry: form.industry
      });
      this.resetForm();
      this.goSubmitSuccess();
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

  goSubmitSuccess() {
    const url = '/pages/submit-success/submit-success';
    wx.navigateTo({
      url,
      fail: () => {
        wx.reLaunch({ url });
      }
    });
  },

  normalizeForm(form) {
    const normalized = { ...form };
    delete normalized.targetMarketOther;
    return {
      ...normalized,
      targetMarket: Array.isArray(normalized.targetMarket) ? normalized.targetMarket : [],
      goals: Array.isArray(normalized.goals) ? normalized.goals : [],
      uploads: Array.isArray(normalized.uploads) ? normalized.uploads : []
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
      industryIndex: 0,
      segmentIndex: 0,
      segmentOptions: this.getSegmentOptions(this.data.industries[0]),
      marketIndex: 0,
      goalOptions: this.syncGoalOptions([]),
      step: 1
    });
  },

  saveOrderSnapshot(order) {
    const storageKey = 'geogi_my_orders';
    const current = wx.getStorageSync(storageKey) || [];
    const next = [order].concat(current.filter((item) => item.projectId !== order.projectId)).slice(0, 20);
    wx.setStorageSync(storageKey, next);
    wx.setStorageSync('geogi_client_id', order.clientId);
  },

  scrollToTop() {
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 180
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
