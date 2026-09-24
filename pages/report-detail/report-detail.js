const { get, post, uploadFile, isApiConfigured } = require('../../utils/request');

Page({
  data: {
    loading: true,
    error: '',
    clientId: '',
    projectId: '',
    order: null,
    report: null,
    supplementCompanyName: '',
    supplementNote: '',
    supplementFile: null,
    supplementSubmitting: false,
    supplementMessage: '',
    paymentLoading: false,
    paymentError: ''
  },

  onLoad(options) {
    this.setData({
      clientId: options.clientId || '',
      projectId: options.projectId || ''
    });
    this.loadReport();
  },

  async loadReport() {
    const { clientId, projectId } = this.data;
    if (!clientId || !projectId) {
      this.setData({ loading: false, error: '缺少项目信息，请回到“我的”重新打开。' });
      return;
    }
    if (!isApiConfigured()) {
      this.setData({ loading: false, error: '服务暂时不可用，请稍后再试。' });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const result = await get(`/api/customer/reports/${encodeURIComponent(projectId)}`, { clientId });
      if (!result || !result.ok) throw new Error(result && result.userMessage ? result.userMessage : '报告读取失败');
      const order = this.normalizeOrder(result.order);
      this.setData({
        order,
        report: this.normalizeReport(result.report),
        supplementCompanyName: this.data.supplementCompanyName || (order && order.companyName) || '',
        error: ''
      });
    } catch (error) {
      this.setData({ error: error && error.message ? error.message : '报告读取失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onPullDownRefresh() {
    try { await this.loadReport(); } finally { wx.stopPullDownRefresh(); }
  },

  normalizeOrder(order) {
    if (!order) return null;
    return {
      ...order,
      amountYuan: Number(order.amountYuan !== undefined ? order.amountYuan : 199),
      paymentStatus: order.paymentStatus || (order.payment && order.payment.status) || 'unpaid',
      submittedAt: this.formatDisplayTime(order.submittedAt),
      completedAt: this.formatDisplayTime(order.completedAt),
      updatedAt: this.formatDisplayTime(order.updatedAt)
    };
  },

  normalizeReport(report) {
    const data = report || {};
    return {
      status: data.status || '处理中',
      reportReady: data.reportReady === true,
      reportLink: data.reportLink || '',
      reportVersion: data.reportVersion || '',
      releasedAt: this.formatDisplayTime(data.releasedAt),
      deliveryPackageId: data.deliveryPackageId || '',
      deliveryContractVersion: data.deliveryContractVersion || '',
      deliveryMode: data.deliveryMode || 'artifact_only',
      productionAuthority: data.productionAuthority || 'geogi_os',
      reportContentHash: data.reportContentHash || '',
      reportRecordHash: data.reportRecordHash || '',
      artifactSha256: data.artifactSha256 || ''
    };
  },

  formatDisplayTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw.replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace(/Z$/, '').slice(0, 16);
    }
    const pad = (number) => String(number).padStart(2, '0');
    return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') + ' ' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
  },

  updateSupplementCompanyName(event) {
    this.setData({ supplementCompanyName: event.detail.value, supplementMessage: '' });
  },

  updateSupplementNote(event) {
    this.setData({ supplementNote: event.detail.value, supplementMessage: '' });
  },

  chooseSupplementFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: ({ tempFiles }) => {
        const file = tempFiles && tempFiles[0];
        if (!file) return;
        const ext = String(file.name || '').split('.').pop().toLowerCase();
        const allowed = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'];
        if (!allowed.includes(ext)) {
          wx.showToast({ title: '文件类型不支持', icon: 'none' });
          return;
        }
        if (Number(file.size || 0) > 20 * 1024 * 1024) {
          wx.showToast({ title: '文件不能超过20MB', icon: 'none' });
          return;
        }
        this.setData({ supplementFile: { name: file.name, size: file.size, path: file.path }, supplementMessage: '' });
      }
    });
  },

  removeSupplementFile() {
    this.setData({ supplementFile: null, supplementMessage: '' });
  },

  async submitSupplement() {
    if (this.data.supplementSubmitting) return;
    const companyName = String(this.data.supplementCompanyName || '').trim();
    const note = String(this.data.supplementNote || '').trim();
    const file = this.data.supplementFile;
    if (!companyName && !note && !file) {
      this.setData({ supplementMessage: '请填写企业主体或上传证明材料。' });
      return;
    }

    this.setData({ supplementSubmitting: true, supplementMessage: '' });
    try {
      const files = [];
      if (file) {
        const uploaded = await uploadFile('/api/uploads', file.path, 'file', {
          submissionId: `supplement-${this.data.projectId}`,
          fileName: file.name
        });
        files.push({ name: uploaded.name || file.name, size: uploaded.size || file.size, fileId: uploaded.fileId, url: uploaded.url });
      }
      const result = await post(`/api/customer/projects/${encodeURIComponent(this.data.projectId)}/supplement`, {
        clientId: this.data.clientId,
        companyName,
        note,
        files
      });
      if (!result || !result.ok) throw new Error(result && result.userMessage ? result.userMessage : '补充资料提交失败');
      this.setData({ supplementFile: null, supplementNote: '', supplementMessage: '补充资料已提交，等待 GeoGi OS 核验。' });
      wx.showToast({ title: '资料已提交', icon: 'success' });
      await this.loadReport();
    } catch (error) {
      this.setData({ supplementMessage: error && error.message ? error.message : '补充资料提交失败' });
    } finally {
      this.setData({ supplementSubmitting: false });
    }
  },

  paymentPaid() {
    const status = String((this.data.order && this.data.order.paymentStatus) || '');
    return status === 'paid' || status === 'free' || status === 'partially_refunded';
  },

  async payNow() {
    if (this.data.paymentLoading || this.paymentPaid()) return;
    if (!isApiConfigured()) {
      this.setData({ paymentError: '支付服务暂未连接，请稍后再试。' });
      return;
    }
    this.setData({ paymentLoading: true, paymentError: '' });
    try {
      const loginCode = await new Promise((resolve, reject) => {
        wx.login({
          success: (res) => res && res.code ? resolve(res.code) : reject(new Error('微信登录失败')),
          fail: reject
        });
      });
      const result = await post(
        '/api/customer/projects/' + encodeURIComponent(this.data.projectId) + '/payment',
        { clientId: this.data.clientId, loginCode }
      );
      if (!result || !result.ok) throw new Error(result && result.userMessage ? result.userMessage : '支付订单创建失败');
      if (!result.alreadyPaid) {
        const params = result.payParams;
        if (!params) throw new Error('微信支付参数缺失');
        await new Promise((resolve, reject) => {
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
        await post(
          '/api/customer/projects/' + encodeURIComponent(this.data.projectId) + '/payment/sync',
          { clientId: this.data.clientId }
        );
      }
      await this.loadReport();
      if (!this.paymentPaid()) throw new Error('付款结果正在确认，请稍后刷新');
      wx.showToast({ title: this.data.order && this.data.order.paymentStatus === 'free' ? '优惠已生效' : '付款成功', icon: 'success' });
    } catch (error) {
      const message = error && error.errMsg
        ? error.errMsg
        : (error && error.message ? error.message : '付款未完成');
      this.setData({
        paymentError: /cancel/i.test(message) ? '你已取消付款，可随时重新支付。' : message
      });
    } finally {
      this.setData({ paymentLoading: false });
    }
  },

  refresh() { this.loadReport(); },
  goContact() { wx.navigateTo({ url: '/pages/contact/contact' }); },

  openPdf() {
    const url = this.data.report && this.data.report.reportLink;
    if (!url) {
      wx.showToast({ title: '正式报告尚未发布', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '打开报告中' });
    wx.downloadFile({
      url,
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode !== 200) {
          wx.showToast({ title: '报告读取失败', icon: 'none' });
          return;
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType: 'pdf',
          showMenu: true,
          fail: () => wx.showToast({ title: '无法打开报告文件', icon: 'none' })
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '报告下载失败', icon: 'none' });
      }
    });
  },

  goMine() { wx.switchTab({ url: '/pages/mine/mine' }); }
});
