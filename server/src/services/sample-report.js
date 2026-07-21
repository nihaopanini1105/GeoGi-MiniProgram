function getSampleReport() {
  return {
    ok: true,
    title: 'GeoGi 诊断报告示例',
    notice: '示例不代表实际诊断结果，正式报告会结合客户资料与人工复核输出。',
    sections: [
      '诊断摘要',
      '测试范围',
      '平台表现',
      '竞品对比',
      '问题证据',
      '优化建议'
    ]
  };
}

module.exports = {
  getSampleReport
};
