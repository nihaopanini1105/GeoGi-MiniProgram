'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./payment-store');
const CONFIG_FILE = '/opt/geogi-mini-program/shared/wechat-virtual-payment.json';
const PROVIDER = 'wechat_virtual_pay';
const queues = new Map();
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function privateJson(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077) fail('PAYMENT_VIRTUAL_CONFIG_PRIVATE_REQUIRED');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function loadConfig() {
  try {
    const c = privateJson(process.env.GEOGI_VIRTUAL_PAYMENT_CONFIG_FILE || CONFIG_FILE);
    if (c.appId !== (process.env.WECHAT_APP_ID || process.env.WECHAT_MINI_PROGRAM_APPID) ||
        c.offerId !== '1450709233' || c.productId !== 'geogi_diag_199' ||
        ![c.productionAppKey, c.sandboxAppKey].every((v) => typeof v === 'string' && /^[A-Za-z0-9]{16,128}$/.test(v)) ||
        !path.isAbsolute(c.attemptRoot || '')) fail('PAYMENT_VIRTUAL_NOT_CONFIGURED');
    return c;
  } catch (_) { fail('PAYMENT_VIRTUAL_NOT_CONFIGURED'); }
}
async function locked(key, task) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task); queues.set(key, next);
  try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
function attemptFile(c, id) {
  if (!/^GVP[A-F0-9]{29}$/.test(id || '')) fail('PAYMENT_VIRTUAL_ATTEMPT_INVALID');
  return path.join(c.attemptRoot, id + '.json');
}
function readAttempt(c, id) { return privateJson(attemptFile(c, id)); }
function writeAttempt(c, a) {
  fs.mkdirSync(c.attemptRoot, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(c.attemptRoot);
  if (!st.isDirectory() || st.isSymbolicLink() || st.mode & 0o077) fail('PAYMENT_VIRTUAL_STORE_PRIVATE_REQUIRED');
  const file = attemptFile(c, a.id), temp = file + '.' + crypto.randomBytes(8).toString('hex');
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(a) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dir = fs.openSync(c.attemptRoot, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function attempts(c, ledger) {
  if (!fs.existsSync(c.attemptRoot)) return [];
  return fs.readdirSync(c.attemptRoot).filter((f) => /^GVP[A-F0-9]{29}\.json$/.test(f))
    .map((f) => readAttempt(c, f.slice(0, -5))).filter((a) => a.ledger === ledger);
}
function platformIndex(c, wxId) {
  if (typeof wxId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(wxId)) fail('PAYMENT_VIRTUAL_PLATFORM_ORDER_INVALID');
  return path.join(c.attemptRoot, 'by-platform-order', crypto.createHash('sha256').update(wxId).digest('hex') + '.json');
}
function indexAttempt(c, a, wxId) {
  const file = platformIndex(c, wxId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const data = JSON.stringify({ id: a.id, wxOrderId: wxId });
  try { const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  catch (error) { if (error.code !== 'EEXIST') throw error; const old = privateJson(file); if (old.id !== a.id || old.wxOrderId !== wxId) fail('PAYMENT_VIRTUAL_PLATFORM_ORDER_REUSED'); }
}
async function jsonRequest(url, options) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) }); }
  catch (_) { fail('PAYMENT_VIRTUAL_PLATFORM_UNAVAILABLE'); }
  if (!response.ok) fail('PAYMENT_VIRTUAL_PLATFORM_UNAVAILABLE');
  return response.json();
}
let accessToken;
async function access(c) {
  if (accessToken && accessToken.appId === c.appId && accessToken.expires > Date.now()) return accessToken.value;
  const secret = process.env.WECHAT_APP_SECRET || process.env.WECHAT_MINI_PROGRAM_SECRET;
  if (!secret) fail('PAYMENT_VIRTUAL_NOT_CONFIGURED');
  const result = await jsonRequest('https://api.weixin.qq.com/cgi-bin/token?' + new URLSearchParams({
    grant_type: 'client_credential', appid: c.appId, secret
  }));
  if (!result.access_token) fail('PAYMENT_VIRTUAL_ACCESS_TOKEN_FAILED');
  accessToken = { value: result.access_token, appId: c.appId, expires: Date.now() + Math.max(60, Number(result.expires_in || 7200) - 120) * 1000 };
  return accessToken.value;
}
async function exchangeCode(c, code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) fail('PAYMENT_VIRTUAL_LOGIN_REQUIRED');
  const secret = process.env.WECHAT_APP_SECRET || process.env.WECHAT_MINI_PROGRAM_SECRET;
  const result = await jsonRequest('https://api.weixin.qq.com/sns/jscode2session?' + new URLSearchParams({
    appid: c.appId, secret: secret || '', js_code: code, grant_type: 'authorization_code'
  }));
  if (!result.openid || !result.session_key || result.errcode) fail('PAYMENT_VIRTUAL_LOGIN_FAILED');
  return { openid: String(result.openid), sessionKey: String(result.session_key) };
}
function sign(key, value) { return crypto.createHmac('sha256', key).update(value).digest('hex'); }
async function callPlatform(c, endpoint, payload, env = 0) {
  if (!['/xpay/query_order', '/xpay/notify_provide_goods'].includes(endpoint)) fail('PAYMENT_VIRTUAL_ENDPOINT_DENIED');
  const body = JSON.stringify(payload), key = env === 1 ? c.sandboxAppKey : c.productionAppKey;
  const token = await access(c);
  const result = await jsonRequest('https://api.weixin.qq.com' + endpoint + '?' + new URLSearchParams({
    access_token: token, pay_sig: sign(key, endpoint + '&' + body)
  }), { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (result.errcode !== undefined && result.errcode !== 0) fail('PAYMENT_VIRTUAL_PLATFORM_' + String(Number(result.errcode)));
  return result;
}
function assertScope(a, order, c) {
  if (!order || a.ledger !== order.outTradeNo || a.clientId !== order.clientId || a.projectId !== order.projectId ||
      a.amount !== order.amountTotal || a.productId !== c.productId || a.appId !== c.appId || a.offerId !== c.offerId ||
      a.env !== 0 || !a.openid) fail('PAYMENT_VIRTUAL_SCOPE_MISMATCH');
}
function validateQuery(q, a) {
  if (!q || q.order_id !== a.id || Number(q.order_fee) !== a.amount || q.env_type !== 1 ||
      ![0, 7].includes(q.order_type) || !Number.isInteger(q.status) ||
      (a.wxOrderId && q.wx_order_id !== a.wxOrderId)) fail('PAYMENT_VIRTUAL_QUERY_MISMATCH');
  return q;
}
function createService(options = {}) {
  const config = options.loadConfig || loadConfig, payments = options.payments || store;
  const exchange = options.exchangeCode || exchangeCode, platform = options.callPlatform || callPlatform;
  const project = options.project || (async (order) => {
    await require('./payment-service').projectPaymentProjection({ clientId: order.clientId, projectId: order.projectId, paymentStatus: order.status });
    await require('./channel-service').reconcileCommission({ order });
  });
  async function confirm(c, a, q, fromCallback) {
    let order = await payments.findPaymentByOutTradeNo(a.ledger); assertScope(a, order, c);
    validateQuery(q, a);
    if (![2, 3, 4].includes(q.status)) return order;
    if (!q.wx_order_id || !Number.isInteger(q.paid_time) || q.paid_time <= 0) fail('PAYMENT_VIRTUAL_QUERY_MISMATCH');
    if (['refunded', 'refund_processing', 'partially_refunded', 'closed'].includes(order.status)) fail('PAYMENT_VIRTUAL_TERMINAL_ORDER');
    if (order.status === 'paid' && order.transactionId !== q.wx_order_id) {
      a.state = 'duplicate_paid_review'; a.wxOrderId = q.wx_order_id; writeAttempt(c, a);
      fail('PAYMENT_VIRTUAL_DUPLICATE_PAID_REVIEW');
    }
    // Sandbox events never grant customer access. Both stored env and query env are checked above.
    indexAttempt(c, a, q.wx_order_id);
    if (order.status !== 'paid') order = await payments.updatePaymentOrder(a.ledger, {
      provider: PROVIDER, status: 'paid', providerTradeState: 'SUCCESS', transactionId: q.wx_order_id,
      paidAt: new Date(q.paid_time * 1000).toISOString(), refundableAmount: a.amount,
      virtualPaymentPlatform: q.order_type === 7 ? 'ios' : 'other', virtualAttemptId: a.id
    });
    a.wxOrderId = q.wx_order_id; a.state = 'paid'; a.orderType = q.order_type; writeAttempt(c, a);
    // Retry projection even after a prior payment commit: it is separately idempotent.
    await project(order);
    if (!fromCallback && q.status !== 4) await platform(c, '/xpay/notify_provide_goods', { order_id: a.id, env: a.env }, a.env);
    a.projectionDone = true; a.deliveryAck = true; writeAttempt(c, a);
    return order;
  }
  async function create(order, loginCode, clientPlatform) {
    if (!order) fail('PAYMENT_ORDER_NOT_FOUND');
    if (['paid', 'free', 'partially_refunded'].includes(order.status)) return { alreadyPaid: true, order };
    const c = config();
    if (c.enabled !== true || c.goodsPublished !== true) fail('PAYMENT_VIRTUAL_NOT_READY');
    if (clientPlatform === 'ios' && c.iosEnabled !== true) fail('PAYMENT_VIRTUAL_IOS_NOT_READY');
    return locked(order.outTradeNo, async () => {
      const current = await payments.findPaymentByOutTradeNo(order.outTradeNo);
      if (!current || current.clientId !== order.clientId || current.projectId !== order.projectId) fail('PAYMENT_VIRTUAL_SCOPE_MISMATCH');
      if (['paid', 'free', 'partially_refunded'].includes(current.status)) return { alreadyPaid: true, order: current };
      if (['closed', 'refunded', 'refund_processing'].includes(current.status)) fail('PAYMENT_VIRTUAL_TERMINAL_ORDER');
      if (current.provider !== PROVIDER && (current.prepayId || current.status === 'paying')) fail('PAYMENT_VIRTUAL_LEGACY_PENDING');
      for (const previous of attempts(c, current.outTradeNo).filter((a) => !['closed', 'paid'].includes(a.state))) {
        assertScope(previous, current, c);
        const result = await platform(c, '/xpay/query_order', { openid: previous.openid, env: previous.env, order_id: previous.id }, previous.env);
        const q = validateQuery(result.order, previous);
        if ([2, 3, 4].includes(q.status)) return { alreadyPaid: true, order: await confirm(c, previous, q, false) };
        // Until WeChat confirms closure, another payable attempt could double-charge.
        if (q.status !== 6) fail('PAYMENT_VIRTUAL_PREVIOUS_ATTEMPT_PENDING');
        previous.state = 'closed'; writeAttempt(c, previous);
      }
      const session = await exchange(c, loginCode);
      const id = 'GVP' + crypto.randomBytes(15).toString('hex').slice(0, 29).toUpperCase();
      const a = { id, ledger: current.outTradeNo, appId: c.appId, offerId: c.offerId, productId: c.productId,
        clientId: current.clientId, projectId: current.projectId, amount: current.amountTotal,
        openid: session.openid, env: 0, state: 'created', createdAt: new Date().toISOString(), refunds: [] };
      const attach = JSON.stringify({ clientId: a.clientId, projectId: a.projectId, attemptId: a.id }); a.attach = attach;
      const payload = { offerId: c.offerId, buyQuantity: 1, env: 0, currencyType: 'CNY', productId: c.productId,
        goodsPrice: 19900, ...(a.amount < 19900 ? { activitySellingPrice: a.amount } : {}), outTradeNo: a.id, attach };
      const signData = JSON.stringify(payload);
      writeAttempt(c, a);
      const updated = await payments.updatePaymentOrder(current.outTradeNo, {
        provider: PROVIDER, status: 'paying', virtualAttemptId: a.id, payerOpenidHash: crypto.createHash('sha256').update(session.openid).digest('hex')
      });
      return { alreadyPaid: false, order: updated, paymentChannel: 'virtual', payParams: {
        mode: 'short_series_goods', signData, paySig: sign(c.productionAppKey, 'requestVirtualPayment&' + signData),
        signature: sign(session.sessionKey, signData)
      } };
    });
  }
  async function applyStoredRefund(c, a) {
    let order = await payments.findPaymentByOutTradeNo(a.ledger); assertScope(a, order, c);
    const refunds = a.refunds || [], total = refunds.reduce((sum, r) => sum + r.amount, 0);
    if (!total || total > a.amount || order.transactionId !== a.wxOrderId) fail('PAYMENT_VIRTUAL_REFUND_INVALID');
    if (Number(order.refundedAmount || 0) !== total) order = await payments.updatePaymentOrder(a.ledger, {
      status: total === a.amount ? 'refunded' : 'partially_refunded', refundedAmount: total, refundableAmount: a.amount - total,
      refunds: refunds.map((r) => ({ outRefundNo: r.merchantId, providerRefundId: r.id, amount: r.amount, status: 'success' }))
    });
    await project(order); a.refundProjectionDone = true; writeAttempt(c, a); return order;
  }
  async function sync(order) {
    const c = config();
    return locked(order.outTradeNo, async () => {
      const storedRefund = attempts(c, order.outTradeNo).find((a) => (a.refunds || []).length);
      if (storedRefund) return applyStoredRefund(c, storedRefund);
      if (['refunded', 'partially_refunded', 'refund_processing'].includes(order.status)) {
        await project(order);
        for (const a of attempts(c, order.outTradeNo)) { a.refundProjectionDone = true; writeAttempt(c, a); }
        return order;
      }
      const all = attempts(c, order.outTradeNo);
      if (!all.length) fail('PAYMENT_VIRTUAL_ATTEMPT_REQUIRED');
      let current = order;
      for (const a of all) {
        assertScope(a, current, c);
        const r = await platform(c, '/xpay/query_order', { openid: a.openid, env: a.env, order_id: a.id }, a.env);
        const q = validateQuery(r.order, a);
        if ([2, 3, 4].includes(q.status)) current = await confirm(c, a, q, false);
        else if (q.status === 6) { a.state = 'closed'; writeAttempt(c, a); }
      }
      return current;
    });
  }
  async function handleEvent(message) {
    const c = config();
    const event = message.Event;
    if (event === 'xpay_subscribe_ios_refund_query_notify') {
      if (c.iosRefundPolicy !== 'reject_all' || message.product_id !== c.productId || String(message.p_count) !== '1') fail('PAYMENT_VIRTUAL_REFUND_POLICY_REQUIRED');
      const id = /^GVP[A-F0-9]{29}$/.test(message.pay_order_id || '') ? message.pay_order_id : privateJson(platformIndex(c, message.pay_order_id)).id;
      const a = readAttempt(c, id), order = await payments.findPaymentByOutTradeNo(a.ledger); assertScope(a, order, c);
      if (a.orderType !== 7 || (message.OpenId && message.OpenId !== a.openid)) fail('PAYMENT_VIRTUAL_REFUND_INVALID');
      return { ErrCode: 0, ErrMsg: 'success', IosRefundQueryResponse: { result_code: 1, result_info: '商家建议不退款，最终由Apple决定',
        evidence: '商家政策：购买后不接受主动退款；订单' + a.id + '，付款状态：' + order.status + '；报告交付记录：' + (order.reportReleasedAt || '尚未记录交付') } };
    }

    if (!['xpay_goods_deliver_notify', 'xpay_refund_notify'].includes(event)) fail('PAYMENT_VIRTUAL_EVENT_UNSUPPORTED');
    const id = event === 'xpay_goods_deliver_notify' ? message.OutTradeNo : message.MchOrderId;
    const a = readAttempt(c, id);
    return locked(a.ledger, async () => {
      const fresh = readAttempt(c, id); let order = await payments.findPaymentByOutTradeNo(fresh.ledger); assertScope(fresh, order, c);
      if (message.OpenId !== fresh.openid) fail('PAYMENT_VIRTUAL_PAYER_MISMATCH');
      if (event === 'xpay_goods_deliver_notify') {
        const g = message.GoodsInfo || {};
        if (message.Env !== 0 || fresh.env !== 0 || g.ProductId !== fresh.productId || g.Quantity !== 1 ||
            g.OrigPrice !== 19900 || g.ActualPrice !== fresh.amount || g.Attach !== fresh.attach) fail('PAYMENT_VIRTUAL_GOODS_MISMATCH');
        const r = await platform(c, '/xpay/query_order', { openid: fresh.openid, env: fresh.env, order_id: fresh.id }, fresh.env);
        if (![2, 3, 4].includes(r.order && r.order.status)) fail('PAYMENT_VIRTUAL_PAYMENT_UNCONFIRMED');
        // The independently queried platform order ID is authoritative across payment channels.
        return confirm(c, fresh, r.order, true);
      }
      if (typeof message.RetCode !== 'number') fail('PAYMENT_VIRTUAL_REFUND_INVALID');
      if (message.RetCode !== 0) return order;
      if (!['paid', 'partially_refunded', 'refunded', 'refund_processing'].includes(order.status) ||
          !fresh.wxOrderId || message.WxOrderId !== fresh.wxOrderId ||
          !Number.isInteger(message.RefundFee) || message.RefundFee <= 0 ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(message.WxRefundId || '') || !message.MchRefundId) fail('PAYMENT_VIRTUAL_REFUND_INVALID');
      const refunds = fresh.refunds || [];
      if (refunds.some((r) => r.merchantId === message.MchRefundId && r.id !== message.WxRefundId)) fail('PAYMENT_VIRTUAL_REFUND_REPLAY_MISMATCH');
      const existing = refunds.find((r) => r.id === message.WxRefundId);
      if (existing && (existing.amount !== message.RefundFee || existing.merchantId !== message.MchRefundId)) fail('PAYMENT_VIRTUAL_REFUND_REPLAY_MISMATCH');
      if (!existing) refunds.push({ id: message.WxRefundId, merchantId: message.MchRefundId, amount: message.RefundFee });
      const total = refunds.reduce((sum, r) => sum + r.amount, 0);
      if (total > fresh.amount) fail('PAYMENT_VIRTUAL_REFUND_INVALID');
      fresh.refunds = refunds; fresh.refundProjectionDone = false; writeAttempt(c, fresh);
      // Reconciliation also applies this durable list after an interrupted commit.
      return applyStoredRefund(c, fresh);
    });
  }
  async function syncPending() {
    const c = config();
    if (c.enabled !== true || !fs.existsSync(c.attemptRoot)) return { processed: 0 };
    const pending = fs.readdirSync(c.attemptRoot).filter((f) => /^GVP[A-F0-9]{29}\.json$/.test(f))
      .map((f) => readAttempt(c, f.slice(0, -5)))
      .filter((a) => a.state !== 'closed' && (a.state !== 'paid' || !a.projectionDone || !a.deliveryAck || ((a.refunds || []).length && !a.refundProjectionDone)));
    let processed = 0;
    for (const id of [...new Set(pending.map((a) => a.ledger))].slice(0, 20)) {
      try { const order = await payments.findPaymentByOutTradeNo(id); if (order && order.provider === PROVIDER) { await sync(order); processed++; } } catch (_) { /* Retain pending state for next reconciliation. */ }
    }
    return { processed };
  }
  return { create, sync, handleEvent, syncPending };
}
let service;
function defaultService() { return service || (service = createService()); }
function startReconciler() {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await defaultService().syncPending(); } catch (_) {} finally { running = false; } };
  const initial = setTimeout(tick, 10000); initial.unref();
  const timer = setInterval(tick, 5 * 60 * 1000); timer.unref();
  return () => { clearTimeout(initial); clearInterval(timer); };
}
module.exports = { startReconciler, CONFIG_FILE, PROVIDER, loadConfig, createService, defaultService, sign, validateQuery };
