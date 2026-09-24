const { get } = require('./request');

const ATTRIBUTION_KEY = 'geogi_source_attribution';
const VISITOR_KEY = 'geogi_visitor_id';

function visitorId() {
  let value = String(wx.getStorageSync(VISITOR_KEY) || '').trim();
  if (!value) {
    value = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    wx.setStorageSync(VISITOR_KEY, value);
  }
  return value;
}

function decode(value) {
  try { return decodeURIComponent(String(value || '')); } catch (_error) { return String(value || ''); }
}

function tokenFromScene(scene) {
  const raw = decode(scene).trim();
  if (!raw) return '';
  if (raw.includes('=')) {
    const params = {};
    raw.split('&').forEach((pair) => {
      const index = pair.indexOf('=');
      if (index > 0) params[decode(pair.slice(0, index))] = decode(pair.slice(index + 1));
    });
    return String(params.src || params.source || '').trim();
  }
  return raw;
}

function tokenFromLaunch(options = {}) {
  const query = options.query || {};
  return String(query.src || query.source || tokenFromScene(query.scene || options.scene || '') || '').trim();
}

function getAttribution() {
  const value = wx.getStorageSync(ATTRIBUTION_KEY) || null;
  return value && value.validated === true ? value : null;
}

async function captureAttribution(options = {}) {
  const existing = getAttribution();
  if (existing) return existing;

  const token = tokenFromLaunch(options);
  if (!token) return null;

  try {
    const result = await get('/api/attribution/resolve', {
      token,
      visitorId: visitorId()
    });
    if (!result || result.ok !== true || result.applied !== true) return null;
    const attribution = {
      ...result,
      validated: true,
      capturedAt: new Date().toISOString()
    };
    wx.setStorageSync(ATTRIBUTION_KEY, attribution);
    return attribution;
  } catch (error) {
    console.warn('source attribution unavailable', error);
    return null;
  }
}

function clearAttributionAfterOrder() {
  wx.removeStorageSync(ATTRIBUTION_KEY);
}

module.exports = {
  ATTRIBUTION_KEY,
  VISITOR_KEY,
  visitorId,
  tokenFromLaunch,
  getAttribution,
  captureAttribution,
  clearAttributionAfterOrder
};
