const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  isRetriableBitableResult,
  bitableRetryDelayMs
} = require('../src/services/feishu');

function main() {
  assert.strictEqual(isRetriableBitableResult({ code: 1254607 }), true);
  assert.strictEqual(isRetriableBitableResult({ code: '1254607' }), true);
  assert.strictEqual(isRetriableBitableResult({ code: 0 }), false);
  assert.strictEqual(isRetriableBitableResult({ code: 999999 }), false);

  const prior = process.env.FEISHU_BITABLE_RETRY_BASE_MS;
  process.env.FEISHU_BITABLE_RETRY_BASE_MS = '10';
  assert.strictEqual(bitableRetryDelayMs(1), 10);
  assert.strictEqual(bitableRetryDelayMs(2), 20);
  assert.strictEqual(bitableRetryDelayMs(3), 40);
  if (prior === undefined) delete process.env.FEISHU_BITABLE_RETRY_BASE_MS;
  else process.env.FEISHU_BITABLE_RETRY_BASE_MS = prior;

  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/feishu.js'),
    'utf8'
  );
  assert(source.includes('BITABLE_LIST_MAX_ATTEMPTS = 4'));
  assert(source.includes('attempt <= BITABLE_LIST_MAX_ATTEMPTS'));
  assert(source.includes('transient list records failure'));
  assert(source.includes('await sleep(delayMs)'));

  console.log('feishu-transient-retry-regression-ok');
}

main();
