const assert = require('assert');

process.env.CUSTOMER_SESSION_SECRET = 'geogi-test-secret';

const {
  createCustomerToken,
  verifyCustomerToken
} = require('../src/services/customer-session');

function run() {
  const issued = createCustomerToken('13800138000');
  assert(issued.customerToken);
  assert(issued.customerTokenExpiresAt);

  const payload = verifyCustomerToken(issued.customerToken);
  assert.strictEqual(payload.phoneNumber, '13800138000');
  assert.strictEqual(payload.v, 1);
  assert(payload.exp > Date.now());

  const paidIssued = createCustomerToken('13800138000', { openid: 'openid_test_123' });
  const paidPayload = verifyCustomerToken(paidIssued.customerToken);
  assert.strictEqual(paidPayload.v, 2);
  assert.strictEqual(paidPayload.openid, 'openid_test_123');

  let failed = false;
  try {
    verifyCustomerToken(`${issued.customerToken}tampered`);
  } catch (error) {
    failed = true;
  }
  assert.strictEqual(failed, true);

  console.log('GEOGI V1 CUSTOMER SESSION BOUNDARY: OK');
}

run();
