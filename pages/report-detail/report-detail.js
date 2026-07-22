const { get, isApiConfigured } = require('../../utils/request');

Page({
  data: {
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
      this.setData({
        order: result.order,
        report: this.normalizeReport(result.report),
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

  refresh() {
    this.loadReport();
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  },

  goMine() {
    wx.switchTab({ url: '/pages/mine/mine' });
  }
});
