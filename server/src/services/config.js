function getConfig() {
  return {
    ok: true,
    diagnosticProduct: {
      code: 'diagnostic_report_199',
      name: 'GeoGi 品牌 GEO 诊断报告',
      priceYuan: 199,
      amountTotal: 19900,
      currency: 'CNY',
      paymentRequiredBeforeProcessing: true,
      includes: [
        '品牌企业画像与公开资料研究',
        '中国主流 AI 平台检测',
        '竞品与问题诊断',
        '正式 GEO 诊断报告'
      ],
      excludes: [
        'GEO 优化实施',
        '持续监测与复测'
      ]
    },
    platforms: [
      { key: 'doubao', name: '豆包', enabled: true },
      { key: 'yuanbao', name: '元宝', enabled: true },
      { key: 'qianwen', name: '千问', enabled: true },
      { key: 'deepseek', name: 'DeepSeek', enabled: true },
      { key: 'kimi', name: 'Kimi', enabled: true }
    ],
    services: [
      {
        key: 'diagnostic-report-199',
        name: '¥199 品牌 GEO 诊断报告',
        priceYuan: 199,
        included: true
      },
      {
        key: 'optimization',
        name: '诊断后可选：GEO 优化实施',
        included: false
      },
      {
        key: 'monitoring',
        name: '诊断后可选：持续监测与复测',
        included: false
      }
    ],
    contact: {
      wechatId: process.env.CONTACT_WECHAT_ID || '',
      workHours: process.env.CONTACT_WORK_HOURS || '工作日 10:00-19:00'
    }
  };
}

module.exports = {
  getConfig
};
