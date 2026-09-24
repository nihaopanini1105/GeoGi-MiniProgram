require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { submitIntake } = require('./services/os-intake');
const { submitCustomerSupplement } = require('./services/customer-supplement');
const { getResearchArticles, getResearchArticle } = require('./services/research');
const { getConfig } = require('./services/config');
const { getSampleReport } = require('./services/sample-report');
const { listCustomerProjects, getCustomerReport } = require('./services/customer-portal');
const { getPhoneNumber } = require('./services/wechat-auth');
const {
  createCustomerPayment,
  getCustomerPayment,
  syncCustomerPayment,
  cancelCustomerPayment,
  listPaymentsForOs,
  refundPaymentForOs,
  projectPaymentProjection
} = require('./services/payment-service');
const {
  WechatPayError,
  configStatus: wechatPayConfigStatus,
  handlePaymentNotification,
  handleRefundNotification
} = require('./services/wechat-pay');
const { requireCustomerSession, resolveOwnedClientId } = require('./services/customer-session');
const { trackEvent } = require('./services/events');
const { notificationConfigured } = require('./services/ops-notifications');
const {
  quoteRedemptionCode,
  channelDashboardForPhone,
  channelAdminDashboard,
  upsertChannel,
  settleChannelPeriod,
  reconcileCommission
} = require('./services/channel-service');
const { uploadMiddleware, normalizeUpload, getUploadRoot } = require('./services/uploads');
const { DELIVERY_CONTRACT_VERSION } = require('./services/delivery-package-store');
const { OsArtifactIngressError, admitOsArtifact } = require('./services/os-artifact-ingress');
const {
  OperationsBridgeError,
  configured: osBridgeConfigured,
  requireOsBridge,
  listOsIntakes,
  updateOsProjectStage,
  publishOsDeliveryPackage
} = require('./services/os-operations-bridge');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.use(helmet());
app.use(express.json({
  limit: '512kb',
  verify: (req, _res, buffer) => {
    req.rawBody = Buffer.from(buffer || '');
  }
}));
app.use('/uploads', express.static(getUploadRoot()));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'geogi-mini-program-server',
    businessAuthority: 'GeoGi OS',
    deliveryContract: `DeliveryPackage/${DELIVERY_CONTRACT_VERSION}`,
    customerSessionBoundary: 'signed-phone-session-v1',
    postSubmitSupplement: 'customer-supplement-v1',
    osOperationsBridge: osBridgeConfigured() ? 'configured' : 'not_configured',
    diagnosticProduct: { name: 'GeoGi 品牌 GEO 诊断报告', priceYuan: 199, currency: 'CNY' },
    wechatPay: wechatPayConfigStatus().configured ? 'configured' : 'not_configured',
    feishuNotification: notificationConfigured() ? 'configured' : 'not_configured'
  });
});

app.get('/api/config', (_req, res) => res.json(getConfig()));

