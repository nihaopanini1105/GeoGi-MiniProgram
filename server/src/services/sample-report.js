function getSampleReport() {
  return {
    ok: true,
    title: 'GeoGi 199 元品牌 GEO 诊断报告结构示例',
    notice: '本页仅展示 199 元品牌 GEO 诊断报告的结构，不包含虚构评分或示例诊断结论。客户付款后，正式报告由 GeoGi OS 基于真实证据生成、审核并发布。',
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
