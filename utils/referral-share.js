const { get, getCustomerToken, isApiConfigured } = require('./request');

// Referrer identity comes from the signed-in server-side source dashboard.
// Never derive a referrer token from text entered by the customer.
function selectShareSource(dashboard = {}) {
  const sources = Array.isArray(dashboard.ownedSources) ? dashboard.ownedSources : [];
  const channels = Array.isArray(dashboard.channels) ? dashboard.channels : [];
  const card = dashboard.isSourceOwner
    ? sources.find((source) => source.sourceType === 'business_card' && source.active === true && source.token)
    : null;
  const channel = dashboard.isChannel
    ? channels.find((item) => item.active === true && item.shareSourceToken)
    : null;
  return {
    token: String(card && card.token || channel && channel.shareSourceToken || ''),
    name: String(card && card.name || channel && channel.name || ''),
    type: card ? 'business_card' : channel ? 'channel' : ''
  };
}

async function loadReferralShareContext() {
  if (!isApiConfigured() || !getCustomerToken()) return { token: '', name: '', type: '' };
  try {
    const result = await get('/api/customer/channel-dashboard', {});
    if (!result || result.ok !== true) return { token: '', name: '', type: '' };
    return selectShareSource(result);
  } catch (_error) {
    return { token: '', name: '', type: '' };
  }
}

function withSourceQuery(query = '', token = '') {
  const base = String(query || '');
  const source = String(token || '').trim();
  return source ? base + (base ? '&' : '') + 'src=' + encodeURIComponent(source) : base;
}

module.exports = { selectShareSource, loadReferralShareContext, withSourceQuery };
