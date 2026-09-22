Page({
  data: {
    services: [
      {
        label: '¥199',
        title: '品牌 GEO 诊断报告',
        desc: '提交品牌资料并支付 199 元，获取品牌企业研究、主流 AI 平台检测与正式 GEO 诊断报告。',
        points: ['品牌是否被正确识别和推荐', '竞品在关键场景中的表现', '品牌信息、内容与信源缺口', '优化优先级建议']
      },
      {
        label: '报告交付',
        title: '199 元服务包含内容',
        desc: '诊断报告基于客户资料、公开研究和实际 AI 平台检测结果形成。',
        points: ['品牌企业画像', 'AI 平台检测结果', '问题与竞争差距', '优化优先级建议']
      },
      {
        label: '后续服务',
        title: 'GEO 优化服务',
        desc: '如需根据诊断结果继续实施内容、信源或品牌信息优化，可单独沟通后续服务。',
        points: ['不包含在 199 元诊断报告内', '按实际问题制定方案', '按服务范围单独确认']
      },
      {
        label: '持续服务',
        title: '持续监测与复测',
        desc: '如需长期跟踪品牌在 AI 平台中的变化，可在诊断报告之外单独确认持续服务。',
        points: ['不包含在 199 元诊断报告内', '周期监测', '效果复测']
      }
    ],
    process: ['提交品牌资料', '支付 199 元', '执行 AI 检测', '完成 GEO 诊断', '交付正式报告']
  },

  onShareAppMessage() {
    return {
      title: 'GeoGi｜199元品牌 GEO 诊断报告',
      path: '/pages/services/services?from=share'
    };
  },

  onShareTimeline() {
    return {
      title: 'GeoGi｜199元品牌 GEO 诊断报告',
      query: 'from=timeline'
    };
  }

});
