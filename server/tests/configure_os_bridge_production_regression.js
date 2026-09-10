const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  REQUIRED_BRIDGE_ENV,
  ensureBridgeToken
} = require('../src/scripts/configure-os-bridge-production');

function envBody(extra = '') {
  return [
    'FEISHU_APP_ID=cli_test',
    'FEISHU_APP_SECRET=secret_test',
    'FEISHU_BASE_APP_TOKEN=app_test',
    'FEISHU_LEADS_TABLE_ID=tbl_leads',
    'FEISHU_PROJECTS_TABLE_ID=tbl_projects',
    extra
  ].filter(Boolean).join('\n') + '\n';
}

function main() {
  assert.deepStrictEqual(REQUIRED_BRIDGE_ENV, [
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_BASE_APP_TOKEN',
    'FEISHU_LEADS_TABLE_ID',
    'FEISHU_PROJECTS_TABLE_ID'
  ]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-bridge-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, envBody(), 'utf8');

  const first = ensureBridgeToken({ envPath });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.bridgeTokenConfigured, true);
  assert.strictEqual(first.bridgeTokenGenerated, true);
  assert.strictEqual(first.envFileMode, '600');
  const afterFirst = fs.readFileSync(envPath, 'utf8');
  const tokenLine = afterFirst.split(/\r?\n/).find((line) => line.startsWith('GEOGI_OS_BRIDGE_TOKEN='));
  assert(tokenLine);
  const token = tokenLine.slice('GEOGI_OS_BRIDGE_TOKEN='.length);
  assert.strictEqual(token.length, 64);
  assert(/^[0-9a-f]{64}$/.test(token));

  const second = ensureBridgeToken({ envPath });
  assert.strictEqual(second.bridgeTokenGenerated, false);
  const afterSecond = fs.readFileSync(envPath, 'utf8');
  assert.strictEqual(afterSecond, afterFirst);

  const missingPath = path.join(dir, '.env-missing-dependency');
  fs.writeFileSync(missingPath, 'FEISHU_APP_ID=cli_test\n', 'utf8');
  assert.throws(
    () => ensureBridgeToken({ envPath: missingPath }),
    (error) => error && error.code === 'BRIDGE_DEPENDENCY_ENV_MISSING' && error.missing.includes('FEISHU_APP_SECRET')
  );

  console.log('configure-os-bridge-production-regression-ok');
}

main();
