const { get, isApiConfigured } = require('../../utils/request');

const PUBLIC_STATUSES = ['已提交', '资料待补充', '诊断处理中', '报告审核中', '报告已完成'];

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
    const normalizedLocal = localOrders.map((item) => this.normalizeOrder(item));

    this.setData({
      clientId,
      orders: normalizedLocal,
      error: ''
    });

    if (!clientId || !isApiConfigured()) return;

    this.setData({ loading: true });
    try {
      const result = await get('/api/customer/projects', { clientId });
      if (!result || !result.ok) throw new Error(result && result.userMessage ? result.userMessage : '报告状态读取失败');
      const orders = (result.orders || []).map((item) => this.normalizeOrder(item));
      this.setData({ orders, error: '' });
      wx.setStorageSync('geogi_my_orders', orders);
      wx.setStorageSync('geogi_client_id', clientId);
    } catch (error) {
      this.setData({
        error: '暂时无法同步最新状态，已显示本机保存的诊断记录。'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  normalizeOrder(order) {
    const item = order || {};
    const status = PUBLIC_STATUSES.includes(item.status) ? item.status : this.mapLegacyStatus(item.status, item.reportReady);
    return {
      ...item,
      status,
      reportReady: status === '报告已完成' && Boolean(item.reportReady)
    };
  },

  mapLegacyStatus(status, reportReady) {
    if (reportReady) return '报告已完成';
    const value = String(status || '');
    if (/待补充|补充材料|资料不全/.test(value)) return '资料待补充';
    if (/审核|复核|初稿|质检/.test(value)) return '报告审核中';
    if (/处理中|检测|测试|分析|生成|品牌资料/.test(value)) return '诊断处理中';
    return '已提交';
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  },

  openReport(event) {
    const projectId = event.currentTarget.dataset.projectId;
    const clientId = event.currentTarget.dataset.clientId || this.data.clientId;
    if (!projectId || !clientId) return;
    wx.navigateTo({
      url: `/pages/report-detail/report-detail?projectId=${encodeURIComponent(projectId)}&clientId=${encodeURIComponent(clientId)}`
    });
  },

  refresh() {
    this.loadOrders();
  }
});
