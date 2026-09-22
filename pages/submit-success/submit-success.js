const { get, post, isApiConfigured } = require('../../utils/request');

Page({
  data: {
    submission: {},
    submittedAtText: '',
    payment: null,
    paymentLoading: false,
    cancelLoading: false,
    paymentError: '',
    paid: false,
    closed: false,
    closedReason: '',
    canCancel: false,
    expiresAtText: '',
    product: {
      name: 'GeoGi 品牌 GEO 诊断报告',
      priceYuan: 199,
      currency: 'CNY'
    },
    nextSteps: [
      {
        title: '确认付款',
        desc: '支付 199 元后，GeoGi 才会开始本次品牌 GEO 诊断。'
      },
      {
        title: '建立品牌企业画像',
        desc: '整理品牌、企业、产品、客户、竞争环境与公开资料。'
      },
      {
        title: '完成多平台 GEO 检测与诊断',
        desc: '检测中国主流 AI 平台中的品牌理解、推荐、引用和竞品表现。'
      },
      {
        title: '交付诊断报告',
        desc: '报告审核完成后会出现在小程序「报告」页面。'
      }
    ]
  },

  onShow() {
    const submission = wx.getStorageSync('geogi_last_submission') || {};
    const paymentAttemptError = wx.getStorageSync('geogi_payment_attempt_error') || '';
    wx.removeStorageSync('geogi_payment_attempt_error');
    this.setData({
      submission,
      submittedAtText: this.formatDate(submission.submittedAt),
      paymentError: paymentAttemptError
    });
    if (submission.projectId) this.loadPayment();
  },

  formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0') + ' ' +
      String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0');
  },

  async loadPayment() {
    const submission = this.data.submission || {};
    if (!submission.projectId || !isApiConfigured()) return;
    try {
      const result = await get(
        '/api/customer/projects/' + encodeURIComponent(submission.projectId) + '/payment',
        { clientId: submission.clientId || '' }
      );
      if (!result || !result.ok) return;
      const payment = result.payment || null;
      const paid = Boolean(payment && ['paid', 'partially_refunded'].includes(payment.status));
      const closed = Boolean(payment && payment.status === 'closed');
      const closedReason = payment && payment.closedReason ? payment.closedReason : '';
      this.setData({
        payment,
        paid,
        closed,
        closedReason,
        canCancel: Boolean(payment && payment.canCancel),
        expiresAtText: this.formatDate(payment && payment.expiresAt),
        product: result.product || this.data.product,
        paymentError: paid
          ? ''
          : (closed
              ? (closedReason === 'expired'
                  ? '支付订单已超过 30 分钟有效期，可重新发起支付。'
                  : '订单已取消，如仍需诊断可重新发起支付。')
              : this.data.paymentError)
      });
      if (paid) this.persistPaidStatus(payment);
    } catch (error) {
      this.setData({
        paymentError: error && error.message ? error.message : '付款状态读取失败'
      });
    }
  },

  async payNow() {
    if (this.data.paymentLoading || this.data.paid) return;
    if (!isApiConfigured()) {
      this.setData({ paymentError: '支付服务暂未连接，请稍后再试。' });
      return;
    }
    const submission = this.data.submission || {};
    if (!submission.projectId || !submission.clientId) {
      this.setData({ paymentError: '缺少诊断项目信息，请返回诊断页重新提交。' });
      return;
    }
    this.setData({ paymentLoading: true, paymentError: '' });
    try {
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
        this.setData({
          payment: result.payment,
          paid: true,
          closed: false,
          closedReason: '',
          canCancel: false,
          expiresAtText: this.formatDate(result.payment && result.payment.expiresAt)
        });
        this.persistPaidStatus(result.payment);
        wx.showToast({ title: '已付款', icon: 'success' });
        return;
      }
      if (!result.payParams) throw new Error('微信支付参数缺失');
      this.setData({
        payment: result.payment || null,
        closed: false,
        closedReason: '',
        canCancel: Boolean(result.payment && result.payment.canCancel),
        expiresAtText: this.formatDate(result.payment && result.payment.expiresAt)
      });
      await this.requestPayment(result.payParams);
      const synced = await post(
        '/api/customer/projects/' + encodeURIComponent(submission.projectId) + '/payment/sync',
        { clientId: submission.clientId }
      );
      const payment = synced && synced.payment ? synced.payment : result.payment;
      const paid = Boolean(payment && ['paid', 'partially_refunded'].includes(payment.status));
      const closed = Boolean(payment && payment.status === 'closed');
      this.setData({
        payment,
        paid,
        closed,
        closedReason: payment && payment.closedReason ? payment.closedReason : '',
        canCancel: Boolean(payment && payment.canCancel),
        expiresAtText: this.formatDate(payment && payment.expiresAt)
      });
      if (!paid) throw new Error(closed ? '支付订单已关闭，请重新发起支付' : '付款结果正在确认，请稍后刷新');
      this.persistPaidStatus(payment);
      wx.showToast({ title: '付款成功', icon: 'success' });
    } catch (error) {
      const message = error && error.errMsg
        ? error.errMsg
        : (error && error.message ? error.message : '付款未完成');
      const cancelled = /cancel/i.test(message);
      this.setData({
        paymentError: cancelled ? '你已取消付款，可随时重新支付。' : message
      });
    } finally {
      this.setData({ paymentLoading: false });
    }
  },

  async cancelOrder() {
    if (this.data.cancelLoading || this.data.paid || !this.data.canCancel) return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '取消订单',
        content: '取消后本次支付订单将立即关闭。如仍需诊断，可重新发起支付。',
        confirmText: '确认取消',
        confirmColor: '#C23B3B',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;

    const submission = this.data.submission || {};
    this.setData({ cancelLoading: true, paymentError: '' });
    try {
      const result = await post(
        '/api/customer/projects/' + encodeURIComponent(submission.projectId) + '/payment/cancel',
        { clientId: submission.clientId }
      );
      if (!result || !result.ok) {
        throw new Error(result && result.userMessage ? result.userMessage : '订单取消失败');
      }
      const payment = result.payment || null;
      this.setData({
        payment,
        paid: false,
        closed: true,
        closedReason: payment && payment.closedReason ? payment.closedReason : 'customer_cancelled',
        canCancel: false,
        expiresAtText: this.formatDate(payment && payment.expiresAt),
        paymentError: '订单已取消，如仍需诊断可重新发起支付。'
      });
      wx.showToast({ title: '订单已取消', icon: 'success' });
    } catch (error) {
      this.setData({
        paymentError: error && error.message ? error.message : '订单取消失败，请稍后重试'
      });
    } finally {
      this.setData({ cancelLoading: false });
    }
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

  persistPaidStatus(payment) {
    const submission = {
      ...(this.data.submission || {}),
      status: '已付款',
      paymentStatus: payment && payment.status ? payment.status : 'paid',
      paidAt: payment && payment.paidAt ? payment.paidAt : ''
    };
    wx.setStorageSync('geogi_last_submission', submission);
    const orders = wx.getStorageSync('geogi_my_orders') || [];
    wx.setStorageSync(
      'geogi_my_orders',
      orders.map((item) => item.projectId === submission.projectId
        ? { ...item, status: '已付款', paymentStatus: submission.paymentStatus, paidAt: submission.paidAt, amountYuan: 199 }
        : item)
    );
    this.setData({ submission });
  },

  goReport() {
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
