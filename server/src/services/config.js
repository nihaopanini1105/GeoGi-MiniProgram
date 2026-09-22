const { paymentConfiguration } = require('./wechat-pay');

function getConfig() {
  return {
    ok: true,
    platforms: [
      { key: 'doubao', name: '豆包', enabled: true },
      { key: 'yuanbao', name: '元宝', enabled: true },
      { key: 'qianwen', name: '千问', enabled: true },
      { key: 'deepseek', name: 'DeepSeek', enabled: true },
      { key: 'kimi', name: 'Kimi', enabled: true }
    ],
    diagnosticProduct: {
      code: 'GEOGI_DIAGNOSTIC_REPORT_199',
      name: 'GeoGi 品牌 GEO 诊断报告',
      priceFen: 19900,
      priceYuan: '199.00',
      currency: 'CNY',
      paymentMethod: '微信支付',
      paymentReady: paymentConfiguration().configured
    },
    services: [
      { key: 'diagnostic-report-199', name: '品牌 GEO 诊断报告', priceYuan: '199.00' },
      { key: 'optimization', name: 'GEO 优化服务', includedInDiagnosticReport: false }
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
