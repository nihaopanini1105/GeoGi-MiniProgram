const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DeliveryPackageError,
  DELIVERY_CONTRACT_VERSION,
  DELIVERY_MODE,
  PRODUCTION_AUTHORITY,
  sha256Canonical,
  validateDeliveryPackage,
  importDeliveryPackage,
  findDeliveryPackage,
  projectDeliveryForCustomer
} = require('../src/services/delivery-package-store');

function buildValidPackage() {
  const reportContentHash = `sha256:${'a'.repeat(64)}`;
  const reportRecordHash = `sha256:${'b'.repeat(64)}`;
  const document = {
    object_type: 'delivery_package',
    delivery_contract_version: '3.0.0',
    delivery_mode: 'artifact_only',
    production_authority: 'geogi_os',
    delivery_package_id: 'delivery_package_test0001',
    project_id: 'GG-P-202609-000001',
    client_id: 'GG-202609-0001',
    release_status: 'released',
    released_at: '2026-09-18T12:00:00+00:00',
    report_reference: {
      report_id: 'report_test0001',
      report_type: 'client_geo_diagnostic',
      report_version: 1,
      object_version: '1.0.0',
      content_hash: reportContentHash,
      report_record_hash: reportRecordHash
    },
    version_pins: {
      report_schema_version: '1.0.0',
      report_object_version: '1.0.0',
      report_version: 1,
      report_delivery_record_version: '1.0.0',
      artifact_render_version: '1.0.0',
      canonical_client_id: 'client_test0001',
      canonical_project_id: 'project_test0001'
    },
    display_policy: {
      artifact_only: true,
      client_recomposition_allowed: false,
      client_scoring_allowed: false,
      client_summary_generation_allowed: false,
      client_diagnosis_generation_allowed: false
    },
    artifacts: [{
      artifact_id: 'delivery_artifact_test0001',
      artifact_type: 'pdf',
      mime_type: 'application/pdf',
      file_name: 'report.pdf',
      sha256: 'c'.repeat(64),
      size_bytes: 128,
      render_version: '1.0.0',
      report_content_hash: reportContentHash,
      report_record_hash: reportRecordHash,
      uri: 'https://delivery.example.invalid/report.pdf'
    }]
  };
  document.package_hash = sha256Canonical(document);
  return document;
}

function rehash(document) {
  delete document.package_hash;
  document.package_hash = sha256Canonical(document);
  return document;
}

function expectCode(fn, code) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert(caught instanceof DeliveryPackageError, `expected DeliveryPackageError ${code}`);
  assert.strictEqual(caught.code, code);
}

async function expectCodeAsync(fn, code) {
  let caught = null;
  try { await fn(); } catch (error) { caught = error; }
  assert(caught instanceof DeliveryPackageError, `expected DeliveryPackageError ${code}`);
  assert.strictEqual(caught.code, code);
}

