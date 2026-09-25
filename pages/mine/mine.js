const {
  get,
  post,
  getCustomerToken,
  isApiConfigured
} = require('../../utils/request');

const PUBLIC_STATUSES = ['待付款', '付款确认中', '已付款', '已优惠至免费', '退款处理中', '部分退款', '已退款', '已提交', '资料待补充', '诊断处理中', '报告审核中', '报告已完成'];

Page({
  data: {
    loading: false,
    error: '',
    authLoading: false,
    authError: '',
    phoneAuthorized: Boolean(getCustomerToken()),
    clientId: '',
    orders: [],
    notifications: [],
    channelDashboard: null
  },

  onShow() {
    this.setData({ phoneAuthorized: Boolean(getCustomerToken()) });
    this.loadOrders();
  },

  async onGetPhoneNumber(event) {
    const detail = event.detail || {};
    if (!/ok/i.test(detail.errMsg || '') || !detail.code) {
      this.setData({ authError: '需要授权手机号才能查看你的订单和渠道数据。' });
      return;
    }
    if (!isApiConfigured()) {
      this.setData({ authError: '服务暂时不可用，请稍后再试。' });
      return;
    }
    this.setData({ authLoading: true, authError: '' });
    try {
      const result = await post('/api/wechat/phone', { code: detail.code });
      if (!result || !result.ok || !result.customerToken) {
        throw new Error(result && result.userMessage ? result.userMessage : '手机号授权失败');
      }
      wx.setStorageSync('geogi_phone_auth', {
        phoneNumber: result.phoneNumber || '',
        purePhoneNumber: result.purePhoneNumber || result.phoneNumber || '',
        countryCode: result.countryCode || '',
        customerTokenExpiresAt: result.customerTokenExpiresAt || '',
        authorizedAt: new Date().toISOString()
      });
      wx.setStorageSync('geogi_customer_token', result.customerToken);
      if (result.customerTokenExpiresAt) {
        wx.setStorageSync('geogi_customer_token_expires_at', result.customerTokenExpiresAt);
      }
      this.setData({ phoneAuthorized: true, authError: '' });
      await this.loadOrders();
    } catch (error) {
      this.setData({ authError: error && error.message ? error.message : '手机号授权失败，请稍后再试' });
    } finally {
      this.setData({ authLoading: false });
    }
  },

  async loadOrders() {
    const localOrders = wx.getStorageSync('geogi_my_orders') || [];
    const lastSubmission = wx.getStorageSync('geogi_last_submission') || {};
    const clientId = wx.getStorageSync('geogi_client_id') || lastSubmission.clientId || (localOrders[0] && localOrders[0].clientId) || '';
    const normalizedLocal = localOrders.map((item) => this.normalizeOrder(item));

    this.setData({
      clientId,
      orders: normalizedLocal,
      notifications: this.buildLocalNotifications(normalizedLocal),
      error: ''
    });

    if (!isApiConfigured() || !getCustomerToken()) return;

    this.setData({ loading: true });
    try {
      let result = null;
      let orders = normalizedLocal;
      let notifications = this.buildLocalNotifications(normalizedLocal);
      let recoveredClientId = clientId || '';
      try {
        result = await get('/api/customer/projects', {});
        if (result && result.ok) {
          orders = (result.orders || []).map((item) => this.normalizeOrder(item));
          notifications = (result.notifications || []).map((item) => this.normalizeNotification(item));
          recoveredClientId = result.clientId || (orders[0] && orders[0].clientId) || recoveredClientId;
        }
      } catch (projectError) {
        if (!/没有找到该手机号名下的诊断记录/.test(String(projectError && projectError.message || ''))) {
          console.warn('customer projects unavailable', projectError);
        }
      }

      let channelDashboard = null;
      try {
        const channelResult = await get('/api/customer/channel-dashboard', {});
        if (channelResult && channelResult.ok && channelResult.isChannel) {
          channelDashboard = this.normalizeChannelDashboard(channelResult);
        }
      } catch (channelError) {
        console.warn('channel dashboard unavailable', channelError);
      }

      this.setData({
        clientId: recoveredClientId,
        orders,
        notifications,
        channelDashboard,
        phoneAuthorized: true,
        error: ''
      });

      wx.setStorageSync(
        'geogi_my_orders',
        orders
      );

      if (recoveredClientId) {
        wx.setStorageSync(
          'geogi_client_id',
          recoveredClientId
        );
      }
    } catch (error) {
      this.setData({
        error: '暂时无法同步最新状态，已显示本机保存的诊断记录。'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadOrders();
    } finally {
      wx.stopPullDownRefresh();
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
    if (/退款处理中/.test(value)) return '退款处理中';
    if (/部分退款/.test(value)) return '部分退款';
    if (/已退款/.test(value)) return '已退款';
    if (/付款确认/.test(value)) return '付款确认中';
    if (/待付款/.test(value)) return '待付款';
    if (/已兑换|优惠至免费/.test(value)) return '已优惠至免费';
    if (/已付款/.test(value)) return '已付款';
    if (/待补充|补充材料|资料不全/.test(value)) return '资料待补充';
    if (/审核|复核|初稿|质检/.test(value)) return '报告审核中';
    if (/处理中|检测|测试|分析|生成|品牌资料/.test(value)) return '诊断处理中';
    return '已提交';
  },

  normalizeChannelDashboard(data) {
    const result = data || {};
    return {
      ...result,
      channels: (result.channels || []).map((item) => {
        return {
          ...item,
          discountText: item.discountType === 'free'
            ? '本次诊断免费'
            : (Number(item.discountRateBps || 10000) >= 10000
              ? '标准价'
              : (Number(item.discountRateBps || 10000) / 1000).toFixed(1).replace(/\.0$/, '') + ' 折'),
          commissionText: Number(item.commissionRateBps || 0) > 0
            ? (Number(item.commissionRateBps || 0) / 100).toFixed(0) + '%'
            : '无返佣',
          startsAtText: this.formatDisplayTime(item.startsAt),
          endsAtText: this.formatDisplayTime(item.endsAt)
        };
      }),
      monthly: (result.monthly || []).map((item) => ({
        ...item,
        periodText: String(item.period || '').replace('-', '年') + '月'
      })),
      recentOrders: (result.recentOrders || []).map((item) => ({
        ...item,
        statusText: this.channelOrderStatusText(item.status),
        createdAtText: this.formatDisplayTime(item.createdAt)
      }))
    };
  },

  channelOrderStatusText(status) {
    return {
      unpaid: '待付款',
      paying: '付款确认中',
      paid: '已付款',
      free: '优惠免付',
      refund_processing: '退款处理中',
      partially_refunded: '部分退款',
      refunded: '已退款',
      closed: '已关闭'
    }[String(status || '')] || String(status || '—');
  },

  normalizeNotification(notification) {
    const item = notification || {};
    return {
      ...item,
      occurredAtText: this.formatDisplayTime(item.occurredAt)
    };
  },

  buildLocalNotifications(orders) {
    return (orders || []).flatMap((order) => {
      if (order.reportReady) {
        return [{
          id: 'local-report-' + order.projectId,
          type: 'report_ready',
          title: '诊断报告已完成',
          message: (order.brandName || '品牌') + ' 的品牌 GEO 诊断报告已完成，可直接查看。',
          actionText: '查看报告',
          projectId: order.projectId,
          clientId: order.clientId,
          occurredAtText: this.formatDisplayTime(order.completedAt || order.updatedAt)
        }];
      }
      if (order.paymentStatus === 'refunded') {
        return [{
          id: 'local-refund-' + order.projectId,
          type: 'refund_completed',
          title: '订单退款已完成',
          message: (order.brandName || '品牌') + ' 的诊断订单已退款。',
          actionText: '查看订单',
          projectId: order.projectId,
          clientId: order.clientId,
          occurredAtText: this.formatDisplayTime(order.updatedAt)
        }];
      }
      if (order.paymentStatus === 'refund_processing') {
        return [{
          id: 'local-refund-processing-' + order.projectId,
          type: 'refund_processing',
          title: '退款正在处理中',
          message: (order.brandName || '品牌') + ' 的退款申请已提交。',
          actionText: '查看订单',
          projectId: order.projectId,
          clientId: order.clientId,
          occurredAtText: this.formatDisplayTime(order.updatedAt)
        }];
      }
      return [];
    });
  },

  formatDisplayTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16);
    const pad = (number) => String(number).padStart(2, '0');
    return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') + ' ' +
      [pad(date.getHours()), pad(date.getMinutes())].join(':');
  },

  openNotification(event) {
    this.openReport(event);
  },

  goDiagnosis() {
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

  onShareAppMessage(event) {
    const dataset = event && event.target && event.target.dataset || {};
    const sourceToken = String(dataset.sourceToken || '');
    const channelName = String(dataset.channelName || '');
    if (!sourceToken) {
      return {
        title: 'GeoGi｜199 元品牌 GEO 诊断报告',
        path: '/pages/index/index'
      };
    }
    return {
      title: channelName ? channelName + ' 推荐｜GeoGi 品牌 GEO 诊断' : 'GeoGi 品牌 GEO 诊断',
      path: '/pages/index/index?src=' + encodeURIComponent(sourceToken)
    };
  },
});
