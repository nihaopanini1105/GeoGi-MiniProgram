const fs = require('fs');
const path = require('path');
const { configStatus } = require('../services/wechat-pay');
const { loadProductionEnv } = require('./production-env');

function assertHttps(name, value) {
  const text = String(value || '').trim();
  if (!/^https:\/\//i.test(text)) {
    const error = new Error(name + '_MUST_USE_HTTPS');
    error.code = name + '_MUST_USE_HTTPS';
    throw error;
  }
}

function assertReadableFile(name, value) {
  const filePath = path.resolve(String(value || '').trim());
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const error = new Error(name + '_FILE_MISSING');
    error.code = name + '_FILE_MISSING';
    throw error;
  }
  fs.accessSync(filePath, fs.constants.R_OK);
  return filePath;
}

function verifyProductionPaymentConfig() {
  const status = configStatus();
  if (!status.configured) {
    const error = new Error('WECHAT_PAY_ENV_MISSING:' + status.missing.join(','));
    error.code = 'WECHAT_PAY_ENV_MISSING';
    error.missing = status.missing;
    throw error;
  }

  const config = status.config;
  if (!/^wx[a-zA-Z0-9_-]+$/.test(String(config.appid || ''))) {
    const error = new Error('WECHAT_APP_ID_INVALID');
    error.code = 'WECHAT_APP_ID_INVALID';
    throw error;
  }
  const projectConfigPath = path.resolve(__dirname, '../../../project.config.json');
  if (fs.existsSync(projectConfigPath)) {
    const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
    const projectAppid = String(projectConfig.appid || '').trim();
    if (projectAppid && projectAppid !== String(config.appid || '')) {
      const error = new Error('WECHAT_APP_ID_DOES_NOT_MATCH_MINIPROGRAM_PROJECT');
      error.code = 'WECHAT_APP_ID_DOES_NOT_MATCH_MINIPROGRAM_PROJECT';
      throw error;
    }
  }
  if (!/^\d{6,32}$/.test(String(config.mchid || ''))) {
    const error = new Error('WECHATPAY_MCH_ID_INVALID');
    error.code = 'WECHATPAY_MCH_ID_INVALID';
    throw error;
  }
  if (Buffer.byteLength(String(config.apiV3Key || ''), 'utf8') !== 32) {
    const error = new Error('WECHATPAY_API_V3_KEY_INVALID');
    error.code = 'WECHATPAY_API_V3_KEY_INVALID';
    throw error;
  }

  assertHttps('WECHATPAY_NOTIFY_URL', config.notifyUrl);
  assertHttps('WECHATPAY_REFUND_NOTIFY_URL', config.refundNotifyUrl);
  const privateKeyPath = assertReadableFile('WECHATPAY_PRIVATE_KEY_PATH', config.privateKeyPath);
  const platformPublicKeyPath = assertReadableFile('WECHATPAY_PLATFORM_PUBLIC_KEY_PATH', config.platformPublicKeyPath);

  const paymentRoot = path.resolve(
    process.env.GEOGI_PAYMENT_DATA_ROOT
      || path.join(__dirname, '../../data/payments')
  );
  fs.mkdirSync(paymentRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(paymentRoot, 0o700);
  fs.accessSync(paymentRoot, fs.constants.R_OK | fs.constants.W_OK);

  return {
    ok: true,
    appidConfigured: true,
    appidMatchesMiniProgramProject: true,
    merchantConfigured: true,
    merchantSerialConfigured: Boolean(config.merchantSerialNo),
    platformSerialConfigured: Boolean(config.platformSerialNo),
    privateKeyReadable: Boolean(privateKeyPath),
    platformPublicKeyReadable: Boolean(platformPublicKeyPath),
    notifyUrl: config.notifyUrl,
    refundNotifyUrl: config.refundNotifyUrl,
    paymentRoot,
    fixedProduct: {
      code: 'diagnostic_report_199',
      amountFen: 19900,
      amountYuan: 199,
      currency: 'CNY'
    }
  };
}

function main() {
  try {
    loadProductionEnv();
    process.stdout.write(JSON.stringify(verifyProductionPaymentConfig(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      error: error.code || 'WECHAT_PAY_PRODUCTION_PREFLIGHT_FAILED',
      detail: String(error.message || error),
      missing: Array.isArray(error.missing) ? error.missing : []
    }, null, 2) + '\n');
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { verifyProductionPaymentConfig };