async function run() {
  assert.strictEqual(DELIVERY_CONTRACT_VERSION, '3.0.0');
  assert.strictEqual(DELIVERY_MODE, 'artifact_only');
  assert.strictEqual(PRODUCTION_AUTHORITY, 'geogi_os');

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'geogi-delivery-boundary-'));
  process.env.GEOGI_DELIVERY_PACKAGE_ROOT = root;

  const valid = buildValidPackage();
  validateDeliveryPackage(valid);

  const recomposed = buildValidPackage();
  recomposed.display_summary = { keyFindings: ['客户端重新拼装'] };
  rehash(recomposed);
  expectCode(() => validateDeliveryPackage(recomposed), 'DELIVERY_CLIENT_REPORT_RECOMPOSITION_FORBIDDEN');

  const scoring = buildValidPackage();
  scoring.display_policy.client_scoring_allowed = true;
  rehash(scoring);
  expectCode(() => validateDeliveryPackage(scoring), 'DELIVERY_CLIENT_SIDE_PRODUCTION_FORBIDDEN');

  const diagnosis = buildValidPackage();
  diagnosis.display_policy.client_diagnosis_generation_allowed = true;
  rehash(diagnosis);
  expectCode(() => validateDeliveryPackage(diagnosis), 'DELIVERY_CLIENT_SIDE_PRODUCTION_FORBIDDEN');

  const wrongAuthority = buildValidPackage();
  wrongAuthority.production_authority = 'miniprogram';
  rehash(wrongAuthority);
  expectCode(() => validateDeliveryPackage(wrongAuthority), 'DELIVERY_OS_PRODUCTION_AUTHORITY_REQUIRED');

  const oldContract = buildValidPackage();
  oldContract.delivery_contract_version = '2.1.0';
  rehash(oldContract);
  expectCode(() => validateDeliveryPackage(oldContract), 'DELIVERY_CONTRACT_VERSION_UNSUPPORTED');

  const artifactMismatch = buildValidPackage();
  artifactMismatch.artifacts[0].report_record_hash = `sha256:${'f'.repeat(64)}`;
  rehash(artifactMismatch);
  expectCode(() => validateDeliveryPackage(artifactMismatch), 'DELIVERY_ARTIFACT_REPORT_HASH_MISMATCH');

  const first = await importDeliveryPackage(valid);
  assert.strictEqual(first.imported, true);
  const second = await importDeliveryPackage(valid);
  assert.strictEqual(second.idempotent, true);

  const loaded = await findDeliveryPackage({ clientId: valid.client_id, projectId: valid.project_id });
  assert(loaded);
  assert.strictEqual(loaded.delivery_contract_version, '3.0.0');

  const customer = projectDeliveryForCustomer(loaded, { clientId: valid.client_id, projectId: valid.project_id });
  assert.strictEqual(customer.releaseStatus, 'released');
  assert.strictEqual(customer.deliveryMode, 'artifact_only');
  assert.strictEqual(customer.productionAuthority, 'geogi_os');
  assert.strictEqual(customer.reportLink, valid.artifacts[0].uri);
  assert.strictEqual(customer.reportContentHash, valid.report_reference.content_hash);
  assert.strictEqual(customer.reportRecordHash, valid.report_reference.report_record_hash);
  for (const forbidden of ['overallScore','summary','conclusion','dimensions','platforms','keyFindings','recommendations','limitations','risks','scope']) {
    assert(!Object.prototype.hasOwnProperty.call(customer, forbidden), `customer delivery must not expose recomposed field: ${forbidden}`);
  }

  expectCode(() => projectDeliveryForCustomer(loaded, { clientId: 'GG-OTHER', projectId: valid.project_id }), 'DELIVERY_SCOPE_MISMATCH');

  const conflicting = buildValidPackage();
  conflicting.artifacts[0].file_name = 'mutated.pdf';
  rehash(conflicting);
  await expectCodeAsync(() => importDeliveryPackage(conflicting), 'DELIVERY_PACKAGE_IMMUTABLE_CONFLICT');

  const repoRoot = path.resolve(__dirname, '../..');
  const removedCapabilities = [
    'server/src/services/diagnosis-engine.js',
    'server/src/services/diagnosis.js',
    'server/src/services/ai-share-extractor.js',
    'server/src/services/report-pdf.js',
    'server/src/services/workflow-command.js',
    'server/src/scripts/render-report-pdf.py',
    'server/src/scripts/run-workflow-command.js',
    'server/src/scripts/setup-diagnosis-workbench.js'
  ];
  for (const relative of removedCapabilities) {
    assert(!fs.existsSync(path.join(repoRoot, relative)), `MiniProgram production capability reintroduced: ${relative}`);
  }

  const serverSource = fs.readFileSync(path.join(repoRoot, 'server/src/server.js'), 'utf8');
  const portalSource = fs.readFileSync(path.join(repoRoot, 'server/src/services/customer-portal.js'), 'utf8');
  const reportPageSource = fs.readFileSync(path.join(repoRoot, 'pages/report-detail/report-detail.wxml'), 'utf8');
  const reportPageLogic = fs.readFileSync(path.join(repoRoot, 'pages/report-detail/report-detail.js'), 'utf8');

  const forbiddenServer = [
    "require('./services/diagnosis')",
    "require('./services/workflow-command')",
    "require('./services/report-pdf')",
    "app.use('/reports'"
  ];
  for (const token of forbiddenServer) assert(!serverSource.includes(token), `production server bypass reintroduced: ${token}`);

  for (const token of ['buildDimensions(', 'buildConclusion(', 'buildPlatforms(', 'keyFindings', 'recommendations', 'overallScore']) {
    assert(!portalSource.includes(token), `customer portal production logic reintroduced: ${token}`);
  }

  for (const token of ['关键发现', '平台范围', '优化建议', '报告限制', '风险说明', '综合可见度', '核心评分']) {
    assert(!reportPageSource.includes(token), `client-side report composition reintroduced: ${token}`);
  }
  for (const token of ['keyFindings', 'recommendations', 'platforms', 'dimensions', 'overallScore', 'scoreStatus']) {
    assert(!reportPageLogic.includes(token), `client-side report parsing reintroduced: ${token}`);
  }
  assert(reportPageSource.includes('小程序仅负责展示该交付物'));
  assert(reportPageSource.includes('打开 GeoGi OS 正式报告'));

  await fs.promises.rm(root, { recursive: true, force: true });
  console.log('GEOGI MINIPROGRAM DISPLAY-ONLY BOUNDARY: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
