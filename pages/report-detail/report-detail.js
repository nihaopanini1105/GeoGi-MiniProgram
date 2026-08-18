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
