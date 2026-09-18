function getSampleReport() {
  return {
    ok: true,
    title: 'GeoGi GEO 报告结构示例',
    notice: '仅展示报告交付结构，不包含示例评分或诊断结论。正式客户报告全部由 GeoGi OS 生成并发布。',
    sections: [
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
  };
}

module.exports = {
  getSampleReport
};
