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
const { requireCustomerSession, resolveOwnedClientId } = require('./services/customer-session');
const { trackEvent } = require('./services/events');
const { uploadMiddleware, normalizeUpload, getUploadRoot } = require('./services/uploads');
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
app.use(express.json({ limit: '512kb' }));
app.use('/uploads', express.static(getUploadRoot()));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'geogi-mini-program-server',
    businessAuthority: 'GeoGi OS',
    deliveryContract: 'DeliveryPackage/2.0.0',
    customerSessionBoundary: 'signed-phone-session-v1',
    postSubmitSupplement: 'customer-supplement-v1',
    osOperationsBridge: osBridgeConfigured() ? 'configured' : 'not_configured'
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
  if (error && typeof error.code === 'string' && error.code.startsWith('DELIVERY_')) {
    return res.status(400).json({ ok: false, error: error.code });
  }
  console.error('Unhandled server error', error);
  return res.status(500).json({ ok: false, userMessage: '服务暂时不可用' });
});

app.listen(port, host, () => {
  console.log(`GeoGi mini program server listening on http://${host}:${port}`);
});
