const { platforms } = require('../../config/platforms');
const { assets } = require('../../config/assets');
const { post, uploadFile, getCustomerToken, isApiConfigured } = require('../../utils/request');
const { track } = require('../../utils/analytics');
const { getAttribution, captureAttribution, refreshAttribution, clearAttributionAfterOrder } = require('../../utils/attribution');

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
    attribution: null,
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
    deliveries: ['品牌企业画像', '主流 AI 平台检测', '竞品与问题诊断', '正式 GEO 诊断报告'],
    industries: [
      '旅游与文旅',
      '金融与保险',
      '软件与互联网',
      '企业服务',
      '消费品与零售',
      '汽车与出行',
      '房地产与家居',
      '教育培训',
      '医疗健康',
      '本地生活',
      '制造与工业',
      '专业服务',
      '其他行业'
    ],
    industrySegments: {
      '旅游与文旅': ['旅行社/旅游服务商', '机票/航旅服务', '酒店/住宿', '商旅服务', '定制旅行', '目的地服务', '其他旅游服务'],
      '金融与保险': ['保险公司', '保险经纪/代理', '银行/消费金融', '证券/基金', '财富管理', '支付/金融科技', '融资租赁', '其他金融保险'],
      '软件与互联网': ['SaaS 软件', 'AI 工具', '数据服务', '电商平台', '内容社区', '开发者服务', '其他软件互联网'],
      '企业服务': ['品牌营销', '管理咨询', '销售获客', '企业培训', '办公/协作服务', '供应链服务', '其他企业服务'],
      '消费品与零售': ['食品饮料', '美妆个护', '服饰配饰', '母婴亲子', '家居生活', '消费电子', '线下零售', '其他消费零售'],
      '汽车与出行': ['汽车品牌', '新能源汽车', '汽车经销/4S', '二手车', '租车/出行服务', '汽车后市场', '其他汽车出行'],
      '房地产与家居': ['房地产开发', '房产中介', '商业地产', '物业服务', '装修设计', '家居家装', '其他地产家居'],
      '教育培训': ['职业教育', '企业培训', 'K12/素质教育', '留学语培', '知识付费', '教育科技', '其他教育培训'],
      '医疗健康': ['医疗美容', '口腔服务', '医疗服务', '健康管理', '康复护理', '医疗科技', '其他医疗健康'],
      '本地生活': ['餐饮', '美容美发', '健身运动', '宠物服务', '婚庆摄影', '家政维修', '其他本地生活'],
      '制造与工业': ['工业设备', '电子/半导体', '汽车零部件', '新材料/化工', '能源/环保', '工业软件/服务', '其他制造工业'],
      '专业服务': ['法律服务', '财税服务', '会计/审计', '知识产权', '人力资源/招聘', '商务咨询', '其他专业服务'],
      '其他行业': ['媒体文化', '公益/机构', '农业食品产业', '体育娱乐', '政府/园区服务', '其他业务']
    },
    segmentOptions: ['旅行社/旅游服务商', '机票/航旅服务', '酒店/住宿', '商旅服务', '定制旅行', '目的地服务', '其他旅游服务'],
    marketOptions: ['全国市场', '本地市场', 'B2B 企业客户', 'C 端消费者', '海外业务客户', '其他市场'],
    goalOptions: [
      { label: 'AI 是否会主动推荐我的品牌', selected: false },
      { label: '检查品牌信息是否准确', selected: false },
      { label: '比较竞品推荐情况', selected: false },
      { label: '找到内容和信源缺口', selected: false },
      { label: '准备做 GEO 优化', selected: false }
    ]
  },

  onLoad(options) {
    void this.loadAttribution(options || {});
    const phoneAuth = this.readValidPhoneAuth();
    const shouldStartNew = wx.getStorageSync('geogi_start_new_diagnosis') || options.start === '1';
    this.setData({
      phoneAuthorized: Boolean(phoneAuth.phoneNumber),
      phoneDisplay: phoneAuth.phoneNumber || ''
    });

    if (shouldStartNew) {
      wx.removeStorageSync('geogi_start_new_diagnosis');
      wx.removeStorageSync(draftKey);
      wx.removeStorageSync('geogi_last_submission');
      this.startForm({ forceNew: true });
      return;
    }

    const draft = wx.getStorageSync(draftKey);
    if (draft) {
      const form = this.normalizeForm({ ...initialForm, ...draft });
      const segmentOptions = this.getSegmentOptions(form.industry);
      this.setData({
        started: Boolean(options.start) || this.hasDraftContent(form),
        form: {
          ...form,
          contactMethod: phoneAuth.phoneNumber || form.contactMethod || ''
        },
        industryIndex: this.getOptionIndex(this.data.industries, form.industry),
        segmentOptions,
        segmentIndex: this.getOptionIndex(segmentOptions, form.segment),
        marketIndex: this.getOptionIndex(this.data.marketOptions, form.targetMarket[0]),
        goalOptions: this.syncGoalOptions(form.goals)
      });
    }
  },

  onShow() {
    this.setData({ attribution: getAttribution() });
    const phoneAuth = this.readValidPhoneAuth();
    this.setData({
      phoneAuthorized: Boolean(phoneAuth.phoneNumber),
      phoneDisplay: phoneAuth.phoneNumber || ''
    });

    if (!wx.getStorageSync('geogi_start_new_diagnosis')) return;
    wx.removeStorageSync('geogi_start_new_diagnosis');
    wx.removeStorageSync(draftKey);
    wx.removeStorageSync('geogi_last_submission');
    this.startForm({ forceNew: true });
  },

  async loadAttribution(options = {}) {
    await captureAttribution(options);
    const attribution = await refreshAttribution();
    this.setData({ attribution: attribution || getAttribution() });
  },

  readValidPhoneAuth() {
    const phoneAuth = wx.getStorageSync('geogi_phone_auth') || {};
    const token = getCustomerToken();
    const expiresAt = phoneAuth.customerTokenExpiresAt || wx.getStorageSync('geogi_customer_token_expires_at') || '';
    const expired = expiresAt && new Date(expiresAt).getTime() <= Date.now();
    if (!phoneAuth.phoneNumber || !token || expired) {
      if (expired || (!token && phoneAuth.phoneNumber)) {
        wx.removeStorageSync('geogi_phone_auth');
        wx.removeStorageSync('geogi_customer_token');
        wx.removeStorageSync('geogi_customer_token_expires_at');
      }
      return {};
    }
    return phoneAuth;
  },

  async onGetPhoneNumber(event) {
    const detail = event.detail || {};
    if (!/ok/i.test(detail.errMsg || '') || !detail.code) {
      this.setData({ phoneAuthError: '需要先授权手机号，才能提交正式诊断申请。' });
      return;
    }

    if (!isApiConfigured()) {
      this.setData({ phoneAuthError: '诊断服务暂未连接，请稍后再试。' });
      return;
    }

    this.setData({ phoneAuthLoading: true, phoneAuthError: '' });
    try {
      const result = await post('/api/wechat/phone', { code: detail.code });
      if (!result || !result.ok || !result.phoneNumber || !result.customerToken) {
        throw new Error(result && result.userMessage ? result.userMessage : '手机号授权失败');
      }
      const phoneAuth = {
        phoneNumber: result.phoneNumber,
        purePhoneNumber: result.purePhoneNumber || result.phoneNumber,
        countryCode: result.countryCode || '',
        customerTokenExpiresAt: result.customerTokenExpiresAt || '',
        authorizedAt: new Date().toISOString()
      };
      wx.setStorageSync('geogi_phone_auth', phoneAuth);
      wx.setStorageSync('geogi_customer_token', result.customerToken);
      if (result.customerTokenExpiresAt) {
        wx.setStorageSync('geogi_customer_token_expires_at', result.customerTokenExpiresAt);
      }
      this.setData({
        phoneAuthorized: true,
        phoneDisplay: phoneAuth.phoneNumber,
        phoneAuthError: ''
      });
      this.setFormValue('contactMethod', phoneAuth.phoneNumber);
      wx.showToast({ title: '手机号已授权', icon: 'success' });
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
    const phoneAuth = this.readValidPhoneAuth();
    const form = {
      ...(forceNew ? initialForm : this.data.form),
      contactMethod: phoneAuth.phoneNumber || '',
      submissionId: forceNew ? this.makeSubmissionId() : (this.data.form.submissionId || this.makeSubmissionId())
    };
    const firstIndustry = this.data.industries[0];
    this.setData({
      started: true,
      step: 1,
      submitting: false,
      fieldErrors: {},
      form,
      industryIndex: 0,
      segmentIndex: 0,
      segmentOptions: this.getSegmentOptions(firstIndustry),
      marketIndex: 0,
      goalOptions: this.syncGoalOptions([])
    }, this.scrollToTop);
    wx.setStorageSync(draftKey, form);
    track('form_start', { source: 'diagnosis_entry' });
  },

  updateField(event) {
    const key = event.currentTarget.dataset.key;
    this.setFormValue(key, event.detail.value);
  },

  chooseIndustry(event) {
    const index = Number(event.detail.value);
    const industry = this.data.industries[index];
    const segmentOptions = this.getSegmentOptions(industry);
    this.setData({ industryIndex: index, segmentOptions, segmentIndex: 0 });
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
      this.setData({ fieldErrors: { ...this.data.fieldErrors, goals: '最多选择 3 项' } });
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
          next.push({ name: file.name, size: file.size, path: file.path, uploaded: false });
        });
        this.setFormValue('uploads', current.concat(next).slice(0, 3));
        if (rejected.length) {
          this.setData({ fieldErrors: { ...this.data.fieldErrors, uploads: rejected[0] } });
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
    const form = this.normalizeForm({ ...this.data.form, [key]: value });
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
      if (!form.segment) errors.segment = '请选择细分领域';
    }
    if (step === 2) {
      if (!form.offerings) errors.offerings = '请填写核心产品或服务';
      if (!form.audiences) errors.audiences = '请填写主要客户与需求';
      if (!form.targetMarket.length) errors.targetMarket = '请选择主要市场';
      if (!form.goals.length) errors.goals = '请选择本次诊断目标';
    }
    if (step === 3) {
      const phoneAuth = this.readValidPhoneAuth();
      if (!form.contactName) errors.contactName = '请填写联系人';
      if (!phoneAuth.phoneNumber || form.contactMethod !== phoneAuth.phoneNumber) errors.contactMethod = '请先完成手机号授权';
      if (!form.privacyAccepted) errors.privacyAccepted = '提交前需要同意隐私说明';
    }
    this.setData({ fieldErrors: errors });
    return Object.keys(errors).length === 0;
  },

  async submit() {
    if (!this.validateStep(3) || this.data.submitting) return;
    if (!isApiConfigured()) {
      this.setData({ fieldErrors: { submit: '诊断服务暂未连接，请稍后再试。' } });
      return;
    }
    this.setData({ submitting: true, fieldErrors: {} });
    const submittedAt = new Date().toISOString();
    let submissionCreated = false;
    try {
      const uploadedFiles = await this.uploadAttachments();
      const attribution = getAttribution();
      const form = {
        ...this.data.form,
        uploads: uploadedFiles,
        submittedAt,
        sourceToken: attribution && attribution.sourceToken || '',
        sourceCapturedAt: attribution && attribution.capturedAt || ''
      };
      const result = await post('/api/leads', { form, source: 'wechat_miniprogram' });
      if (!result || !result.ok) {
        throw new Error(result && result.userMessage ? result.userMessage : '提交失败，请稍后重试');
      }

      const submission = {
        clientId: result.clientId,
        projectId: result.projectId,
        status: result.status || '待付款',
        submittedAt: result.submittedAt || submittedAt,
        paymentRequired: result.paymentRequired !== false,
        amountYuan: Number(result.amountYuan || 199),
        productName: result.productName || 'GeoGi 品牌 GEO 诊断报告',
        paymentStatus: result.payment && result.payment.status ? result.payment.status : 'unpaid',
        amountYuan: Number(result.amountYuan !== undefined ? result.amountYuan : 199),
        listPriceYuan: Number(result.listPriceYuan || 199),
        sourceId: result.sourceId || '',
        sourceName: result.sourceName || '',
        sourceType: result.sourceType || '',
        channelId: result.channelId || '',
        channelName: result.channelName || '',
        payment: result.payment || null
      };
      submissionCreated = true;
      wx.setStorageSync('geogi_last_submission', submission);
      this.saveOrderSnapshot({
        ...submission,
        brandName: form.brandName,
        industry: form.industry,
        segment: form.segment,
        paymentStatus: submission.paymentStatus || 'unpaid',
        amountYuan: submission.amountYuan
      });
      wx.removeStorageSync(draftKey);
      wx.removeStorageSync('geogi_payment_attempt_error');
      clearAttributionAfterOrder();
      this.setData({ attribution: null });
      track('form_submit_success', { industry: form.industry });

      try {
        if (submission.paymentStatus === 'free') {
          this.persistPaidSubmission(submission, submission.payment);
        } else {
          await this.paySubmission(submission);
        }
      } catch (paymentError) {
        const message = paymentError && paymentError.errMsg
          ? paymentError.errMsg
          : (paymentError && paymentError.message ? paymentError.message : '付款未完成');
        const cancelled = /cancel/i.test(message);
        wx.setStorageSync(
          'geogi_payment_attempt_error',
          cancelled ? '你已取消付款，可随时重新支付。' : message
        );
        track('direct_payment_fail', {
          project_id: submission.projectId,
          error_code: message
        });
      }

      this.resetForm();
      this.goSubmitSuccess();
    } catch (error) {
      const message = error && error.message ? error.message : '提交失败，资料已保留';
      if (/身份验证|授权手机号|401/.test(message)) {
        wx.removeStorageSync('geogi_phone_auth');
        wx.removeStorageSync('geogi_customer_token');
        wx.removeStorageSync('geogi_customer_token_expires_at');
        this.setData({ phoneAuthorized: false, phoneDisplay: '' });
      }
      if (submissionCreated) {
        wx.setStorageSync('geogi_payment_attempt_error', message);
        this.resetForm();
        this.goSubmitSuccess();
        return;
      }
      track('form_submit_fail', { error_code: message });
      this.setData({ fieldErrors: { submit: message } });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async paySubmission(submission) {
    if (!submission || !submission.projectId || !submission.clientId) {
      throw new Error('缺少诊断项目信息，请重新提交。');
    }
    const loginCode = await this.getLoginCode();
    const result = await post(
      '/api/customer/projects/' + encodeURIComponent(submission.projectId) + '/payment',
      {
        clientId: submission.clientId,
        loginCode
      }
    );
    if (!result || !result.ok) {
      throw new Error(result && result.userMessage ? result.userMessage : '支付订单创建失败');
    }

    if (result.alreadyPaid) {
      this.persistPaidSubmission(submission, result.payment);
      return;
    }
    if (!result.payParams) throw new Error('微信支付参数缺失');

    await this.requestPayment(result.payParams);
    const synced = await post(
      '/api/customer/projects/' + encodeURIComponent(submission.projectId) + '/payment/sync',
      { clientId: submission.clientId }
    );
    const payment = synced && synced.payment ? synced.payment : result.payment;
    const paid = Boolean(payment && ['paid', 'free', 'partially_refunded'].includes(payment.status));
    if (!paid) throw new Error('付款结果正在确认，请稍后刷新');

    this.persistPaidSubmission(submission, payment);
    track('direct_payment_success', { project_id: submission.projectId });
  },

  getLoginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => res && res.code ? resolve(res.code) : reject(new Error('微信登录失败')),
        fail: reject
      });
    });
  },

  requestPayment(params) {
    return new Promise((resolve, reject) => {
      wx.requestPayment({
        timeStamp: params.timeStamp,
        nonceStr: params.nonceStr,
        package: params.package,
        signType: params.signType || 'RSA',
        paySign: params.paySign,
        success: resolve,
        fail: reject
      });
    });
  },

  persistPaidSubmission(submission, payment) {
    const paidSubmission = {
      ...submission,
      status: payment && payment.status === 'free' ? '已优惠至免费' : '已付款',
      paymentStatus: payment && payment.status ? payment.status : 'paid',
      paidAt: payment && payment.paidAt ? payment.paidAt : '',
      payment: payment || submission.payment || null
    };
    wx.setStorageSync('geogi_last_submission', paidSubmission);

    const orders = wx.getStorageSync('geogi_my_orders') || [];
    wx.setStorageSync(
      'geogi_my_orders',
      orders.map((item) => item.projectId === paidSubmission.projectId
        ? {
            ...item,
            status: payment && payment.status === 'free' ? '已优惠至免费' : '已付款',
            paymentStatus: paidSubmission.paymentStatus,
            paidAt: paidSubmission.paidAt,
            payment: paidSubmission.payment,
            amountYuan: Number(payment && payment.amountYuan !== undefined ? payment.amountYuan : paidSubmission.amountYuan || 199)
          }
        : item)
    );
  },

  uploadAttachments() {
    const uploads = this.data.form.uploads || [];
    if (!uploads.length) return Promise.resolve([]);
    return uploads.reduce((chain, file) => chain.then(async (result) => {
      if (file.fileId || !file.path) return result.concat(file);
      const response = await uploadFile('/api/uploads', file.path, 'file', {
        submissionId: this.data.form.submissionId,
        fileName: file.name
      });
      return result.concat({
        name: response.name || file.name,
        size: response.size || file.size,
        fileId: response.fileId,
        uploaded: true
      });
    }), Promise.resolve([]));
  },

  goSubmitSuccess() {
    const url = '/pages/submit-success/submit-success';
    wx.navigateTo({
      url,
      fail: () => wx.reLaunch({ url })
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
    return String(value || '').split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
  },

  hasDraftContent(form) {
    return Boolean(form.brandName || form.companyName || form.industry || form.offerings || form.contactName);
  },

  makeSubmissionId() {
    return `mp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  },

  resetForm() {
    const phoneAuth = this.readValidPhoneAuth();
    this.setData({
      started: false,
      submitting: false,
      fieldErrors: {},
      form: { ...initialForm, contactMethod: phoneAuth.phoneNumber || '' },
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
    wx.pageScrollTo({ scrollTop: 0, duration: 180 });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goServices() {
    wx.navigateTo({ url: '/pages/services/services' });
  },

  goReport() {
    wx.switchTab({ url: '/pages/mine/mine' });
  }
});
