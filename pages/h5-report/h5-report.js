const { API_BASE_URL } = require('../../config/api');
Page({
  data: { src: '', invalid: false },
  onLoad(options) {
    const candidate = decodeURIComponent(String(options.src || ''));
    const prefix = API_BASE_URL.replace(/\/+$/, '') + '/api/customer/h5-reader/';
    if (!candidate.startsWith(prefix) || !/^[0-9a-f]{64}$/.test(candidate.slice(prefix.length))) {
      this.setData({ invalid: true });
      return;
    }
    this.setData({ src: candidate });
  }
});
