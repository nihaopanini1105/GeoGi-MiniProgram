const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(file, request) {
  let definition;
  const storage = {};
  const context = {
    Page: (value) => { definition = value; },
    wx: { getStorageSync: (key) => storage[key], setStorageSync: (key, value) => { storage[key] = value; } },
    require: (name) => name.includes('request') ? request : name.includes('referral-share')
      ? { loadReferralShareContext: async () => ({ token: '' }), withSourceQuery: (query) => query }
      : { homeShare: () => ({}) },
    console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), context);
  return { ...definition, data: { ...definition.data }, setData(update) { Object.assign(this.data, update); } };
}

async function run() {
  let token = 'owner';
  let dashboard = { ok: true, hasPromotionAccess: true, isSourceOwner: true, ownedSources: [], channels: [] };
  const mine = page('pages/mine/mine.js', {
    getCustomerToken: () => token, isApiConfigured: () => true,
    get: async (url) => url.includes('channel-dashboard') ? dashboard : { ok: true, orders: [], notifications: [] }
  });
  const choose = (section) => mine.switchSection({ currentTarget: { dataset: { section } } });
  choose('promotion');
  assert.equal(mine.data.activeSection, 'orders', 'ordinary customer cannot select promotion');
  await mine.loadOrders();
  choose('promotion');
  assert.equal(mine.data.activeSection, 'promotion', 'source owner can view promotion without a commission channel');
  choose('orders');
  assert.equal(mine.data.activeSection, 'orders');
  dashboard = { ok: true, hasPromotionAccess: true, isChannel: true, channels: [] };
  await mine.loadOrders();
  choose('promotion');
  assert.equal(mine.data.activeSection, 'promotion', 'channel owner can view promotion');
  dashboard = { ok: true, hasPromotionAccess: false };
  await mine.loadOrders();
  assert.equal(mine.data.activeSection, 'orders', 'permission revocation resets selected section');
  assert.equal(mine.data.channelDashboard, null);
  mine.data.channelDashboard = { hasPromotionAccess: true };
  mine.data.activeSection = 'promotion';
  token = '';
  await mine.loadOrders();
  assert.equal(mine.data.channelDashboard, null, 'logout clears stale promotion data');
  assert.equal(mine.data.activeSection, 'orders');

  let shouldFail = true;
  const detail = page('pages/research-detail/research-detail.js', {
    get: async (url) => {
      assert.equal(url, '/api/articles/geo-topic');
      if (shouldFail) throw new Error('offline');
      return { ok: true, article: { title: 'Official article', body: '<p>Full content</p>' } };
    }
  });
  await detail.onLoad({ id: 'geo-topic' });
  assert(detail.data.error);
  assert.equal(detail.data.loading, false);
  shouldFail = false;
  await detail.loadArticle();
  assert.equal(detail.data.error, '');
  assert.equal(detail.data.article.body, '<p>Full content</p>');
  assert.equal(detail.data.shareTitle, 'Official article');

  const originalFetch = global.fetch;
  const { getResearchArticle } = require('../src/services/research');
  const requests = [];
  const registry = { items: [
    { slug: 'geo-topic', status: 'published', title: 'Topic', canonical_path: '/insights/geo-topic/' },
    { slug: 'draft-topic', status: 'draft', title: 'Draft', canonical_path: '/insights/draft-topic/' }
  ] };
  global.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith('/data/research-index.json')) return { ok: true, json: async () => registry };
    if (url.startsWith('https://www.geogi.cn')) return { ok: false, status: 404 };
    return { ok: true, text: async () => '<nav>NOT ARTICLE</nav><article class="article-content"><h2>Full article</h2><p onclick="alert(1)">' +
      'Official body with enough text to confirm this is content rather than an empty page.' +
      '</p><script>EVIL_SCRIPT</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">Source</a></article><footer>NOT ARTICLE</footer>' };
  };
  try {
    const result = await getResearchArticle('geo-topic');
    assert.equal(result.ok, true);
    assert(result.article.body.includes('Official body'));
    for (const forbidden of ['NOT ARTICLE', 'onclick', 'javascript:', 'EVIL_SCRIPT', 'iframe']) {
      assert(!result.article.body.includes(forbidden), forbidden);
    }
    assert(requests.some((url) => url.endsWith('/insights/geo-topic/index.html')), 'falls back to official repository');
    const before = requests.length;
    assert.equal((await getResearchArticle('../../private')).ok, false);
    assert.equal(requests.length, before, 'invalid IDs never trigger upstream fetch');
    assert.equal((await getResearchArticle('draft-topic')).ok, false, 'draft content stays private');
    global.fetch = async (url) => url.endsWith('.json') ? { ok: true, json: async () => registry }
      : { ok: true, text: async () => '<html>upstream error page</html>' };
    assert.equal((await getResearchArticle('geo-topic')).ok, false, 'upstream error page must not become a successful empty article');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('customer-sections-research-regression-ok');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
