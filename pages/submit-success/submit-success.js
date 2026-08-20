Page({
  data: {
    submission: {},
    submittedAtText: '',
    nextSteps: [
      {
        title: '建立品牌画像',
        desc: '整理品牌基础信息、业务定位和客户场景。'
      },
      {
        title: '设计行业 AI 问题集',
        desc: '结合行业和细分领域构建诊断问题。'
      },
      {
        title: '检测中国主流 AI 平台表现',
        desc: '分析品牌识别、推荐和信息准确情况。'
      },
      {
        title: '生成 GEO 诊断报告',
        desc: '完成审核后进入报告中心查看。'
      }
    ]
  },

  onShow() {
    const submission = wx.getStorageSync('geogi_last_submission') || {};
    this.setData({
      submission,
      submittedAtText: this.formatDate(submission.submittedAt)
    });
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
