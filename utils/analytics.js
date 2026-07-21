const { API_BASE_URL, isApiConfigured } = require('../config/api');

const sensitiveKeys = [
  'brandName',
  'brand_name',
  'companyName',
  'contactName',
  'contactMethod',
  'officialChannel',
  'offerings',
  'audiences',
  'message'
];

function track(eventName, params = {}) {
  if (!eventName) return;

  const safeParams = Object.keys(params).reduce((result, key) => {
    if (!sensitiveKeys.includes(key)) {
      result[key] = params[key];
    }
    return result;
  }, {});

  if (!isApiConfigured()) return;

  wx.request({
    url: `${API_BASE_URL}/api/events`,
    method: 'POST',
    data: {
      event: eventName,
      params: safeParams,
      occurredAt: new Date().toISOString(),
      source: 'wechat_miniprogram'
    },
    timeout: 3000
  });
}

module.exports = {
  track
};
