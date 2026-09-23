const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseEnv, loadProductionEnv } = require('../src/scripts/production-env');

const parsed = parseEnv([
  '# comment',
  'A=1',
  'export B="two"',
  "C='three'",
  'D=value=with=equals'
].join('\n'));

assert.deepStrictEqual(parsed, {
  A: '1',
  B: 'two',
  C: 'three',
  D: 'value=with=equals'
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-production-env-'));
const envPath = path.join(root, '.env');
fs.writeFileSync(envPath, [
  'GEOGI_TEST_FROM_FILE=loaded',
  'GEOGI_TEST_KEEP_EXISTING=file-value'
].join('\n') + '\n');

process.env.GEOGI_TEST_KEEP_EXISTING = 'shell-value';
delete process.env.GEOGI_TEST_FROM_FILE;

const result = loadProductionEnv({ envPath });
assert.strictEqual(result.ok, true);
assert.strictEqual(result.envPath, envPath);
assert.strictEqual(process.env.GEOGI_TEST_FROM_FILE, 'loaded');
assert.strictEqual(process.env.GEOGI_TEST_KEEP_EXISTING, 'shell-value');

assert.throws(
  () => loadProductionEnv({ envPath: path.join(root, 'missing.env') }),
  /PRODUCTION_ENV_FILE_MISSING/
);

delete process.env.GEOGI_TEST_FROM_FILE;
delete process.env.GEOGI_TEST_KEEP_EXISTING;
fs.rmSync(root, { recursive: true, force: true });

console.log('production-env-loader-regression-ok');