app.post('/api/redemption/quote', requireCustomerSession, async (req, res, next) => {
  try {
    const result = await quoteRedemptionCode(req.body && req.body.code);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/customer/channel-dashboard', requireCustomerSession, async (req, res, next) => {
  try {
    const result = await channelDashboardForPhone(req.customerSession.phoneNumber);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get(['/api/articles', '/api/research/articles'], async (req, res) => {
  const result = await getResearchArticles(req.query || {});
  res.status(result.ok ? 200 : 500).json(result);
});

app.get('/api/articles/:id', async (req, res) => {
  const result = await getResearchArticle(req.params.id);
  res.status(result.ok ? 200 : 404).json(result);
});

app.get('/api/sample-report', (_req, res) => res.json(getSampleReport()));

app.get('/api/customer/projects', requireCustomerSession, async (req, res) => {
  const clientId = await resolveOwnedClientId({
    phoneNumber: req.customerSession.phoneNumber,
    requestedClientId: req.query && req.query.clientId
  });
  if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
  const result = await listCustomerProjects({ clientId });
  return res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/customer/reports/:projectId', requireCustomerSession, async (req, res) => {
  const clientId = await resolveOwnedClientId({
    phoneNumber: req.customerSession.phoneNumber,
    requestedClientId: req.query && req.query.clientId
  });
  if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
  const result = await getCustomerReport({ clientId, projectId: req.params.projectId });
  return res.status(result.ok ? 200 : 404).json(result);
});

app.post('/api/customer/projects/:projectId/supplement', requireCustomerSession, async (req, res) => {
  const requestedClientId = req.body && req.body.clientId;
  const clientId = await resolveOwnedClientId({
    phoneNumber: req.customerSession.phoneNumber,
    requestedClientId
  });
  if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });

  const result = await submitCustomerSupplement({
    ...(req.body || {}),
    clientId,
    projectId: req.params.projectId
  });
  return res.status(result.ok ? 200 : 400).json(result);
});

app.post(['/api/leads', '/api/diagnosis/submit'], requireCustomerSession, async (req, res, next) => {
  try {
    const body = req.body || {};
    const form = { ...(body.form || {}), contactMethod: req.customerSession.phoneNumber };
    const result = await submitIntake({ ...body, form });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return next(error);
  }
});


app.get('/api/customer/projects/:projectId/payment', requireCustomerSession, async (req, res, next) => {
  try {
    const clientId = await resolveOwnedClientId({
      phoneNumber: req.customerSession.phoneNumber,
      requestedClientId: req.query && req.query.clientId
    });
    if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
    const result = await getCustomerPayment({ clientId, projectId: req.params.projectId });
    return res.status(result.ok ? 200 : 404).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/customer/projects/:projectId/payment', requireCustomerSession, async (req, res, next) => {
  try {
    const clientId = await resolveOwnedClientId({
      phoneNumber: req.customerSession.phoneNumber,
      requestedClientId: req.body && req.body.clientId
    });
    if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
    const result = await createCustomerPayment({
      clientId,
      projectId: req.params.projectId,
      phoneNumber: req.customerSession.phoneNumber,
      loginCode: req.body && req.body.loginCode
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/customer/projects/:projectId/payment/sync', requireCustomerSession, async (req, res, next) => {
  try {
    const clientId = await resolveOwnedClientId({
      phoneNumber: req.customerSession.phoneNumber,
      requestedClientId: req.body && req.body.clientId
    });
    if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
    const result = await syncCustomerPayment({ clientId, projectId: req.params.projectId });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/customer/projects/:projectId/payment/cancel', requireCustomerSession, async (req, res, next) => {
  try {
    const clientId = await resolveOwnedClientId({
      phoneNumber: req.customerSession.phoneNumber,
      requestedClientId: req.body && req.body.clientId
    });
    if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
    const result = await cancelCustomerPayment({
      clientId,
      projectId: req.params.projectId
    });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/payments/wechat/notify', async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const order = await handlePaymentNotification(req.headers, rawBody);
    await projectPaymentProjection({ projectId: order.projectId, paymentStatus: order.status });
    return res.status(200).json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/payments/wechat/refund-notify', async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const order = await handleRefundNotification(req.headers, rawBody);
    await projectPaymentProjection({ projectId: order.projectId, paymentStatus: order.status });
    await reconcileCommission({ order });
    return res.status(200).json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/wechat/phone', async (req, res) => {
  const result = await getPhoneNumber(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/uploads', requireCustomerSession, (req, res) => {
  uploadMiddleware(req, res, (error) => {
    if (error) {
      res.status(400).json({
        ok: false,
        userMessage: error.message === 'FILE_TYPE_NOT_ALLOWED' ? '文件类型不支持' : '上传失败，请稍后重试'
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ ok: false, userMessage: '请选择要上传的文件' });
      return;
    }
    res.json(normalizeUpload(req.file));
  });
});

app.post('/api/events', (req, res) => res.json(trackEvent(req.body || {})));

// Internal OS boundary: never exposed as customer business authority.
app.get('/internal/os/channels', requireOsBridge, async (_req, res, next) => {
  try {
    const result = await channelAdminDashboard();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

app.post('/internal/os/channels', requireOsBridge, async (req, res, next) => {
  try {
    const channel = await upsertChannel(req.body || {});
    return res.json({ ok: true, channel });
  } catch (error) {
    return next(error);
  }
});

app.post('/internal/os/channels/:channelId/settlements/:period', requireOsBridge, async (req, res, next) => {
  try {
    const result = await settleChannelPeriod({
      channelId: req.params.channelId,
      period: req.params.period,
      operatorId: req.body && req.body.operatorId,
      payoutReference: req.body && req.body.payoutReference
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

app.get('/internal/os/payments', requireOsBridge, async (_req, res, next) => {
  try {
    const result = await listPaymentsForOs();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

app.post('/internal/os/payments/:outTradeNo/refund', requireOsBridge, async (req, res, next) => {
  try {
    const result = await refundPaymentForOs({
      outTradeNo: req.params.outTradeNo,
      amountFen: req.body && req.body.amountFen,
      reason: req.body && req.body.reason,
      operatorId: req.body && req.body.operatorId
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

app.get('/internal/os/intakes', requireOsBridge, async (_req, res, next) => {
  try {
    const items = await listOsIntakes();
    res.json({ ok: true, items });
  } catch (error) {
    next(error);
  }
});

app.post('/internal/os/projects/:projectId/stage', requireOsBridge, async (req, res, next) => {
  try {
    const result = await updateOsProjectStage({
      projectId: req.params.projectId,
      stage: req.body && req.body.stage
    });
    res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post(
  '/internal/os/artifacts',
  requireOsBridge,
  express.raw({ type: 'application/octet-stream', limit: '25mb' }),
  (req, res, next) => {
    try {
      const result = admitOsArtifact({
        body: req.body,
        fileName: req.headers['x-geogi-artifact-filename'],
        expectedSha256: req.headers['x-geogi-artifact-sha256'],
        expectedSize: req.headers['x-geogi-artifact-size'],
        mimeType: req.headers['x-geogi-artifact-mime-type']
      });
      res.json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  }
);

app.post('/internal/os/delivery-packages', requireOsBridge, async (req, res, next) => {
  try {
    const result = await publishOsDeliveryPackage(req.body || {});
    res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof OperationsBridgeError) {
    const status = error.code === 'OS_BRIDGE_PROJECT_NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ ok: false, error: error.code });
  }
  if (error instanceof WechatPayError || (error && typeof error.code === 'string' && (error.code.startsWith('WECHAT_') || error.code.startsWith('PAYMENT_') || error.code.startsWith('REFUND_')))) {
    const code = error.code || 'WECHAT_PAY_ERROR';
    const unavailable = code === 'WECHAT_PAY_NOT_CONFIGURED';
    const paymentMessages = {
      PAYMENT_ORDER_EXPIRED: '支付订单已超过 30 分钟有效期，请重新发起支付',
      PAYMENT_ORDER_CLOSED: '支付订单已关闭，请重新发起支付',
      PAYMENT_ORDER_NOT_CANCELLABLE: '订单已付款或正在退款，不能取消'
    };
    return res.status(unavailable ? 503 : 400).json({
      ok: false,
      error: code,
      userMessage: unavailable
        ? '微信支付暂未完成配置，请稍后再试'
        : (paymentMessages[code] || '支付处理失败，请稍后重试')
    });
  }
  const channelErrorCode = error && String(error.code || error.message || '');
  if (channelErrorCode.startsWith('CHANNEL_')) {
    const messages = {
      CHANNEL_CODE_NOT_FOUND: '兑换码不存在，请检查后重试',
      CHANNEL_CODE_INACTIVE: '该兑换码当前不可使用',
      CHANNEL_CODE_NOT_STARTED: '该兑换码尚未生效',
      CHANNEL_CODE_EXPIRED: '该兑换码已过期',
      CHANNEL_CODE_INVALID: '兑换码格式不正确',
      CHANNEL_CODE_DUPLICATE: '该兑换码已被其他渠道使用',
      CHANNEL_NAME_REQUIRED: '请填写渠道名称',
      CHANNEL_DISCOUNT_RATE_INVALID: '渠道折扣设置不正确',
      CHANNEL_COMMISSION_RATE_INVALID: '返佣比例设置不正确',
      CHANNEL_EFFECTIVE_PERIOD_INVALID: '兑换码有效期设置不正确',
      CHANNEL_SETTLEMENT_NOTHING_DUE: '该渠道当月没有待结算返佣'
    };
    return res.status(400).json({
      ok: false,
      error: channelErrorCode,
      userMessage: messages[channelErrorCode] || '渠道规则处理失败，请检查设置'
    });
  }
  if (error instanceof OsArtifactIngressError) {
    return res.status(400).json({ ok: false, error: error.code });
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'OS_ARTIFACT_TOO_LARGE' });
  }
  if (error && typeof error.code === 'string' && error.code.startsWith('DELIVERY_')) {
    return res.status(400).json({ ok: false, error: error.code });
  }
  console.error('Unhandled server error', error);
  return res.status(500).json({ ok: false, userMessage: '服务暂时不可用' });
});

app.listen(port, host, () => {
  console.log(`GeoGi mini program server listening on http://${host}:${port}`);
});
