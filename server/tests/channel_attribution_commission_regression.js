const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-channel-attribution-regression-'));
  process.env.GEOGI_CHANNEL_DATA_ROOT = path.join(root, 'channels');
  process.env.GEOGI_PAYMENT_DATA_ROOT = path.join(root, 'payments');

  const {
    upsertChannel,
    upsertSource,
    resolveSourceToken,
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
    distributionSources.website.token,
    new Date('2026-09-24T00:00:00Z')
  );
  assert.strictEqual(websiteSource.sourceType, 'website');
  assert.strictEqual(websiteSource.channelBenefitActive, false);
  assert.strictEqual(websiteSource.payableFen, 19900);
  assert.strictEqual(websiteSource.discountFen, 0);
  assert.strictEqual(websiteSource.commissionRateBps, 0);

  const channelA = await upsertChannel({
    name: 'A 渠道',
    discountType: 'percent',
    discountRateBps: 8000,
    commissionRateBps: 1000,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-10-31T23:59:59Z',
    ownerPhones: ['13800138000']
  });
  assert(channelA.shareSource);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(channelA, 'redeemCode'), false);

  const sourceA = await resolveSourceToken(channelA.shareSource.token, new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(sourceA.channelId, channelA.channelId);
  assert.strictEqual(sourceA.channelBenefitActive, true);
  assert.strictEqual(sourceA.payableFen, 15920);
  assert.strictEqual(sourceA.discountFen, 3980);
  assert.strictEqual(sourceA.commissionRateBps, 1000);

  const aOrderResult = await createOrGetPaymentOrder({
    clientId: 'GG-A-1',
    projectId: 'GG-P-A-1',
    submissionId: 'SUB-A-1',
    brandName: 'A 渠道客户',
    phoneNumber: '13600000001',
    amountTotal: sourceA.payableFen,
    sourceId: sourceA.sourceId,
    sourceToken: sourceA.sourceToken,
    sourceName: sourceA.sourceName,
    sourceType: sourceA.sourceType,
    sourceCapturedAt: '2026-09-24T00:00:00Z',
    channelId: sourceA.channelId,
    channelName: sourceA.channelName,
    discountType: sourceA.discountType,
    discountRateBps: sourceA.discountRateBps,
    commissionRateBps: sourceA.commissionRateBps
  });
  assert.strictEqual(aOrderResult.order.amountTotal, 15920);
  assert.strictEqual(aOrderResult.order.discountFen, 3980);
  assert.strictEqual(aOrderResult.order.channelId, channelA.channelId);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(aOrderResult.order, 'redeemCode'), false);

  await upsertChannel({
    channelId: channelA.channelId,
    name: 'A 渠道',
    discountType: 'percent',
    discountRateBps: 5000,
    commissionRateBps: 1200,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-12-31T23:59:59Z',
    ownerPhones: ['13800138000']
  });

  const laterSourceA = await resolveSourceToken(channelA.shareSource.token, new Date('2026-11-01T00:00:00Z'));
  assert.strictEqual(laterSourceA.channelBenefitActive, true);
  assert.strictEqual(laterSourceA.payableFen, 9950);
  assert.strictEqual(laterSourceA.commissionRateBps, 1200);

  const historicalOrder = await findPaymentByProject('GG-P-A-1');
  assert.strictEqual(historicalOrder.amountTotal, 15920);
  assert.strictEqual(historicalOrder.commissionRateBps, 1000);

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
  assert.strictEqual(dashboardA.channels[0].discountRateBps, 5000);
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
    discountType: 'free',
    discountRateBps: 0,
    commissionRateBps: 0,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-12-31T23:59:59Z',
    ownerPhones: ['13900139000']
  });
  const sourceB = await resolveSourceToken(channelB.shareSource.token, new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(sourceB.channelBenefitActive, true);
  assert.strictEqual(sourceB.payableFen, 0);
  assert.strictEqual(sourceB.discountFen, 19900);

  const bOrderResult = await createOrGetPaymentOrder({
    clientId: 'GG-B-1',
    projectId: 'GG-P-B-1',
    submissionId: 'SUB-B-1',
    brandName: 'B 渠道客户',
    phoneNumber: '13600000002',
    amountTotal: sourceB.payableFen,
    sourceId: sourceB.sourceId,
    sourceToken: sourceB.sourceToken,
    sourceName: sourceB.sourceName,
    sourceType: sourceB.sourceType,
    channelId: sourceB.channelId,
    channelName: sourceB.channelName,
    discountType: sourceB.discountType,
    discountRateBps: sourceB.discountRateBps,
    commissionRateBps: sourceB.commissionRateBps
  });
  assert.strictEqual(bOrderResult.order.status, 'free');
  assert.strictEqual(bOrderResult.order.amountTotal, 0);
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
  assert.strictEqual(partnerCardSource.channelBenefitActive, true);
  assert.strictEqual(partnerCardSource.payableFen, 9950);

  const expiredChannel = await upsertChannel({
    name: '过期渠道',
    discountType: 'percent',
    discountRateBps: 8000,
    commissionRateBps: 1000,
    active: true,
    endsAt: '2026-09-01T00:00:00Z'
  });
  const expiredSource = await resolveSourceToken(expiredChannel.shareSource.token, new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(expiredSource.channelId, expiredChannel.channelId);
  assert.strictEqual(expiredSource.channelBenefitActive, false);
  assert.strictEqual(expiredSource.payableFen, 19900);
  assert.strictEqual(expiredSource.commissionRateBps, 0);

  assert.strictEqual(sourceCodeFileName(distributionSources.website, 'official-website'), 'official-website.png');
  assert.strictEqual(sourceCodeAliasForSource(distributionSources.website), 'official-website');
  assert.strictEqual(
    sourceCodePublicUrl('business-card-lishasha.png'),
    'https://api.geogi.cn/api/source-codes/business-card-lishasha.png'
  );

  const admin = await channelAdminDashboard();
  assert(admin.channels.some((row) => row.channelId === channelA.channelId));
  assert(admin.sources.some((row) => row.sourceType === 'website'));
  assert(admin.sources.some((row) => row.channelId === channelA.channelId));
  assert(admin.orders.some((row) => row.channelId === channelA.channelId));
  assert(admin.orders.some((row) => row.channelId === channelB.channelId));
  assert(!JSON.stringify(admin).includes('redeemCode'));

  const records = await listCommissionRecords();
  assert.strictEqual(records.length, 2);

  const { shouldReplaceAttribution } = require('../../utils/attribution');
  const officialAttribution = {
    validated: true,
    sourceId: 'source_official_website',
    sourceType: 'website',
    channelId: '',
    channelBenefitActive: false
  };
  const channelAttribution = {
    validated: true,
    sourceId: 'source_channel_a',
    sourceType: 'channel',
    channelId: 'channel_a',
    channelBenefitActive: true
  };
  const channelBAttribution = {
    validated: true,
    sourceId: 'source_channel_b',
    sourceType: 'channel',
    channelId: 'channel_b',
    channelBenefitActive: true
  };
  assert.strictEqual(shouldReplaceAttribution(null, officialAttribution), true);
  assert.strictEqual(shouldReplaceAttribution(officialAttribution, channelAttribution), true);
  assert.strictEqual(shouldReplaceAttribution(channelAttribution, officialAttribution), false);
  assert.strictEqual(shouldReplaceAttribution(channelAttribution, channelBAttribution), false);

  const diagnosisCopy = fs.readFileSync(path.join(__dirname, '../../pages/diagnosis/diagnosis.wxml'), 'utf8');
  const mineCopy = fs.readFileSync(path.join(__dirname, '../../pages/mine/mine.wxml'), 'utf8');
  assert(!diagnosisCopy.includes('兑换码'));
  assert(!mineCopy.includes('兑换码'));
  assert(diagnosisCopy.includes('本次订单价格'));
  assert(diagnosisCopy.includes('本次优惠'));
  assert(diagnosisCopy.includes('channelBenefitActive'));
  assert(mineCopy.includes('分享专属入口'));
  assert(mineCopy.includes('客户权益'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('channel-attribution-commission-regression-ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
