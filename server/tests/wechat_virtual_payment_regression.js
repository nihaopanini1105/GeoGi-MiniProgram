'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService, PROVIDER, validateQuery } = require('../src/services/wechat-virtual-payment');
async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-vpay-test-'));
  const c = { appId: 'wxTest', offerId: '1450709233', productId: 'geogi_diag_199', productionAppKey: 'syntheticProductionKey', sandboxAppKey: 'syntheticSandboxKey', attemptRoot: root, enabled: true, goodsPublished: true, iosEnabled: true, iosRefundPolicy: 'reject_all' };
  const ledger = new Map(); let mutations = 0, projectionCalls = 0, queries = new Map(), deliverCalls = 0, failProjection = false;
  const payments = {
    findPaymentByOutTradeNo: async (id) => structuredClone(ledger.get(id)),
    updatePaymentOrder: async (id, patch) => { mutations++; const next = { ...ledger.get(id), ...patch }; ledger.set(id, next); return structuredClone(next); }
  };
  const service = createService({ loadConfig: () => c, payments,
    exchangeCode: async () => ({ openid: 'payer-A', sessionKey: 'syntheticSessionKey' }),
    callPlatform: async (_c, endpoint, body) => {
      if (endpoint.includes('notify_provide')) { deliverCalls++; return { errcode: 0 }; }
      return { errcode: 0, order: structuredClone(queries.get(body.order_id)) };
    }, project: async () => { projectionCalls++; if (failProjection) throw Error('synthetic CRM unavailable'); }
  });
  function order(id, patch = {}) { const o = { outTradeNo: id, clientId: 'client-A', projectId: 'project-' + id, amountTotal: 19900, currency: 'CNY', status: 'unpaid', provider: 'wechat_pay', ...patch }; ledger.set(id, o); return structuredClone(o); }
  function receipt(p) {
    const s = JSON.parse(p.payParams.signData);
    queries.set(s.outTradeNo, { order_id: s.outTradeNo, order_fee: s.activitySellingPrice || s.goodsPrice, status: 2, order_type: 0, paid_time: 1793846400, wx_order_id: 'wx-' + s.outTradeNo, env_type: 1 });
    return { Event: 'xpay_goods_deliver_notify', OpenId: 'payer-A', OutTradeNo: s.outTradeNo, Env: 0,
      GoodsInfo: { ProductId: s.productId, Quantity: 1, OrigPrice: 19900, ActualPrice: s.activitySellingPrice || s.goodsPrice, Attach: s.attach } };
  }
  try {
    c.enabled = false;
    await assert.rejects(service.create(order('disabled'), 'code', 'android'), /NOT_READY/); c.enabled = true;
    c.iosEnabled = false;
    await assert.rejects(service.create(order('ios'), 'code', 'ios'), /IOS_NOT_READY/); c.iosEnabled = true;
    assert.equal((await service.create(order('free', { status: 'free', amountTotal: 0 }), '', 'ios')).alreadyPaid, true);
    await assert.rejects(service.create(order('legacy', { prepayId: 'legacy-prepay', status: 'paying' }), 'code', 'android'), /LEGACY_PENDING/);
    const p = await service.create(order('normal'), 'code', 'android');
    const signData = p.payParams.signData;
    assert.equal(p.payParams.mode, 'short_series_goods');
    assert.equal(p.payParams.paySig, crypto.createHmac('sha256', c.productionAppKey).update('requestVirtualPayment&' + signData).digest('hex'));
    assert.equal(p.payParams.signature, crypto.createHmac('sha256', 'syntheticSessionKey').update(signData).digest('hex'));
    const msg = receipt(p), q = queries.get(msg.OutTradeNo);
    const before = mutations;
    for (const patch of [{ Env: 1 }, { OpenId: 'payer-B' }, { GoodsInfo: { ...msg.GoodsInfo, ActualPrice: 1 } }, { GoodsInfo: { ...msg.GoodsInfo, ProductId: 'other' } }, { GoodsInfo: { ...msg.GoodsInfo, Quantity: 2 } }, { GoodsInfo: { ...msg.GoodsInfo, Attach: '{}' } }]) {
      await assert.rejects(service.handleEvent({ ...msg, ...patch }));
    }
    assert.equal(mutations, before, 'tampered notifications never change the ledger');
    for (const patch of [{ order_fee: 1 }, { env_type: 2 }, { order_id: 'other' }, { order_type: 1 }]) {
      queries.set(msg.OutTradeNo, { ...q, ...patch }); await assert.rejects(service.handleEvent(msg));
    }
    queries.set(msg.OutTradeNo, q);
    failProjection = true; await assert.rejects(service.handleEvent(msg), /CRM/);
    assert.equal(ledger.get('normal').status, 'paid', 'payment survives a CRM outage');
    failProjection = false;
    const paidMutations = mutations;
    await Promise.all([service.handleEvent(msg), service.handleEvent(msg), service.handleEvent(msg)]);
    assert.equal(mutations, paidMutations, 'parallel duplicates grant access only once');
    assert(projectionCalls >= 4, 'a retry repairs projection after payment was committed');
    assert.equal(ledger.get('normal').transactionId, q.wx_order_id);
    assert.equal(ledger.get('normal').provider, PROVIDER);
    assert.equal(deliverCalls, 0, 'push response itself confirms delivery');
    assert.equal((await service.create(structuredClone(ledger.get('normal')), 'code', 'ios')).alreadyPaid, true);
    const refund = { Event: 'xpay_refund_notify', OpenId: 'payer-A', MchOrderId: msg.OutTradeNo, WxOrderId: q.wx_order_id, WxRefundId: 'refund-one', MchRefundId: 'merchant-refund-one', RetCode: 0, RefundFee: 9900 };
    await service.handleEvent({ ...refund, RetCode: 1 }); assert.equal(ledger.get('normal').status, 'paid');
    await service.handleEvent(refund); await service.handleEvent(refund);
    assert.equal(ledger.get('normal').refundedAmount, 9900);
    await assert.rejects(service.handleEvent({ ...refund, RefundFee: 10000 }), /REPLAY_MISMATCH/);
    await assert.rejects(service.handleEvent({ ...refund, WxRefundId: 'another-refund' }), /REPLAY_MISMATCH/);
    await assert.rejects(service.handleEvent({ ...refund, WxRefundId: 'too-large', MchRefundId: 'new-merchant', RefundFee: 19900 }), /REFUND_INVALID/);
    await service.handleEvent({ ...refund, WxRefundId: 'refund-two', MchRefundId: 'merchant-refund-two', RefundFee: 10000 });
    assert.equal(ledger.get('normal').status, 'refunded'); assert.equal(ledger.get('normal').refundedAmount, 19900);
    ledger.set('normal', { ...ledger.get('normal'), status: 'paid', refundedAmount: 0, refundableAmount: 19900 });
    await service.sync(structuredClone(ledger.get('normal')));
    assert.equal(ledger.get('normal').status, 'refunded', 'durable refund receipt repairs an interrupted ledger commit');
    assert.equal((await service.sync(structuredClone(ledger.get('normal')))).status, 'refunded');
    const discounted = await service.create(order('discounted', { amountTotal: 9900 }), 'code', 'android');
    assert.equal(JSON.parse(discounted.payParams.signData).activitySellingPrice, 9900);
    const discountedMsg = receipt(discounted); await service.sync(structuredClone(ledger.get('discounted')));
    assert.equal(ledger.get('discounted').status, 'paid'); assert.equal(deliverCalls, 1);
    const pending = await service.create(order('pending'), 'code', 'android');
    const pendingMsg = receipt(pending); const pendingQ = queries.get(pendingMsg.OutTradeNo);
    queries.set(pendingMsg.OutTradeNo, { ...pendingQ, status: 1 });
    await assert.rejects(service.create(structuredClone(ledger.get('pending')), 'code', 'android'), /PREVIOUS_ATTEMPT_PENDING/);
    queries.set(pendingMsg.OutTradeNo, { ...pendingQ, status: 6 });
    const fresh = await service.create(structuredClone(ledger.get('pending')), 'code', 'android');
    assert.notEqual(JSON.parse(fresh.payParams.signData).outTradeNo, pendingMsg.OutTradeNo, 'each new platform order gets a unique ID');
    const aFile = path.join(root, pendingMsg.OutTradeNo + '.json');
    const a = JSON.parse(fs.readFileSync(aFile)); a.clientId = 'client-B'; fs.writeFileSync(aFile, JSON.stringify(a), { mode: 0o600 });
    await assert.rejects(service.handleEvent(pendingMsg), /SCOPE_MISMATCH/);
    for (const file of fs.readdirSync(root)) {
      if (fs.statSync(path.join(root, file)).isDirectory()) continue;
      assert.equal(fs.statSync(path.join(root, file)).mode & 0o777, 0o600);
      const data = fs.readFileSync(path.join(root, file), 'utf8'); assert(!data.includes('syntheticSessionKey')); assert(!data.includes(c.productionAppKey));
    }
    const ios = await service.create(order('ios-paid'), 'code', 'ios');
    const iosMsg = receipt(ios), iosQuery = queries.get(iosMsg.OutTradeNo);
    queries.set(iosMsg.OutTradeNo, { ...iosQuery, order_type: 7 });
    await service.handleEvent(iosMsg);
    const advice = await service.handleEvent({ Event: 'xpay_subscribe_ios_refund_query_notify', pay_order_id: iosQuery.wx_order_id, product_id: c.productId, p_count: '1' });
    assert.equal(advice.IosRefundQueryResponse.result_code, 1);
    assert(advice.IosRefundQueryResponse.evidence.includes('尚未记录交付'));
    assert.equal(ledger.get('ios-paid').status, 'paid', 'refund advice does not falsely record a refund');
    await assert.rejects(service.handleEvent({ Event: 'xpay_subscribe_ios_refund_query_notify', pay_order_id: 'unknown', product_id: c.productId, p_count: '1' }));
    assert.throws(() => validateQuery({ ...q, env_type: 2 }, { id: q.order_id, amount: q.order_fee }), /QUERY_MISMATCH/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('wechat-virtual-payment-regression-ok');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
