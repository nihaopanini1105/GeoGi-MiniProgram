const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  PROJECT_STAGES,
  OperationsBridgeError,
  configured,
  requireOsBridge,
  updateOsProjectStage
} = require('../src/services/os-operations-bridge');

function fakeResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

async function main() {
  const expectedStages = [
    'INTAKE', 'ONBOARDING', 'DETECTION', 'DIAGNOSIS', 'SOLUTION',
    'IMPLEMENTATION', 'RETEST', 'REVIEW', 'RELEASED', 'MONITORING', 'BLOCKED'
  ];
  assert.deepStrictEqual(Object.keys(PROJECT_STAGES), expectedStages);
  assert.strictEqual(PROJECT_STAGES.IMPLEMENTATION.currentStatus, '优化实施中');
  assert.strictEqual(PROJECT_STAGES.RETEST.currentStatus, '效果复测中');
  assert.strictEqual(PROJECT_STAGES.RELEASED.currentStatus, '报告已交付');
  assert.strictEqual(PROJECT_STAGES.BLOCKED.auditStatus, '等待客户补充');
  assert(Object.isFrozen(PROJECT_STAGES));

  const bridgeSource = fs.readFileSync(
    path.join(__dirname, '../src/services/os-operations-bridge.js'),
    'utf8'
  );
  const packageImportIndex = bridgeSource.indexOf(
    'const result = await importDeliveryPackage(packageDocument);'
  );
  const releasedProjectionIndex = bridgeSource.indexOf(
    "await updateOsProjectStage({ projectId: packageDocument.project_id, stage: 'RELEASED' });"
  );
  assert(packageImportIndex >= 0, 'delivery package import must remain explicit');
  assert(
    releasedProjectionIndex > packageImportIndex,
    'MiniProgram project must advance to RELEASED only after DeliveryPackage import succeeds'
  );

  const prior = process.env.GEOGI_OS_BRIDGE_TOKEN;
  delete process.env.GEOGI_OS_BRIDGE_TOKEN;
  assert.strictEqual(configured(), false);
  let res = fakeResponse();
  requireOsBridge({ headers: {} }, res, () => { throw new Error('must_not_continue'); });
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.payload.error, 'OS_BRIDGE_NOT_CONFIGURED');

  process.env.GEOGI_OS_BRIDGE_TOKEN = 'bridge-secret-for-regression';
  res = fakeResponse();
  requireOsBridge({ headers: { authorization: 'Bearer wrong-secret' } }, res, () => { throw new Error('must_not_continue'); });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.payload.error, 'OS_BRIDGE_UNAUTHORIZED');

  let continued = false;
  res = fakeResponse();
  requireOsBridge(
    { headers: { authorization: 'Bearer bridge-secret-for-regression' } },
    res,
    () => { continued = true; }
  );
  assert.strictEqual(continued, true);

  let invalidStage = null;
  try {
    await updateOsProjectStage({ projectId: 'GG-P-202609-000001', stage: 'MADE_UP_STATE' });
  } catch (error) {
    invalidStage = error;
  }
  assert(invalidStage instanceof OperationsBridgeError);
  assert.strictEqual(invalidStage.code, 'OS_BRIDGE_STAGE_INVALID');

  if (prior === undefined) delete process.env.GEOGI_OS_BRIDGE_TOKEN;
  else process.env.GEOGI_OS_BRIDGE_TOKEN = prior;

  console.log('os-operations-bridge-regression-ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
