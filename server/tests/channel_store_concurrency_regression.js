const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-channel-concurrency-'));
  process.env.GEOGI_CHANNEL_DATA_ROOT = path.join(root, 'channels');
  process.env.GEOGI_PAYMENT_DATA_ROOT = path.join(root, 'payments');

  const {
    ensureDefaultOfficialSources,
    upsertChannel,
    listChannels,
    listSources,
    resolveSourceToken,
    recordSourceVisit,
    listSourceVisits,
    reconcileCommission,
    listCommissionRecords,
    settleChannelPeriod
  } = require('../src/services/channel-store');

  const officialRuns = await Promise.all(
    Array.from({ length: 20 }, () => ensureDefaultOfficialSources())
  );
  assert.strictEqual(officialRuns.length, 20);
  const officialRows = (await listSources()).filter((row) =>
    String(row.notes || '').startsWith('auto_official_source:')
  );
  assert.strictEqual(officialRows.length, 3, 'official source initialization must not duplicate rows');
  assert.strictEqual(new Set(officialRows.map((row) => row.sourceId)).size, 3);

  await Promise.all(
    Array.from({ length: 20 }, () => upsertChannel({
      channelId: 'channel_concurrent',
      name: '并发渠道',
      discountType: 'percent',
      discountRateBps: 8000,
      commissionRateBps: 1000,
      active: true,
      ownerPhones: ['13800138000']
    }))
  );
  const channels = await listChannels();
  assert.strictEqual(channels.filter((row) => row.channelId === 'channel_concurrent').length, 1);
  const shareSources = (await listSources()).filter((row) =>
    row.channelId === 'channel_concurrent' && row.notes === 'auto_channel_share'
  );
  assert.strictEqual(shareSources.length, 1, 'channel share source must be idempotent under concurrency');

  const attribution = await resolveSourceToken(shareSources[0].token, new Date('2026-09-24T00:00:00Z'));
  await Promise.all(
    Array.from({ length: 100 }, (_, index) => recordSourceVisit({
      attribution,
      visitorId: 'visitor-' + index,
      capturedAt: '2026-09-24T00:01:00Z'
    }))
  );
  await Promise.all(
    Array.from({ length: 20 }, () => recordSourceVisit({
      attribution,
      visitorId: 'visitor-dedupe',
      capturedAt: '2026-09-24T00:02:00Z'
    }))
  );
  const visits = await listSourceVisits();
  assert.strictEqual(visits.filter((row) => row.sourceId === attribution.sourceId).length, 101);
  assert.strictEqual(visits.filter((row) => row.visitorId === 'visitor-dedupe').length, 1);

  const commissionOrders = Array.from({ length: 50 }, (_, index) => ({
    projectId: 'PROJECT-' + index,
    clientId: 'CLIENT-' + index,
    outTradeNo: 'TRADE-' + index,
    brandName: '并发品牌 ' + index,
    channelId: 'channel_concurrent',
    channelName: '并发渠道',
    sourceId: attribution.sourceId,
    sourceName: attribution.sourceName,
    sourceType: attribution.sourceType,
    commissionRateBps: 1000,
    listPriceFen: 19900,
    amountTotal: 10000,
    refundedAmount: 0,
    reportReleasedAt: '2026-09-24T01:00:00Z'
  }));
  await Promise.all(commissionOrders.map((order) => reconcileCommission({ order })));
  let commissions = await listCommissionRecords();
  assert.strictEqual(commissions.length, 50, 'concurrent commission accrual must not lose records');
  assert.strictEqual(commissions.reduce((sum, row) => sum + Number(row.dueFen || 0), 0), 50000);

  const settlementResults = await Promise.allSettled([
    settleChannelPeriod({
      channelId: 'channel_concurrent',
      period: '2026-09',
      operatorId: 'finance-a',
      payoutReference: 'SETTLE-A'
    }),
    settleChannelPeriod({
      channelId: 'channel_concurrent',
      period: '2026-09',
      operatorId: 'finance-b',
      payoutReference: 'SETTLE-B'
    })
  ]);
  assert.strictEqual(settlementResults.filter((row) => row.status === 'fulfilled').length, 1);
  assert.strictEqual(settlementResults.filter((row) => row.status === 'rejected').length, 1);
  assert.strictEqual(settlementResults.find((row) => row.status === 'fulfilled').value.payoutFen, 50000);

  commissions = await listCommissionRecords();
  assert.strictEqual(commissions.reduce((sum, row) => sum + Number(row.payoutFen || 0), 0), 50000);
  assert.strictEqual(commissions.reduce((sum, row) => sum + Number(row.dueFen || 0), 0), 0);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('channel-store-concurrency-regression-ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
