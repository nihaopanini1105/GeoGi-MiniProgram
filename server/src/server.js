require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const { submitDiagnosis } = require('./services/diagnosis');
const { runWorkflowCommand } = require('./services/workflow-command');
const { getResearchArticles, getResearchArticle } = require('./services/research');
const { getConfig } = require('./services/config');
const { listCustomerProjects, getCustomerReport } = require('./services/customer-portal');
const { getPhoneNumber } = require('./services/wechat-auth');
const { getReportPath } = require('./services/report-pdf');
const { trackEvent } = require('./services/events');
const {
  uploadMiddleware,
  normalizeUpload,
  validateStoredUpload,
  registerUpload,
  bindUploadsToProject,
  listProjectUploads,
  getBoundUpload
} = require('./services/uploads');
const { verifyCustomerSession, getBearerToken, normalizePhone } = require('./services/customer-auth');
const { verifyCustomerAccess } = require('./services/customer-access');
const { rateLimit } = require('./services/rate-limit');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '512kb' }));

const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'public' });
const phoneLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: 'phone' });
const customerLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, keyPrefix: 'customer' });
const submitLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, keyPrefix: 'submit' });
const internalLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'internal' });

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'geogi-mini-program-server' });
});

app.get('/api/config', publicLimiter, (_req, res) => {
  res.json(getConfig());
});

app.get(['/api/articles', '/api/research/articles'], publicLimiter, async (req, res) => {
  const result = await getResearchArticles(req.query || {});
  res.status(result.ok ? 200 : 503).json(result);
});

app.get('/api/articles/:id', publicLimiter, async (req, res) => {
  const result = await getResearchArticle(req.params.id);
  res.status(result.ok ? 200 : 404).json(result);
});

