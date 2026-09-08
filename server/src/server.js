require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { submitCustomerIntake } = require('./services/customer-intake');
const { getResearchArticles, getResearchArticle } = require('./services/research');
const { getConfig } = require('./services/config');
const { getSampleReport } = require('./services/sample-report');
const { listCustomerProjects, getCustomerReport } = require('./services/customer-portal');
const { getPhoneNumber } = require('./services/wechat-auth');
const { authenticateCustomer } = require('./services/customer-auth');
const { getArtifactRoot } = require('./services/delivery-package-store');
const { trackEvent } = require('./services/events');
const { uploadMiddleware, normalizeUpload, getUploadRoot } = require('./services/uploads');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.use(helmet());
app.use(express.json({ limit: '512kb' }));
app.use('/uploads', express.static(getUploadRoot()));
app.use('/delivery', express.static(getArtifactRoot(), {
  fallthrough: false,
  immutable: true,
  maxAge: '1h'
}));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'geogi-mini-program-server',
    role: 'customer-intake-and-display',
    intelligenceAuthority: 'GeoGi-OS'
  });
});

app.get('/api/config', (_req, res) => {
  res.json(getConfig());
});

app.get(['/api/articles', '/api/research/articles'], async (req, res) => {
  const result = await getResearchArticles(req.query || {});
  res.status(result.ok ? 200 : 500).json(result);
});

app.get('/api/articles/:id', async (req, res) => {
  const result = await getResearchArticle(req.params.id);
  res.status(result.ok ? 200 : 404).json(result);
});

app.get('/api/sample-report', (_req, res) => {
  res.json(getSampleReport());
});

app.post('/api/wechat/phone', async (req, res) => {
  const result = await getPhoneNumber(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/customer/projects', authenticateCustomer, async (req, res) => {
  const result = await listCustomerProjects({
    ...(req.query || {}),
    customer: req.customer
  });
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/customer/reports/:projectId', authenticateCustomer, async (req, res) => {
  const result = await getCustomerReport({
    clientId: req.query && req.query.clientId,
    projectId: req.params.projectId,
    customer: req.customer
  });
  res.status(result.ok ? 200 : 404).json(result);
});

app.post(['/api/leads', '/api/diagnosis/submit'], authenticateCustomer, async (req, res) => {
  const result = await submitCustomerIntake(req.body || {}, req.customer);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/uploads', authenticateCustomer, (req, res) => {
  uploadMiddleware(req, res, (error) => {
    if (error) {
      res.status(400).json({
        ok: false,
        userMessage: error.message === 'FILE_TYPE_NOT_ALLOWED' ? '文件类型不支持' : '上传失败，请稍后重试'
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({
        ok: false,
        userMessage: '请选择要上传的文件'
      });
      return;
    }

    res.json(normalizeUpload(req.file));
  });
});

app.post('/api/events', (req, res) => {
  res.json(trackEvent(req.body || {}));
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error', error);
  res.status(500).json({
    ok: false,
    userMessage: '服务暂时不可用'
  });
});

app.listen(port, host, () => {
  console.log(`GeoGi mini program server listening on http://${host}:${port}`);
});
