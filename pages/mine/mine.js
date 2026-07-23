const { get, isApiConfigured } = require('../../utils/request');

Page({
  data: {
    loading: false,
    error: '',
    clientId: '',
    orders: []
  },

  onShow() {
    this.loadOrders();
  },

  async loadOrders() {
    const localOrders = wx.getStorageSync('geogi_my_orders') || [];
    const lastSubmission = wx.getStorageSync('geogi_last_submission') || {};
    const clientId = wx.getStorageSync('geogi_client_id') || lastSubmission.clientId || (localOrders[0] && localOrders[0].clientId) || '';

    this.setData({
      clientId,
      orders: localOrders,
      error: ''
    });

    if (!clientId || !isApiConfigured()) return;

    this.setData({ loading: true });
    try {
      const result = await get('/api/customer/projects', { clientId });
      if (!result || !result.ok) throw new Error(result && result.userMessage ? result.userMessage : '订单读取失败');
      const orders = result.orders || [];
      this.setData({ orders, error: '' });
      wx.setStorageSync('geogi_my_orders', orders);
      wx.setStorageSync('geogi_client_id', clientId);
    } catch (error) {
      this.setData({
        error: '暂时无法同步最新状态，已显示本机保存的订单。'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  },

  openReport(event) {
    const projectId = event.currentTarget.dataset.projectId;
    const clientId = event.currentTarget.dataset.clientId || this.data.clientId;
    if (!projectId || !clientId) return;
    const order = this.data.orders.find((item) => item.projectId === projectId);
    if (order && order.reportReady && order.reportLink) {
      this.openPdf(order.reportLink);
      return;
    }
    wx.navigateTo({
      url: `/pages/report-detail/report-detail?projectId=${encodeURIComponent(projectId)}&clientId=${encodeURIComponent(clientId)}`
    });
  },

  openPdf(url) {
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

  refresh() {
    this.loadOrders();
  }
});
