const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REQUIRED_BRIDGE_ENV = Object.freeze([
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_BASE_APP_TOKEN',
  'FEISHU_LEADS_TABLE_ID',
  'FEISHU_PROJECTS_TABLE_ID'
]);

function upsertEnvLine(raw, key, value) {
  const lines = String(raw || '').split(/\r?\n/);
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index >= 0) lines[index] = `${prefix}${value}`;
  else lines.push(`${prefix}${value}`);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function ensureBridgeToken({ envPath }) {
  if (!envPath || !fs.existsSync(envPath)) {
    const error = new Error('PRODUCTION_ENV_FILE_MISSING');
    error.code = 'PRODUCTION_ENV_FILE_MISSING';
    throw error;
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(raw);
  const missing = REQUIRED_BRIDGE_ENV.filter((key) => !String(parsed[key] || '').trim());
  if (missing.length) {
    const error = new Error(`BRIDGE_DEPENDENCY_ENV_MISSING:${missing.join(',')}`);
    error.code = 'BRIDGE_DEPENDENCY_ENV_MISSING';
    error.missing = missing;
    throw error;
  }

  const existing = String(parsed.GEOGI_OS_BRIDGE_TOKEN || '').trim();
  let generated = false;
  if (!existing) {
    const token = crypto.randomBytes(32).toString('hex');
    const updated = upsertEnvLine(raw, 'GEOGI_OS_BRIDGE_TOKEN', token);
    fs.writeFileSync(envPath, updated, { encoding: 'utf8', mode: 0o600 });
    generated = true;
  }
  fs.chmodSync(envPath, 0o600);

  return {
    ok: true,
    bridgeTokenConfigured: true,
    bridgeTokenGenerated: generated,
    requiredDependencies: REQUIRED_BRIDGE_ENV,
    envFileMode: (fs.statSync(envPath).mode & 0o777).toString(8).padStart(3, '0')
  };
}

function main() {
  const envPath = path.resolve(process.env.GEOGI_PRODUCTION_ENV_FILE || path.join(__dirname, '../../.env'));
  try {
    const result = ensureBridgeToken({ envPath });
    process.stdout.write(`${JSON.stringify({ ...result, envPath }, null, 2)}\n`);
  } catch (error) {
    const payload = {
      ok: false,
      error: error.code || 'PRODUCTION_BRIDGE_CONFIGURATION_FAILED',
      missing: Array.isArray(error.missing) ? error.missing : []
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  REQUIRED_BRIDGE_ENV,
  upsertEnvLine,
  ensureBridgeToken
};
