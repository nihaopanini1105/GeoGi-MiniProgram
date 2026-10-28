const { API_BASE_URL } = require('../../config/api');
Page({
  data: { src: '', invalid: false },
  onLoad(options) {
    const candidate = decodeURIComponent(String(options.src || ''));
    const root = API_BASE_URL.replace(/\/+$/, '');
    const prefixes = [root + '/api/customer/h5-reader/',
      root + '/api/customer/report-v21/h5-reader/',
      root + '/api/customer/report-r03/h5-reader/'];
    const valid = prefixes.some(prefix => candidate.startsWith(prefix) &&
      /^[0-9a-f]{64}$/.test(candidate.slice(prefix.length)));
    if (!valid) {
      this.setData({ invalid: true });
      return;
    }
    this.setData({ src: candidate });
  }
});
