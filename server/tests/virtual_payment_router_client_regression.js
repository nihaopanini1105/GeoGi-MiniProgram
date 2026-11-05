'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { createRouter } = require('../src/services/wechat-virtual-payment-router');
const { checkoutFields, requestVirtualPayment } = require('../../utils/virtual-payment');
async function run() {
  let calls = 0, authorized = false, reportReady = false;
  let order = { clientId: 'client-A', projectId: 'project-A', outTradeNo: 'ledger-A', amountTotal: 19900, provider: 'wechat_virtual_pay', status: 'unpaid' };
  const app = express();
  app.use(createRouter({
    authenticate: (req, res, next) => { if (!authorized) return res.status(401).json({ ok: false }); req.customerSession = { phoneNumber: 'synthetic-phone' }; next(); },
    resolveClient: async () => 'client-A', payments: { findPaymentByProject: async () => order, publicPaymentView: (o) => o },
    getReport: async () => ({ ok: true, report: { reportReady } }), ensureOrder: async () => order,
    service: { create: async () => { calls++; return { order, payParams: { mode: 'short_series_goods' } }; }, sync: async () => { calls++; return order; } }
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/customer/projects/project-A/payment';
  const post = (suffix = '', body = { clientId: 'client-A', paymentChannel: 'virtual', loginCode: 'synthetic' }) => fetch(base + suffix, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post()).status, 401); assert.equal(calls, 0);
    authorized = true; order = { ...order, clientId: 'other-customer' };
    assert.equal((await post()).status, 404); assert.equal(calls, 0);
    order = { ...order, clientId: 'client-A' }; reportReady = true;
    let r = await post(); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'REPORT_ALREADY_AUTHORIZED'); assert.equal(calls, 0);
    reportReady = false;
    r = await post('', { loginCode: 'legacy' }); assert.equal(r.status, 409); assert.equal(calls, 0);
    r = await post(); assert.equal(r.status, 200); assert.equal((await r.json()).paymentChannel, 'virtual'); assert.equal(calls, 1);
    assert.equal((await post('/sync')).status, 200); assert.equal(calls, 2);
    assert.equal((await post('/cancel')).status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  let invoked = 0;
  global.wx = { getDeviceInfo: () => ({ platform: 'ios' }), getAppBaseInfo: () => ({ version: '8.0.67' }), canIUse: () => true, requestVirtualPayment: () => { invoked++; } };
  const params = { mode: 'short_series_goods', signData: '{}', paySig: 'synthetic', signature: 'synthetic' };
  await assert.rejects(requestVirtualPayment(params), /升级微信/); assert.equal(invoked, 0);
  wx.getAppBaseInfo = () => ({ version: '8.0.68' }); wx.requestVirtualPayment = (input) => { invoked++; assert.equal(input.signData, '{}'); input.success({}); };
  await requestVirtualPayment(params); assert.equal(invoked, 1);
  assert.deepEqual(checkoutFields('code'), { loginCode: 'code', paymentChannel: 'virtual', clientPlatform: 'ios' });
  wx.canIUse = () => false; await assert.rejects(requestVirtualPayment(params), /暂不支持/); assert.equal(invoked, 1);
  delete global.wx;
  console.log('virtual-payment-router-client-regression-ok');
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
