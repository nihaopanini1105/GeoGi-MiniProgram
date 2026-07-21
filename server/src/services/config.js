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
    services: [
      { key: 'quick-check', name: 'AI 可见度快检' },
      { key: 'diagnosis', name: 'GEO 全景诊断' },
      { key: 'subscription', name: '订阅优化' }
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
