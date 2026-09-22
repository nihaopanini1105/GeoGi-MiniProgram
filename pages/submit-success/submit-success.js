const { payDiagnosticReport, getPaymentStatus, PRODUCT } = require('../../utils/payment');

Page({
  data: {
    submission: {},
    submittedAtText: '',
    paymentLoading: false,
    paymentMessage: '',
    product: PRODUCT,
    nextSteps: [
      {
        title: '确认付款',
        desc: '完成 199 元微信支付后，GeoGi 才开始本次诊断服务。'
      },
      {
        title: '建立品牌企业画像',
        desc: '结合客户资料与公开信息完善品牌、业务、产品、目标客户和竞争环境。'
      },
      {
        title: '检测中国主流 AI 平台',
        desc: '围绕品牌真实业务场景执行多平台检测并保留结果证据。'
      },
      {
        title: '交付品牌 GEO 诊断报告',
        desc: '完成诊断和人工审核后，正式报告会出现在小程序「报告」中。'
      }
    ]
  },

  onShow() {
    const submission = wx.getStorageSync('geogi_last_submission') || {};
    this.setData({
      submission,
      submittedAtText: this.formatDate(submission.submittedAt),
      paymentMessage: ''
    });
    if (submission.clientId && submission.projectId) this.refreshPaymentStatus();
  },

  async refreshPaymentStatus() {
    const submission = this.data.submission || {};
    try {
      const payment = await getPaymentStatus({
        clientId: submission.clientId,
        projectId: submission.projectId
      });
      const next = {
        ...submission,
        paymentStatus: payment.paymentStatusLabel || submission.paymentStatus || '待支付',
        paymentStatusCode: payment.paymentStatus || '',
        amountFen: payment.amountFen || submission.amountFen || PRODUCT.amountFen,
        amountYuan: payment.amountYuan || submission.amountYuan || PRODUCT.amountYuan,
        paidAt: payment.paidAt || ''
      };
      wx.setStorageSync('geogi_last_submission', next);
      this.setData({ submission: next });
    } catch (_error) {
      // Keep local submission visible if network status refresh fails.
    }
  },

  async payNow() {
    if (this.data.paymentLoading) return;
    const submission = this.data.submission || {};
    if (!submission.clientId || !submission.projectId) {
      this.setData({ paymentMessage: '缺少诊断订单信息，请返回重新提交资料。' });
      return;
    }
    this.setData({ paymentLoading: true, paymentMessage: '' });
    try {
      const result = await payDiagnosticReport({
        clientId: submission.clientId,
        projectId: submission.projectId
      });
      if (result.paid) {
        const next = {
          ...submission,
          status: '已付款',
          paymentStatus: '已支付',
          paymentStatusCode: 'PAID',
          paidAt: result.payment && result.payment.paidAt || ''
        };
        wx.setStorageSync('geogi_last_submission', next);
        this.setData({ submission: next, paymentMessage: '支付成功，GeoGi 将开始本次品牌 GEO 诊断。' });
        wx.showToast({ title: '支付成功', icon: 'success' });
      } else if (result.cancelled) {
        this.setData({ paymentMessage: '支付已取消，你可以稍后继续支付。' });
      } else {
        this.setData({ paymentMessage: '支付结果正在确认，请稍后刷新支付状态。' });
      }
    } catch (error) {
      this.setData({ paymentMessage: error && error.message ? error.message : '支付未完成，请稍后重试。' });
    } finally {
      this.setData({ paymentLoading: false });
      await this.refreshPaymentStatus();
    }
  },

  formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  },

  goReport() {
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
