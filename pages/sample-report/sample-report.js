Page({
  data: {
    outline: [
      '执行摘要',
      '检测范围与样本质量',
      'GEO 多维诊断',
      'AI 平台表现',
      '用户问题与决策场景',
      '引用与信源结构',
      '竞品表现与决策竞争',
      '核心问题与根因',
      'GEO 优化机会',
      '优先优化建议',
      '证据与原始回答附录'
    ]
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.navigateTo({ url: '/pages/diagnosis/diagnosis?start=1' });
  }
});