app.post('/api/wechat/phone', phoneLimiter, async (req, res) => {
  const result = await getPhoneNumber(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.post(['/api/leads', '/api/diagnosis/submit'], submitLimiter, authenticateCustomer, async (req, res) => {
  const form = (req.body && req.body.form) || {};
  if (normalizePhone(form.contactMethod) !== req.customer.phoneNumber) {
    res.status(403).json({ ok: false, userMessage: '手机号与当前授权身份不一致，请重新授权' });
    return;
  }

  const result = await submitDiagnosis(req.body || {});
  if (!result.ok) {
    res.status(400).json({ ok: false, userMessage: publicDiagnosisError(result.userMessage) });
    return;
  }

  const binding = bindUploadsToProject(form.uploads, {
    phoneNumber: req.customer.phoneNumber,
    clientId: result.clientId,
    projectId: result.projectId
  });
  if (!binding.ok) {
    console.error('Upload binding incomplete', {
      projectId: result.projectId,
      rejected: binding.rejected
    });
  }

  res.json({
    ok: true,
    duplicated: Boolean(result.duplicated),
    clientId: result.clientId,
    projectId: result.projectId,
    status: '已提交',
    submittedAt: result.submittedAt
  });
});

app.post('/api/uploads', customerLimiter, authenticateCustomer, (req, res) => {
  uploadMiddleware(req, res, (error) => {
    if (error) {
      const tooLarge = error && error.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({
        ok: false,
        userMessage: error.message === 'FILE_TYPE_NOT_ALLOWED'
          ? '文件类型不支持'
          : (tooLarge ? '单个文件不能超过 20MB' : '上传失败，请稍后重试')
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({ ok: false, userMessage: '请选择要上传的文件' });
      return;
    }

    if (!validateStoredUpload(req.file)) {
      res.status(400).json({ ok: false, userMessage: '文件内容与文件类型不匹配，请重新选择文件' });
      return;
    }

    const registered = registerUpload(req.file, { phoneNumber: req.customer.phoneNumber });
    if (!registered) {
      res.status(500).json({ ok: false, userMessage: '文件保存失败，请稍后重试' });
      return;
    }

    res.json(normalizeUpload(req.file));
  });
});

app.get('/api/customer/projects', customerLimiter, authenticateCustomer, async (req, res) => {
  const clientId = String((req.query && req.query.clientId) || '').trim();
  const access = await verifyCustomerAccess({ phoneNumber: req.customer.phoneNumber, clientId });
  if (!access.ok) {
    res.status(403).json(access);
    return;
  }

  const result = await listCustomerProjects({ clientId });
  res.status(result.ok ? 200 : 400).json(sanitizeCustomerProjects(result, clientId));
});

app.get('/api/customer/reports/:projectId', customerLimiter, authenticateCustomer, async (req, res) => {
  const clientId = String((req.query && req.query.clientId) || '').trim();
  const projectId = String(req.params.projectId || '').trim();
  const access = await verifyCustomerAccess({ phoneNumber: req.customer.phoneNumber, clientId, projectId });
  if (!access.ok) {
    res.status(403).json(access);
    return;
  }

  const result = await getCustomerReport({ clientId, projectId });
  res.status(result.ok ? 200 : 404).json(sanitizeCustomerReport(result, clientId, projectId));
});

app.get('/api/customer/reports/:projectId/download', customerLimiter, authenticateCustomer, async (req, res) => {
  const clientId = String((req.query && req.query.clientId) || '').trim();
  const projectId = String(req.params.projectId || '').trim();
  const access = await verifyCustomerAccess({ phoneNumber: req.customer.phoneNumber, clientId, projectId });
  if (!access.ok) {
    res.status(403).json(access);
    return;
  }

  const reportResult = await getCustomerReport({ clientId, projectId });
  if (!reportResult.ok || !reportResult.order || !reportResult.order.reportReady) {
    res.status(404).json({ ok: false, userMessage: '正式报告尚未发布' });
    return;
  }

  const reportPath = getReportPath(projectId);
  if (!reportPath || !fs.existsSync(reportPath)) {
    res.status(404).json({ ok: false, userMessage: 'PDF 报告暂时不可用' });
    return;
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.download(reportPath, 'GeoGi-diagnosis-report.pdf');
});

app.get('/api/internal/projects/:projectId/uploads', internalLimiter, requireAdminSecret, (req, res) => {
  const projectId = String(req.params.projectId || '').trim();
  res.json({ ok: true, items: listProjectUploads(projectId) });
});

app.get('/api/internal/uploads/:fileId/download', internalLimiter, requireAdminSecret, (req, res) => {
  const stored = getBoundUpload(req.params.fileId);
  if (!stored) {
    res.status(404).json({ ok: false, userMessage: '附件不存在或尚未绑定项目' });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.download(stored.path, stored.metadata.name || 'GeoGi-customer-upload');
});

app.post('/api/feishu/command', internalLimiter, requireAdminSecret, async (req, res) => {
  const result = await runWorkflowCommand(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/feishu/events', internalLimiter, requireFeishuVerificationToken, async (req, res) => {
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

app.post('/api/events', publicLimiter, (req, res) => {
  res.json(trackEvent(req.body || {}));
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error', error);
  res.status(500).json({ ok: false, userMessage: '服务暂时不可用' });
});

function authenticateCustomer(req, res, next) {
  const result = verifyCustomerSession(getBearerToken(req));
  if (!result.ok) {
    const unavailable = result.reason === 'SESSION_SECRET_MISSING';
    res.status(unavailable ? 503 : 401).json({
      ok: false,
      userMessage: unavailable ? '客户身份服务暂时不可用' : '身份验证已失效，请重新授权手机号'
    });
    return;
  }
  req.customer = result.customer;
  next();
}

function requireAdminSecret(req, res, next) {
  const expected = String(process.env.ADMIN_COMMAND_SECRET || '').trim();
  if (!expected) {
    res.status(503).json({ ok: false, userMessage: '内部命令服务未启用' });
    return;
  }
  const supplied = String(req.headers['x-geogi-admin-secret'] || getBearerToken(req) || '').trim();
  if (!safeSecretEqual(supplied, expected)) {
    res.status(403).json({ ok: false, userMessage: '禁止访问' });
    return;
  }
  next();
}

function requireFeishuVerificationToken(req, res, next) {
  const expected = String(process.env.FEISHU_EVENT_VERIFICATION_TOKEN || '').trim();
  if (!expected) {
    res.status(503).json({ ok: false, userMessage: '事件回调服务未启用' });
    return;
  }
  const body = req.body || {};
  const supplied = String((body.header && body.header.token) || body.token || '').trim();
  if (!safeSecretEqual(supplied, expected)) {
    res.status(403).json({ ok: false, userMessage: '禁止访问' });
    return;
  }
  next();
}

function safeSecretEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function protectedReportUrl(projectId, clientId) {
  if (!projectId || !clientId) return '';
  return `/api/customer/reports/${encodeURIComponent(projectId)}/download?clientId=${encodeURIComponent(clientId)}`;
}

function sanitizeCustomerProjects(result, clientId) {
  if (!result || !result.ok) return result;
  return {
    ...result,
    orders: (result.orders || []).map((order) => ({
      ...order,
      reportLink: order.reportReady ? protectedReportUrl(order.projectId, clientId) : ''
    }))
  };
}

function sanitizeCustomerReport(result, clientId, projectId) {
  if (!result || !result.ok) return result;
  const link = result.order && result.order.reportReady ? protectedReportUrl(projectId, clientId) : '';
  return {
    ...result,
    order: result.order ? { ...result.order, reportLink: link } : result.order,
    report: result.report ? { ...result.report, reportLink: link } : result.report
  };
}

function publicDiagnosisError(message) {
  const value = String(message || '');
  if (/FEISHU_|配置|table|token|secret|app/i.test(value)) {
    console.error('Diagnosis service configuration error:', value);
    return '诊断服务暂时不可用，请稍后再试';
  }
  return value || '提交失败，请稍后重试';
}

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
