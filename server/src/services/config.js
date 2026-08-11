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
      { key: 'diagnosis', name: 'GEO诊断' },
      { key: 'plan', name: 'GEO优化方案' },
      { key: 'execution', name: 'GEO优化执行' }
    ],
    contact: {
      email: 'geogi@geogi.cn',
      website: 'www.geogi.cn'
    }
  };
}

module.exports = {
  getConfig
};
