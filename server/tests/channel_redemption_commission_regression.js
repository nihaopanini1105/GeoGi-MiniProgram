const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function expectCode(promise, code) {
  let error = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert(error, 'expected error ' + code);
  assert.strictEqual(error.code || error.message, code);
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-channel-source-regression-'));
  process.env.GEOGI_CHANNEL_DATA_ROOT = path.join(root, 'channels');
  process.env.GEOGI_PAYMENT_DATA_ROOT = path.join(root, 'payments');

  const {
    upsertChannel,
    upsertSource,
    resolveSourceToken,
    quoteRedeemCode,
    ensureDefaultOfficialSources,
    ensureOfficialDistributionSources,
    reconcileCommission,
    settleChannelPeriod,
    listCommissionRecords
  } = require('../src/services/channel-store');
  const {
    createOrGetPaymentOrder,
    updatePaymentOrder,
    findPaymentByProject,
    markProjectReportReleased
  } = require('../src/services/payment-store');
  const {
    channelDashboardForPhone,
    channelAdminDashboard,
    sourceCodeFileName,
    sourceCodeAliasForSource,
    sourceCodePublicUrl
  } = require('../src/services/channel-service');

  const officialSources = await ensureDefaultOfficialSources();
  assert.strictEqual(officialSources.length, 3);
  const distributionSources = await ensureOfficialDistributionSources();
  assert.strictEqual(distributionSources.website.sourceType, 'website');
  assert.strictEqual(distributionSources.officialAccount.sourceType, 'official_account');
  assert.strictEqual(distributionSources.liaoHuafengBusinessCard.name, 'GeoGi · 廖华锋名片');
  assert.strictEqual(distributionSources.liShashaBusinessCard.name, 'GeoGi · 李沙沙名片');

  const websiteSource = await resolveSourceToken(
    officialSources.find((item) => item.sourceType === 'website').token,
    new Date('2026-09-24T00:00:00Z')
  );
  assert.strictEqual(websiteSource.sourceType, 'website');
  assert.strictEqual(websiteSource.payableFen, 19900);
  assert.strictEqual(websiteSource.discountFen, 0);
  assert.strictEqual(websiteSource.commissionRateBps, 0);

  const channelA = await upsertChannel({
    name: 'A 渠道',
    redeemCode: 'A80',
    discountType: 'percent',
    discountRateBps: 8000,
    commissionRateBps: 1000,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-10-31T23:59:59Z',
    ownerPhones: ['13800138000']
  });
  assert.strictEqual(channelA.redeemCode, 'A80');
  assert(channelA.shareSource);

  const sourceA = await resolveSourceToken(channelA.shareSource.token, new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(sourceA.channelId, channelA.channelId);
  assert.strictEqual(sourceA.payableFen, 19900, 'channel source must not automatically discount');
  assert.strictEqual(sourceA.discountFen, 0);
  assert.strictEqual(sourceA.commissionRateBps, 0);

  const aQuote = await quoteRedeemCode('a80', new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(aQuote.redeemCode, 'A80');
  assert.strictEqual(aQuote.channelId, channelA.channelId);
  assert.strictEqual(aQuote.payableFen, 15920);
  assert.strictEqual(aQuote.discountFen, 3980);
  assert.strictEqual(aQuote.commissionRateBps, 1000);

  const aOrderResult = await createOrGetPaymentOrder({
    clientId: 'GG-A-1',
    projectId: 'GG-P-A-1',
    submissionId: 'SUB-A-1',
    brandName: 'A 渠道客户',
    phoneNumber: '13600000001',
    amountTotal: aQuote.payableFen,
    sourceId: sourceA.sourceId,
    sourceToken: sourceA.sourceToken,
    sourceName: sourceA.sourceName,
    sourceType: sourceA.sourceType,
    sourceCapturedAt: '2026-09-24T00:00:00Z',
    channelId: aQuote.channelId,
    channelName: aQuote.channelName,
    redeemCode: aQuote.redeemCode,
    discountType: aQuote.discountType,
    discountRateBps: aQuote.discountRateBps,
    commissionRateBps: aQuote.commissionRateBps
  });
  assert.strictEqual(aOrderResult.order.amountTotal, 15920);
  assert.strictEqual(aOrderResult.order.redeemCode, 'A80');
  assert.strictEqual(aOrderResult.order.sourceId, sourceA.sourceId);

  await upsertChannel({
    channelId: channelA.channelId,
    name: 'A 渠道',
    redeemCode: 'A80',
    discountType: 'percent',
    discountRateBps: 5000,
    commissionRateBps: 1200,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-12-31T23:59:59Z',
    ownerPhones: ['13800138000']
  });

  const laterSourceA = await resolveSourceToken(channelA.shareSource.token, new Date('2026-11-01T00:00:00Z'));
  assert.strictEqual(laterSourceA.payableFen, 19900, 'source still must not grant pricing after rule change');
  const laterQuoteA = await quoteRedeemCode('A80', new Date('2026-11-01T00:00:00Z'));
  assert.strictEqual(laterQuoteA.payableFen, 9950);
  assert.strictEqual(laterQuoteA.commissionRateBps, 1200);

  const historicalOrder = await findPaymentByProject('GG-P-A-1');
  assert.strictEqual(historicalOrder.amountTotal, 15920);
  assert.strictEqual(historicalOrder.commissionRateBps, 1000);
  assert.strictEqual(historicalOrder.redeemCode, 'A80');

  let paidOrder = await updatePaymentOrder(aOrderResult.order.outTradeNo, {
    status: 'paid',
    paidAt: '2026-09-24T01:00:00Z',
    refundableAmount: 15920
  });
  assert.strictEqual(await reconcileCommission({ order: paidOrder }), null, 'payment alone must not accrue commission');

  paidOrder = await markProjectReportReleased('GG-P-A-1', '2026-09-25T02:00:00Z');
  const commission = await reconcileCommission({ order: paidOrder });
  assert.strictEqual(commission.earnedFen, 1592);
  assert.strictEqual(commission.dueFen, 1592);
  assert.strictEqual(commission.period, '2026-09');

  const dashboardA = await channelDashboardForPhone('13800138000');
  assert.strictEqual(dashboardA.isChannel, true);
  assert.strictEqual(dashboardA.channels.length, 1);
  assert.strictEqual(dashboardA.channels[0].shareSourceToken, channelA.shareSource.token);
  assert.strictEqual(dashboardA.channels[0].pendingCommissionYuan, 15.92);

  const settled = await settleChannelPeriod({
    channelId: channelA.channelId,
    period: '2026-09',
    operatorId: 'finance-test',
    payoutReference: 'BANK-202609-A'
  });
  assert.strictEqual(settled.payoutFen, 1592);

  const refundedOrder = await updatePaymentOrder(aOrderResult.order.outTradeNo, {
    status: 'refunded',
    refundedAmount: 15920,
    refundableAmount: 0
  });
  const adjusted = await reconcileCommission({ order: refundedOrder });
  assert.strictEqual(adjusted.earnedFen, 0);
  assert.strictEqual(adjusted.payoutFen, 1592);
  assert.strictEqual(adjusted.overpaidFen, 1592);
  assert.strictEqual(adjusted.payoutStatus, 'adjustment_required');

  const channelB = await upsertChannel({
    name: 'B 渠道',
    redeemCode: 'BFREE',
    discountType: 'free',
    discountRateBps: 0,
    commissionRateBps: 0,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-12-31T23:59:59Z',
    ownerPhones: ['13900139000']
  });
  const sourceB = await resolveSourceToken(channelB.shareSource.token, new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(sourceB.payableFen, 19900);
  const bQuote = await quoteRedeemCode('bfree', new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(bQuote.payableFen, 0);
  assert.strictEqual(bQuote.discountFen, 19900);

  const bOrderResult = await createOrGetPaymentOrder({
    clientId: 'GG-B-1',
    projectId: 'GG-P-B-1',
    submissionId: 'SUB-B-1',
    brandName: 'B 渠道客户',
    phoneNumber: '13600000002',
    amountTotal: bQuote.payableFen,
    sourceId: sourceB.sourceId,
    sourceToken: sourceB.sourceToken,
    sourceName: sourceB.sourceName,
    sourceType: sourceB.sourceType,
    channelId: bQuote.channelId,
    channelName: bQuote.channelName,
    redeemCode: bQuote.redeemCode,
    discountType: bQuote.discountType,
    discountRateBps: bQuote.discountRateBps,
    commissionRateBps: bQuote.commissionRateBps
  });
  assert.strictEqual(bOrderResult.order.status, 'free');
  assert.strictEqual(bOrderResult.order.redeemCode, 'BFREE');
  const bReleased = await markProjectReportReleased('GG-P-B-1', '2026-09-26T02:00:00Z');
  const bCommission = await reconcileCommission({ order: bReleased });
  assert.strictEqual(bCommission.earnedFen, 0);
  assert.strictEqual(bCommission.payoutStatus, 'not_applicable');

  const partnerCard = await upsertSource({
    name: 'A 渠道商务名片',
    sourceType: 'business_card',
    channelId: channelA.channelId,
    active: true
  });
  const partnerCardSource = await resolveSourceToken(partnerCard.token, new Date('2026-11-01T00:00:00Z'));
  assert.strictEqual(partnerCardSource.channelId, channelA.channelId);
  assert.strictEqual(partnerCardSource.payableFen, 19900, 'partner card source must not activate discount');

  await expectCode(quoteRedeemCode('NOTFOUND'), 'REDEEM_CODE_NOT_FOUND');
  await expectCode(
    upsertChannel({
      name: '重复码渠道',
      redeemCode: 'A80',
      discountType: 'percent',
      discountRateBps: 9000,
      commissionRateBps: 0,
      active: true
    }),
    'CHANNEL_REDEEM_CODE_DUPLICATE'
  );
  await expectCode(
    upsertChannel({
      name: '缺少兑换码渠道',
      discountType: 'percent',
      discountRateBps: 8000,
      commissionRateBps: 0,
      active: true
    }),
    'CHANNEL_REDEEM_CODE_REQUIRED'
  );

  const expired = await upsertChannel({
    name: '过期渠道',
    redeemCode: 'OLD80',
    discountType: 'percent',
    discountRateBps: 8000,
    commissionRateBps: 0,
    active: true,
    endsAt: '2026-09-01T00:00:00Z'
  });
  assert(expired.channelId);
  await expectCode(quoteRedeemCode('OLD80', new Date('2026-09-24T00:00:00Z')), 'REDEEM_CODE_EXPIRED');

  assert.strictEqual(sourceCodeFileName(distributionSources.website, 'official-website'), 'official-website.png');
  assert.strictEqual(sourceCodeAliasForSource(distributionSources.website), 'official-website');
  assert.strictEqual(
    sourceCodePublicUrl('business-card-lishasha.png'),
    'https://api.geogi.cn/api/source-codes/business-card-lishasha.png'
  );

  const admin = await channelAdminDashboard();
  assert.strictEqual(admin.channels.length, 3);
  assert(admin.channels.some((row) => row.redeemCode === 'A80'));
  assert(admin.sources.some((row) => row.sourceType === 'website'));
  assert(admin.orders.some((row) => row.redeemCode === 'A80'));
  assert(admin.orders.some((row) => row.redeemCode === 'BFREE'));

  const records = await listCommissionRecords();
  assert.strictEqual(records.length, 2);

  const { shouldReplaceAttribution } = require('../../utils/attribution');
  const officialAttribution = {
    validated: true,
    sourceId: 'source_official_website',
    sourceType: 'website',
    channelId: ''
  };
  const channelAttribution = {
    validated: true,
    sourceId: 'source_channel_a',
    sourceType: 'channel',
    channelId: 'channel_a'
  };
  const channelBAttribution = {
    validated: true,
    sourceId: 'source_channel_b',
    sourceType: 'channel',
    channelId: 'channel_b'
  };
  assert.strictEqual(shouldReplaceAttribution(null, officialAttribution), true);
  assert.strictEqual(shouldReplaceAttribution(officialAttribution, channelAttribution), true);
  assert.strictEqual(shouldReplaceAttribution(channelAttribution, officialAttribution), false);
  assert.strictEqual(shouldReplaceAttribution(channelAttribution, channelBAttribution), false);

  const diagnosisCopy = fs.readFileSync(path.join(__dirname, '../../pages/diagnosis/diagnosis.wxml'), 'utf8');
  const introCopy = diagnosisCopy.split('<block wx:else>')[0];
  assert(!introCopy.includes('渠道优惠'));
  assert(!introCopy.includes('兑换码'));
  assert(diagnosisCopy.includes('兑换码'));
  assert(diagnosisCopy.includes('如有兑换码，请在支付前填写'));
  assert(diagnosisCopy.includes('兑换码已生效'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('channel-source-redeem-commission-regression-ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
