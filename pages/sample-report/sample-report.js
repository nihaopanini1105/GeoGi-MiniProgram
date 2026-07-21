Page({
  data: {
    dimensions: [
      { name: '品牌识别', score: '72', desc: 'AI 是否能正确识别品牌主体、业务和适用场景。' },
      { name: '主动推荐', score: '48', desc: '用户提出非品牌问题时，品牌是否进入推荐候选。' },
      { name: '信息准确', score: '66', desc: '回答中关于业务、优势、地域和联系方式是否准确。' },
      { name: '引用信源', score: '35', desc: '答案是否有可追溯、可信赖的外部来源支撑。' }
    ],
    outline: ['诊断摘要', '测试范围', '平台表现', '竞品对比', '问题证据', '优化建议']
  },

  goDiagnosis() {
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  }
});
