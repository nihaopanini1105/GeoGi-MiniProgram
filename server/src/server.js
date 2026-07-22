require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { submitDiagnosis } = require('./services/diagnosis');
const { runWorkflowCommand } = require('./services/workflow-command');
const { getResearchArticles, getResearchArticle } = require('./services/research');
const { getConfig } = require('./services/config');
const { getSampleReport } = require('./services/sample-report');
const { trackEvent } = require('./services/events');
const { uploadMiddleware, normalizeUpload, getUploadRoot } = require('./services/uploads');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.use(helmet());
app.use(express.json({ limit: '512kb' }));
app.use('/uploads', express.static(getUploadRoot()));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'geogi-mini-program-server'
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

app.post(['/api/leads', '/api/diagnosis/submit'], async (req, res) => {
  const result = await submitDiagnosis(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/feishu/command', async (req, res) => {
  const result = await runWorkflowCommand(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/feishu/events', async (req, res) => {
  if (req.body && req.body.type === 'url_verification') {
    res.json({ challenge: req.body.challenge });
    return;
  }

  const event = req.body && (req.body.event || req.body);
  const text = event && event.message && event.message.content
    ? parseFeishuMessageText(event.message.content)
    : '';
  const result = await runWorkflowCommand({ text });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/uploads', (req, res) => {
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

function parseFeishuMessageText(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed.text || content;
  } catch (error) {
    return content || '';
  }
}

app.listen(port, host, () => {
  console.log(`GeoGi mini program server listening on http://${host}:${port}`);
});
