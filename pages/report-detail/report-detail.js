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
    supplementMessage: ''
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
      this.setData({
        loading: false,
        error: '缺少订单信息，请回到“我的”重新打开。'
      });
      return;
    }

    if (!isApiConfigured()) {
      this.setData({
        loading: false,
        error: '服务地址还未配置，暂时无法查看报告。'
      });
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
      this.setData({
        error: error && error.message ? error.message : '报告读取失败'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadReport();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  normalizeOrder(order) {
    if (!order) return null;
    return {
      ...order,
      submittedAt: this.formatDisplayTime(order.submittedAt),
      completedAt: this.formatDisplayTime(order.completedAt),
      updatedAt: this.formatDisplayTime(order.updatedAt)
    };
  },

  normalizeReport(report) {
    const data = report || {};
    return {
      ...data,
      dimensions: data.dimensions || [],
      platforms: data.platforms || [],
      keyFindings: data.keyFindings || [],
      recommendations: data.recommendations || [],
      scope: data.scope || []
    };
  },

  formatDisplayTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw
        .replace('T', ' ')
        .replace(/\.\d{3}Z?$/, '')
        .replace(/Z$/, '')
        .slice(0, 16);
    }

    const pad = (number) => String(number).padStart(2, '0');

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('-') + ' ' + [
      pad(date.getHours()),
      pad(date.getMinutes())
    ].join(':');
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
        this.setData({
          supplementFile: { name: file.name, size: file.size, path: file.path },
          supplementMessage: ''
        });
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
        files.push({
          name: uploaded.name || file.name,
          size: uploaded.size || file.size,
          fileId: uploaded.fileId,
          url: uploaded.url
        });
      }

      const result = await post(`/api/customer/projects/${encodeURIComponent(this.data.projectId)}/supplement`, {
        clientId: this.data.clientId,
        companyName,
        note,
        files
      });
      if (!result || !result.ok) {
        throw new Error(result && result.userMessage ? result.userMessage : '补充资料提交失败');
      }

      this.setData({
        supplementFile: null,
        supplementNote: '',
        supplementMessage: '补充资料已提交，等待 GeoGi OS 核验。'
      });
      wx.showToast({ title: '资料已提交', icon: 'success' });
      await this.loadReport();
    } catch (error) {
      this.setData({
        supplementMessage: error && error.message ? error.message : '补充资料提交失败'
      });
    } finally {
      this.setData({ supplementSubmitting: false });
    }
  },

  refresh() {
    this.loadReport();
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  },

  openPdf() {
    const url = this.data.report && this.data.report.reportLink;
    if (!url) {
      wx.showToast({ title: 'PDF报告还未生成', icon: 'none' });
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
          fail: () => wx.showToast({ title: '无法打开PDF', icon: 'none' })
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '报告下载失败', icon: 'none' });
      }
    });
  },

  goMine() {
    wx.switchTab({ url: '/pages/mine/mine' });
  }
});
