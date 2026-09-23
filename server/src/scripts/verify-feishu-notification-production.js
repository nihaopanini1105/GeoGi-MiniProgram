const { notificationConfigured } = require('../services/ops-notifications');

function loadDotenvForCli() {
  try {
    require('dotenv').config();
  } catch (error) {
    if (!error || error.code !== 'MODULE_NOT_FOUND') throw error;
  }
}

function verifyProductionNotificationConfig() {
  if (!notificationConfigured()) {
    const error = new Error('FEISHU_NOTIFICATION_NOT_CONFIGURED');
    error.code = 'FEISHU_NOTIFICATION_NOT_CONFIGURED';
    throw error;
  }

  const webhook = String(process.env.FEISHU_NOTIFY_WEBHOOK || '').trim();
  const receiveId = String(process.env.FEISHU_NOTIFY_RECEIVE_ID || '').trim();

  if (webhook) {
    let url;
    try {
      url = new URL(webhook);
    } catch (error) {
      const invalid = new Error('FEISHU_NOTIFY_WEBHOOK_INVALID');
      invalid.code = 'FEISHU_NOTIFY_WEBHOOK_INVALID';
      throw invalid;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'open.feishu.cn') {
      const invalid = new Error('FEISHU_NOTIFY_WEBHOOK_INVALID');
      invalid.code = 'FEISHU_NOTIFY_WEBHOOK_INVALID';
      throw invalid;
    }
    return {
      ok: true,
      channel: 'webhook',
      webhookHost: url.hostname,
      signedWebhook: Boolean(String(process.env.FEISHU_NOTIFY_SECRET || '').trim()),
      opsUrl: String(process.env.GEOGI_OPS_URL || 'https://ops.geogi.cn').trim()
    };
  }

  if (receiveId) {
    const missing = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'].filter(
      (name) => !String(process.env[name] || '').trim()
    );
    if (missing.length) {
      const error = new Error('FEISHU_BOT_ENV_MISSING:' + missing.join(','));
      error.code = 'FEISHU_BOT_ENV_MISSING';
      error.missing = missing;
      throw error;
    }
    return {
      ok: true,
      channel: 'bot',
      receiveIdType: String(process.env.FEISHU_NOTIFY_RECEIVE_ID_TYPE || 'open_id').trim(),
      opsUrl: String(process.env.GEOGI_OPS_URL || 'https://ops.geogi.cn').trim()
    };
  }

  const error = new Error('FEISHU_NOTIFICATION_NOT_CONFIGURED');
  error.code = 'FEISHU_NOTIFICATION_NOT_CONFIGURED';
  throw error;
}

function main() {
  try {
    loadDotenvForCli();
    process.stdout.write(JSON.stringify(verifyProductionNotificationConfig(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      error: error.code || 'FEISHU_NOTIFICATION_PREFLIGHT_FAILED',
      detail: String(error.message || error),
      missing: Array.isArray(error.missing) ? error.missing : []
    }, null, 2) + '\n');
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { verifyProductionNotificationConfig };
