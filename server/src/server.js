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
  WechatPayError,
  paymentConfiguration,
  paymentStats,
  createDiagnosticPayment,
  getDiagnosticPaymentStatus,
  handlePaymentNotification,
  handleRefundNotification,
  listPaymentRecords,
  requestFullRefund
} = require('./services/wechat-pay');
const { requireCustomerSession, resolveOwnedClientId } = require('./services/customer-session');
const { trackEvent } = require('./services/events');
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

app.post('/api/payments/wechat/notify', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  try {
    await handlePaymentNotification({ headers: req.headers, rawBody: req.body });
    res.status(200).json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    console.error('wechat payment notification failed', error);
    res.status(500).json({ code: 'FAIL', message: '处理失败' });
  }
});

app.post('/api/payments/wechat/refund-notify', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  try {
    await handleRefundNotification({ headers: req.headers, rawBody: req.body });
    res.status(200).json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    console.error('wechat refund notification failed', error);
    res.status(500).json({ code: 'FAIL', message: '处理失败' });
  }
});

app.use(express.json({ limit: '512kb' }));
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
    wechatPay: paymentConfiguration().configured ? 'configured' : 'not_configured',
    diagnosticProduct: { code: 'GEOGI_DIAGNOSTIC_REPORT_199', amountFen: 19900, amountYuan: '199.00' }
  });
});

app.get('/api/config', (_req, res) => res.json(getConfig()));

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

app.post(['/api/leads', '/api/diagnosis/submit'], requireCustomerSession, async (req, res) => {
  const body = req.body || {};
  const form = { ...(body.form || {}), contactMethod: req.customerSession.phoneNumber };
  const result = await submitIntake({ ...body, form });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/wechat/phone', async (req, res) => {
  const result = await getPhoneNumber(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/payments/create', requireCustomerSession, async (req, res, next) => {
  try {
    const requestedClientId = req.body && req.body.clientId;
    const projectId = String(req.body && req.body.projectId || '').trim();
    const clientId = await resolveOwnedClientId({
      phoneNumber: req.customerSession.phoneNumber,
      requestedClientId
    });
    if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
    if (!req.customerSession.openid) {
      return res.status(409).json({ ok: false, userMessage: '请重新授权手机号后再支付' });
    }
    const result = await createDiagnosticPayment({
      clientId,
      projectId,
      openid: req.customerSession.openid
    });
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/payments/status', requireCustomerSession, async (req, res, next) => {
  try {
    const requestedClientId = req.query && req.query.clientId;
    const projectId = String(req.query && req.query.projectId || '').trim();
    const clientId = await resolveOwnedClientId({
      phoneNumber: req.customerSession.phoneNumber,
      requestedClientId
    });
    if (!clientId) return res.status(404).json({ ok: false, userMessage: '没有找到该手机号名下的诊断记录' });
    const result = await getDiagnosticPaymentStatus({ clientId, projectId });
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
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
app.get('/internal/os/intakes', requireOsBridge, async (_req, res, next) => {
  try {
    const items = await listOsIntakes();
    res.json({ ok: true, items });
  } catch (error) {
    next(error);
  }
});

app.get('/internal/os/payments', requireOsBridge, async (_req, res, next) => {
  try {
    const items = await listPaymentRecords();
    res.json({ ok: true, items, stats: paymentStats(items) });
  } catch (error) {
    next(error);
  }
});

app.post('/internal/os/payments/:projectId/refund', requireOsBridge, async (req, res, next) => {
  try {
    const result = await requestFullRefund({
      projectId: req.params.projectId,
      reason: req.body && req.body.reason,
      requestedBy: req.body && req.body.requestedBy
    });
    res.json({ ok: true, result });
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
  if (error instanceof WechatPayError) {
    const status = error.code === 'PAYMENT_PROJECT_NOT_OWNED' || error.code === 'PAYMENT_REFUND_ORDER_NOT_FOUND'
      ? 404
      : (error.code === 'WECHAT_PAY_NOT_CONFIGURED' ? 503 : 400);
    return res.status(status).json({
      ok: false,
      error: error.code,
      userMessage: error.code === 'WECHAT_PAY_NOT_CONFIGURED'
        ? '微信支付暂未配置完成，请稍后再试'
        : (error.message || '支付处理失败，请稍后重试')
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
