require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { submitDiagnosis } = require('./services/diagnosis');
const { getResearchArticles } = require('./services/research');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'geogi-mini-program-server'
  });
});

app.post('/api/diagnosis/submit', async (req, res) => {
  const result = await submitDiagnosis(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/research/articles', async (req, res) => {
  const result = await getResearchArticles(req.query || {});
  res.status(result.ok ? 200 : 500).json(result);
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error', error);
  res.status(500).json({
    ok: false,
    userMessage: '服务暂时不可用'
  });
});

app.listen(port, () => {
  console.log(`GeoGi mini program server listening on ${port}`);
});
