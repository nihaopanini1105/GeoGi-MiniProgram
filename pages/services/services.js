Page({
  data: {
    services: [
      {
        label: '¥199',
        title: '品牌 GEO 诊断报告',
        desc: '品牌 GEO 诊断标准价 199 元。提交品牌资料并完成订单支付后，GeoGi 开始诊断并交付正式报告。',
        points: ['品牌企业画像与公开资料研究', '主流 AI 平台检测与竞品对比', '问题诊断与优先级结论', '正式 GEO 诊断报告'],
        included: true
      },
      {
        label: '诊断后可选',
        title: 'GEO 优化方案与实施',
        desc: '如需要根据诊断结果继续进行内容、信源和品牌信息优化，可单独沟通服务范围。',
        points: ['不包含在本次诊断报告中', '根据诊断结果确定实际工作范围'],
        included: false
      },
      {
        label: '诊断后可选',
        title: '持续监测与复测',
        desc: '如需要持续跟踪 AI 平台变化和优化效果，可在诊断完成后选择后续服务。',
        points: ['不包含在本次诊断报告中', '按后续服务方案单独确认'],
        included: false
      }
    ],
    process: ['提交品牌资料', '确认订单并支付', '品牌研究与 AI 检测', 'GEO 诊断', '报告审核与交付']
  },

  onShareAppMessage() {
    return {
      title: 'GeoGi｜199 元品牌 GEO 诊断报告',
      path: '/pages/services/services?from=share'
    };
  },

  onShareTimeline() {
    return {
      title: 'GeoGi｜199 元品牌 GEO 诊断报告',
      query: 'from=timeline'
    };
  }
});
