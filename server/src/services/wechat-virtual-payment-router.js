'use strict';
const express = require('express');
const { requireCustomerSession, resolveOwnedClientId } = require('./customer-session');
const payments = require('./payment-store');
const virtual = require('./wechat-virtual-payment');
function createRouter(options = {}) {
  const payments = options.payments || require('./payment-store');
  const authenticate = options.authenticate || requireCustomerSession;
  const resolveClient = options.resolveClient || resolveOwnedClientId;
  const getReport = options.getReport || ((scope) => require('./customer-portal').getCustomerReport(scope));
  const ensure = options.ensureOrder || ((scope) => require('./payment-service').ensureOrder(scope));
  const service = options.service || virtual.defaultService();
  const router = express.Router();
  const parse = express.json({ limit: '16kb' });
  function error(res, e) {
    const code = e && e.code || 'PAYMENT_VIRTUAL_UNAVAILABLE';
    const messages = {
      PAYMENT_VIRTUAL_NOT_READY: '支付功能正在完成配置，请稍后再试',
      PAYMENT_VIRTUAL_IOS_NOT_READY: '当前终端支付暂未开放，请稍后再试',
      PAYMENT_VIRTUAL_PREVIOUS_ATTEMPT_PENDING: '上一笔付款结果尚待确认，请稍后刷新订单',
      PAYMENT_VIRTUAL_LEGACY_PENDING: '已有付款订单尚待确认，请稍后刷新订单',
      PAYMENT_VIRTUAL_TERMINAL_ORDER: '该付款订单当前不可支付，请刷新订单',
      PAYMENT_VIRTUAL_DUPLICATE_PAID_REVIEW: '付款需要人工核对，请联系客户服务'
    };
    return res.status(400).json({ ok: false, error: code, userMessage: messages[code] || '支付状态暂时无法确认，请稍后再试' });
  }
  async function scope(req, res) {
    const clientId = await resolveClient({ phoneNumber: req.customerSession.phoneNumber, requestedClientId: req.body && req.body.clientId });
    if (!clientId) { res.status(404).json({ ok: false, userMessage: '没有找到诊断订单' }); return null; }
    const order = await payments.findPaymentByProject(req.params.projectId);
    if (order && order.clientId !== clientId) { res.status(404).json({ ok: false, userMessage: '没有找到诊断订单' }); return null; }
    return { clientId, order };
  }
  router.post('/api/customer/projects/:projectId/payment', parse, authenticate, async (req, res, next) => {
    if (!req.body || req.body.paymentChannel !== 'virtual') return res.status(409).json({ ok: false, code: 'PAYMENT_CLIENT_UPDATE_REQUIRED', userMessage: '请更新小程序后再发起付款' });
    try {
      const owned = await scope(req, res); if (!owned) return;
      const report = await getReport({ clientId: owned.clientId, projectId: req.params.projectId });
      if (!report || report.ok !== true) return res.status(503).json({ ok: false, userMessage: '订单授权状态暂时无法确认，请稍后重试' });
      if (report.report && (report.report.reportReady || report.report.pilotReviewAccess)) return res.status(409).json({ ok: false, code: 'REPORT_ALREADY_AUTHORIZED', userMessage: '诊断报告已获授权，请到「我的」查看，无需再次付款' });
      const order = await ensure({ clientId: owned.clientId, projectId: req.params.projectId, phoneNumber: req.customerSession.phoneNumber });
      if (order.clientId !== owned.clientId || order.projectId !== req.params.projectId) throw new Error('scope');
      const result = await service.create(order, req.body.loginCode, req.body.clientPlatform);
      return res.json({ ok: true, payment: payments.publicPaymentView(result.order), paymentChannel: 'virtual',
        payParams: result.payParams || null, alreadyPaid: result.alreadyPaid === true,
        product: { name: payments.PRODUCT_NAME, priceYuan: 199, payableYuan: order.amountTotal / 100, amountTotal: order.amountTotal, currency: 'CNY' } });
    } catch (e) { return error(res, e); }
  });
  router.post('/api/customer/projects/:projectId/payment/sync', parse, authenticate, async (req, res, next) => {
    try {
      const owned = await scope(req, res); if (!owned) return;
      if (!owned.order || owned.order.provider !== virtual.PROVIDER) return next();
      return res.json({ ok: true, payment: payments.publicPaymentView(await service.sync(owned.order)) });
    } catch (e) { return error(res, e); }
  });
  router.post('/api/customer/projects/:projectId/payment/cancel', parse, authenticate, async (req, res, next) => {
    try {
      const owned = await scope(req, res); if (!owned) return;
      if (!owned.order || owned.order.provider !== virtual.PROVIDER) return next();
      return res.status(400).json({ ok: false, userMessage: '付款结果确认期间无法关闭订单，请稍后刷新' });
    } catch (e) { return error(res, e); }
  });
  return router;
}
module.exports = { createRouter };
