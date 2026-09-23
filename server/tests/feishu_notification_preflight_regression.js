const assert = require('assert');

delete process.env.FEISHU_NOTIFY_WEBHOOK;
delete process.env.FEISHU_NOTIFY_RECEIVE_ID;
delete process.env.FEISHU_APP_ID;
delete process.env.FEISHU_APP_SECRET;

const { verifyProductionNotificationConfig } = require('../src/scripts/verify-feishu-notification-production');

assert.throws(
  () => verifyProductionNotificationConfig(),
  /FEISHU_NOTIFICATION_NOT_CONFIGURED/
);

process.env.FEISHU_NOTIFY_WEBHOOK = 'http://open.feishu.cn/open-apis/bot/v2/hook/test';
assert.throws(
  () => verifyProductionNotificationConfig(),
  /FEISHU_NOTIFY_WEBHOOK_INVALID/
);

process.env.FEISHU_NOTIFY_WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/test';
process.env.FEISHU_NOTIFY_SECRET = 'secret';
let result = verifyProductionNotificationConfig();
assert.strictEqual(result.ok, true);
assert.strictEqual(result.channel, 'webhook');
assert.strictEqual(result.signedWebhook, true);

delete process.env.FEISHU_NOTIFY_WEBHOOK;
delete process.env.FEISHU_NOTIFY_SECRET;
process.env.FEISHU_NOTIFY_RECEIVE_ID = 'ou_test';
assert.throws(
  () => verifyProductionNotificationConfig(),
  /FEISHU_BOT_ENV_MISSING/
);

process.env.FEISHU_APP_ID = 'cli_test';
process.env.FEISHU_APP_SECRET = 'app-secret';
result = verifyProductionNotificationConfig();
assert.strictEqual(result.ok, true);
assert.strictEqual(result.channel, 'bot');

console.log('feishu-notification-preflight-regression-ok');
