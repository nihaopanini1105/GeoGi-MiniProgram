const { get } = require('./request');

const ATTRIBUTION_KEY = 'geogi_source_attribution';
const PENDING_SOURCE_KEY = 'geogi_pending_source_token';
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
  return String(query.src || query.source || tokenFromScene(query.scene || '') || '').trim();
}

function getAttribution() {
  const value = wx.getStorageSync(ATTRIBUTION_KEY) || null;
  return value && value.validated === true ? value : null;
}

function persistAttribution(attribution) {
  if (!attribution) return null;
  wx.setStorageSync(ATTRIBUTION_KEY, attribution);
  wx.removeStorageSync(PENDING_SOURCE_KEY);
  return attribution;
}

function shouldReplaceAttribution(existing, candidate) {
  if (!candidate || candidate.validated !== true) return false;
  if (!existing || existing.validated !== true) return true;
  const existingLockedChannel = Boolean(existing.channelId && existing.channelBenefitActive);
  if (existingLockedChannel) return false;
  return Boolean(candidate.channelId && candidate.channelBenefitActive);
}

async function resolveToken(token, capturedAt = '', options = {}) {
  const result = await get('/api/attribution/resolve', {
    token,
    visitorId: visitorId()
  });
  if (!result || result.ok !== true || result.applied !== true) return null;
  const attribution = {
    ...result,
    validated: true,
    capturedAt: capturedAt || new Date().toISOString()
  };
  if (options.persist !== false) persistAttribution(attribution);
  return attribution;
}

async function captureAttribution(options = {}) {
  const existing = getAttribution();
  const launchToken = tokenFromLaunch(options);
  if (launchToken) wx.setStorageSync(PENDING_SOURCE_KEY, launchToken);

  const existingLockedChannel = Boolean(existing && existing.channelId && existing.channelBenefitActive);
  if (existingLockedChannel) {
    wx.removeStorageSync(PENDING_SOURCE_KEY);
    return existing;
  }

  const token = launchToken || (!existing ? String(wx.getStorageSync(PENDING_SOURCE_KEY) || '').trim() : '');
  if (!token) return existing || null;

  try {
    const candidate = await resolveToken(token, '', { persist: false });
    if (shouldReplaceAttribution(existing, candidate)) {
      return persistAttribution(candidate);
    }
    wx.removeStorageSync(PENDING_SOURCE_KEY);
    return existing || candidate || null;
  } catch (error) {
    console.warn('source attribution unavailable', error);
    return existing || null;
  }
}

async function refreshAttribution() {
  const existing = getAttribution();
  const token = existing && existing.sourceToken
    ? String(existing.sourceToken)
    : String(wx.getStorageSync(PENDING_SOURCE_KEY) || '').trim();
  if (!token) return existing || null;
  try {
    return await resolveToken(token, existing && existing.capturedAt || '');
  } catch (error) {
    console.warn('source attribution refresh unavailable', error);
    return existing || null;
  }
}

function clearAttributionAfterOrder() {
  wx.removeStorageSync(ATTRIBUTION_KEY);
  wx.removeStorageSync(PENDING_SOURCE_KEY);
}

module.exports = {
  ATTRIBUTION_KEY,
  PENDING_SOURCE_KEY,
  VISITOR_KEY,
  visitorId,
  tokenFromLaunch,
  getAttribution,
  shouldReplaceAttribution,
  captureAttribution,
  refreshAttribution,
  clearAttributionAfterOrder
};
