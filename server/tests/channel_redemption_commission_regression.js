const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-channel-regression-'));
  process.env.GEOGI_CHANNEL_DATA_ROOT = path.join(root, 'channels');
  process.env.GEOGI_PAYMENT_DATA_ROOT = path.join(root, 'payments');

  const {
    upsertChannel,
    quoteChannelCode,
    reconcileCommission,
    settleChannelPeriod,
    listCommissionRecords
  } = require('../src/services/channel-store');
  const {
    createOrGetPaymentOrder,
    updatePaymentOrder,
    findPaymentByProject
  } = require('../src/services/payment-store');
  const {
    channelDashboardForPhone,
    channelAdminDashboard
  } = require('../src/services/channel-service');

  const channelA = await upsertChannel({
    name: 'A 渠道',
    code: 'A80',
    discountType: 'percent',
    discountRateBps: 8000,
    commissionRateBps: 1000,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-10-31T23:59:59Z',
    ownerPhones: ['13800138000']
  });

  const quoteA = await quoteChannelCode('a80', new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(quoteA.payableFen, 15920);
  assert.strictEqual(quoteA.discountFen, 3980);
  assert.strictEqual(quoteA.commissionRateBps, 1000);

  const aOrderResult = await createOrGetPaymentOrder({
    clientId: 'GG-A-1',
    projectId: 'GG-P-A-1',
    submissionId: 'SUB-A-1',
    brandName: 'A 渠道客户',
    phoneNumber: '13600000001',
    amountTotal: quoteA.payableFen,
    promotionCode: quoteA.promotionCode,
    channelId: quoteA.channelId,
    channelName: quoteA.channelName,
    discountType: quoteA.discountType,
    discountRateBps: quoteA.discountRateBps,
    commissionRateBps: quoteA.commissionRateBps
  });
  assert.strictEqual(aOrderResult.order.amountTotal, 15920);
  assert.strictEqual(aOrderResult.order.status, 'unpaid');

  await upsertChannel({
    channelId: channelA.channelId,
    name: 'A 渠道',
    code: 'A80',
    discountType: 'percent',
    discountRateBps: 5000,
    commissionRateBps: 1200,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-12-31T23:59:59Z',
    ownerPhones: ['13800138000']
  });
  const updatedQuoteA = await quoteChannelCode('A80', new Date('2026-11-01T00:00:00Z'));
  assert.strictEqual(updatedQuoteA.payableFen, 9950);
  const historicalOrder = await findPaymentByProject('GG-P-A-1');
  assert.strictEqual(historicalOrder.amountTotal, 15920);
  assert.strictEqual(historicalOrder.commissionRateBps, 1000);

  const paidOrder = await updatePaymentOrder(aOrderResult.order.outTradeNo, {
    status: 'paid',
    paidAt: '2026-09-24T01:00:00Z',
    refundableAmount: 15920
  });
  const commission = await reconcileCommission({
    order: paidOrder,
    releasedAt: '2026-09-25T02:00:00Z'
  });
  assert.strictEqual(commission.earnedFen, 1592);
  assert.strictEqual(commission.dueFen, 1592);
  assert.strictEqual(commission.period, '2026-09');
  assert.strictEqual(commission.payoutStatus, 'pending');

  const dashboardA = await channelDashboardForPhone('13800138000');
  assert.strictEqual(dashboardA.isChannel, true);
  assert.strictEqual(dashboardA.channels.length, 1);
  assert.strictEqual(dashboardA.channels[0].pendingCommissionYuan, 15.92);
  assert.strictEqual(dashboardA.monthly.find((row) => row.period === '2026-09').completedReports, 1);

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
    code: 'BFREE',
    discountType: 'free',
    discountRateBps: 0,
    commissionRateBps: 0,
    active: true,
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-12-31T23:59:59Z',
    ownerPhones: ['13900139000']
  });
  const quoteB = await quoteChannelCode('BFREE', new Date('2026-09-24T00:00:00Z'));
  assert.strictEqual(quoteB.payableFen, 0);
  const bOrderResult = await createOrGetPaymentOrder({
    clientId: 'GG-B-1',
    projectId: 'GG-P-B-1',
    submissionId: 'SUB-B-1',
    brandName: 'B 渠道客户',
    phoneNumber: '13600000002',
    amountTotal: 0,
    promotionCode: quoteB.promotionCode,
    channelId: quoteB.channelId,
    channelName: quoteB.channelName,
    discountType: quoteB.discountType,
    discountRateBps: quoteB.discountRateBps,
    commissionRateBps: quoteB.commissionRateBps
  });
  assert.strictEqual(bOrderResult.order.status, 'free');
  assert.strictEqual(bOrderResult.order.provider, 'channel_redemption');
  const bCommission = await reconcileCommission({
    order: bOrderResult.order,
    releasedAt: '2026-09-26T02:00:00Z'
  });
  assert.strictEqual(bCommission.earnedFen, 0);
  assert.strictEqual(bCommission.payoutStatus, 'not_applicable');

  const dashboardB = await channelDashboardForPhone('13900139000');
  assert.strictEqual(dashboardB.channels.length, 1);
  assert.strictEqual(dashboardB.channels[0].channelId, channelB.channelId);
  const dashboardUnknown = await channelDashboardForPhone('13700000000');
  assert.strictEqual(dashboardUnknown.isChannel, false);

  const admin = await channelAdminDashboard();
  assert.strictEqual(admin.channels.length, 2);
  assert(admin.orders.some((row) => row.redemptionCode === 'A80'));
  assert(admin.orders.some((row) => row.redemptionCode === 'BFREE'));

  const records = await listCommissionRecords();
  assert.strictEqual(records.length, 2);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('channel-redemption-commission-regression-ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
