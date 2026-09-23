const fs = require('fs');
const path = require('path');

function parseEnv(raw) {
  const result = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const index = normalized.indexOf('=');
    if (index <= 0) continue;
    const key = normalized.slice(0, index).trim();
    let value = normalized.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadProductionEnv(options = {}) {
  const envPath = path.resolve(
    options.envPath
      || process.env.GEOGI_PRODUCTION_ENV_FILE
      || path.join(process.cwd(), '.env')
  );

  if (!fs.existsSync(envPath) || !fs.statSync(envPath).isFile()) {
    const error = new Error('PRODUCTION_ENV_FILE_MISSING');
    error.code = 'PRODUCTION_ENV_FILE_MISSING';
    error.envPath = envPath;
    throw error;
  }

  const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    ok: true,
    envPath,
    loadedKeyCount: Object.keys(parsed).length
  };
}

module.exports = {
  parseEnv,
  loadProductionEnv
};
