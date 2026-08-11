const { assets } = require('../../config/assets');
const { get, downloadFile, isApiConfigured } = require('../../utils/request');

Page({
  data: {
    assets,
    loading: true,
    error: '',
    clientId: '',
    projectId: '',
    order: null,
    report: null
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
      this.setData({ loading: false, error: '缺少诊断信息，请返回报告重新打开。' });
      return;
    }
    if (!isApiConfigured()) {
      this.setData({ loading: false, error: '诊断报告服务暂未连接，请稍后再试。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await get(`/api/customer/reports/${encodeURIComponent(projectId)}`, { clientId });
      if (!result || !result.ok) throw new Error(result && result.userMessage ? result.userMessage : '报告读取失败');
      this.setData({ order: result.order || null, report: this.normalizeReport(result.report) });
    } catch (error) {
      this.setData({ error: error && error.message ? error.message : '报告读取失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  normalizeReport(report) {
    return {
      ...(report || {}),
      dimensions: (report && report.dimensions) || [],
      platforms: (report && report.platforms) || [],
      keyFindings: (report && report.keyFindings) || [],
      recommendations: (report && report.recommendations) || [],
      scope: (report && report.scope) || []
    };
  },

  refresh() {
    this.loadReport();
  },

  previewWecomQr() {
    wx.previewImage({ current: this.data.assets.contact.wecomQr, urls: [this.data.assets.contact.wecomQr] });
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  },

  async openPdf() {
    if (!this.data.projectId || !this.data.clientId) {
      wx.showToast({ title: '缺少报告信息', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '打开报告中' });
    try {
      const result = await downloadFile(`/api/customer/reports/${encodeURIComponent(this.data.projectId)}/download?clientId=${encodeURIComponent(this.data.clientId)}`);
      wx.hideLoading();
      wx.openDocument({
        filePath: result.tempFilePath,
        fileType: 'pdf',
        showMenu: true
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || '报告下载失败', icon: 'none' });
    }
  },

  goMine() {
    wx.switchTab({ url: '/pages/mine/mine' });
  }
});
