const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function run() {
  for (const file of [
    'pages/diagnosis/diagnosis.wxml',
    'pages/diagnosis/diagnosis.wxss',
    'pages/mine/mine.wxml',
    'pages/submit-success/submit-success.wxml',
    'pages/report-detail/report-detail.wxml'
  ]) {
    const contents = read(file);
    assert(!/兑换码|兑换券|redemption|redeemCode|CODE REDEEMED/i.test(contents),
      file + ' must contain no legacy manual redemption UI');
  }
  const diagnosisJs = read('pages/diagnosis/diagnosis.js');
  const mineJs = read('pages/mine/mine.js');
  const homeJs = read('pages/index/index.js');
  const serverJs = read('server/src/server.js');
  assert(!/verifyRedemptionCode|updateRedemptionCode|redemptionQuote|redemptionLoading/.test(diagnosisJs));
  assert(!diagnosisJs.includes('/api/redeem-codes/quote'));
  assert(!serverJs.includes('/api/redeem-codes/'));
  assert(!mineJs.includes('item.redeemCode'));
  assert(mineJs.includes('channelResult.hasPromotionAccess'),
    'verified business-card owners must see their referral dashboard');
  assert(diagnosisJs.includes('sourceToken: attribution && attribution.sourceToken'),
    'intake must keep source-based attribution rather than an entered code');
  const shareUtility = read('utils/referral-share.js');
  assert(shareUtility.includes("source.sourceType === 'business_card'"),
    "shares should prefer the verified owner personal business card");
  for (const file of [
    'pages/services/services.js',
    'pages/research/research.js',
    'pages/research-detail/research-detail.js'
  ]) {
    const source = read(file);
    assert(source.includes('loadReferralShareContext'),
      file + ' must load verified owner share context');
    assert(source.includes('withSourceQuery'),
      file + ' must carry source token in a WeChat share');
  }

  const originalPage = global.Page;
  const originalWx = global.wx;
  const request = require('../../utils/request');
  const originalGet = request.get;
  try {
    global.wx = { getStorageSync: (key) => key === 'geogi_customer_token' ? 'test-session' : '' };
    let dashboard = {};
    request.get = async () => dashboard;
    let page = null;
    global.Page = (definition) => { page = definition; };

    delete require.cache[require.resolve('../../pages/diagnosis/diagnosis.js')];
    require('../../pages/diagnosis/diagnosis.js');
    assert(page && typeof page.normalizeForm === 'function');
    const migrated = page.normalizeForm({
      brandName: 'preserved',
      redemptionCode: 'LEGACY-NEVER-APPLY',
      redeemCode: 'LEGACY-NEVER-APPLY',
      targetMarket: ['CN']
    });
    assert.strictEqual(migrated.brandName, 'preserved');
    assert.deepStrictEqual(migrated.targetMarket, ['CN']);
    assert(!Object.prototype.hasOwnProperty.call(migrated, 'redemptionCode'));
    assert(!Object.prototype.hasOwnProperty.call(migrated, 'redeemCode'));

    delete require.cache[require.resolve('../../pages/mine/mine.js')];
    require('../../pages/mine/mine.js');
    assert(page && typeof page.onShareAppMessage === 'function');
    const cardShare = page.onShareAppMessage({
      target: { dataset: { sourceToken: 'personal-card-token', channelName: '专属名片' } }
    });
    assert.strictEqual(cardShare.path, '/pages/index/index?src=personal-card-token');

    page.data.channelDashboard = {
      isSourceOwner: true, isChannel: false,
      ownedSources: [{ sourceType: 'business_card', active: true, token: 'my-card', name: '本人名片' }],
      channels: []
    };
    assert.strictEqual(page.onShareAppMessage({ target: { dataset: {} } }).path,
      '/pages/index/index?src=my-card', "default Mine share must contain the owner source");


    delete require.cache[require.resolve('../../pages/index/index.js')];
    require('../../pages/index/index.js');
    const home = page;
    const context = {
      data: { referralShareToken: '', referralShareName: '' },
      setData(values) { Object.assign(this.data, values); },
      safeTrack() {}
    };
    dashboard = {
      ok: true,
      isChannel: true,
      isSourceOwner: true,
      ownedSources: [{ active: true, sourceType: 'business_card', token: 'personal-card-token', name: '专属名片' }],
      channels: [{ active: true, shareSourceToken: 'free-channel-token', name: '免费渠道' }]
    };
    await home.loadChannelShareContext.call(context);
    assert.strictEqual(context.data.referralShareToken, 'personal-card-token');
    assert.strictEqual(home.onShareAppMessage.call(context).path,
      '/pages/index/index?src=personal-card-token');

    dashboard = {
      ok: true,
      isChannel: false,
      isSourceOwner: true,
      ownedSources: [{ active: true, sourceType: 'business_card', token: 'second-card-token', name: '另一张名片' }],
      channels: []
    };
    await home.loadChannelShareContext.call(context);
    assert.strictEqual(context.data.referralShareToken, 'second-card-token',
      'owner with no commission channel must still share their own referral');

    dashboard = {
      ok: true,
      isChannel: true,
      isSourceOwner: false,
      ownedSources: [],
      channels: [{ active: true, shareSourceToken: 'channel-only-token', name: '渠道' }]
    };
    await home.loadChannelShareContext.call(context);
    assert.strictEqual(context.data.referralShareToken, 'channel-only-token');

    dashboard = { ok: true, isChannel: false, isSourceOwner: false, ownedSources: [], channels: [] };
    await home.loadChannelShareContext.call(context);
    assert.strictEqual(context.data.referralShareToken, '');
    assert.strictEqual(home.onShareAppMessage.call(context).path, '/pages/index/index');

    delete require.cache[require.resolve('../../pages/services/services.js')];
    require('../../pages/services/services.js');
    assert.strictEqual(page.onShareAppMessage.call({ data: { referralShareToken: 'personal-card-token' } }).path,
      '/pages/services/services?from=share&src=personal-card-token');

    delete require.cache[require.resolve('../../pages/research-detail/research-detail.js')];
    require('../../pages/research-detail/research-detail.js');
    const article = page.onShareAppMessage.call({
      data: { shareTitle: 'Article', referralShareToken: 'personal-card-token' },
      articleId: 'geo-topic'
    });
    assert(article.path.includes('id=geo-topic'));
    assert(article.path.includes('src=personal-card-token'));
  } finally {
    request.get = originalGet;
    global.Page = originalPage;
    global.wx = originalWx;
  }
  console.log('referral-source-no-voucher-regression-ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
