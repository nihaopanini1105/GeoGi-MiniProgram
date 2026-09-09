const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DeliveryPackageError,
  sha256Canonical,
  validateDeliveryPackage,
  importDeliveryPackage,
  findDeliveryPackage,
  projectDeliveryForCustomer
} = require('../src/services/delivery-package-store');

function buildValidPackage() {
  const reportContentHash = `sha256:${'a'.repeat(64)}`;
  const document = {
    object_type: 'delivery_package',
    delivery_contract_version: '2.0.0',
    delivery_package_id: 'delivery_package_test0001',
    project_id: 'GG-P-202609-000001',
    client_id: 'GG-202609-0001',
    report_reference: {
      report_id: 'report_test0001',
      report_version: 1,
      object_version: '2.0.0',
      content_hash: reportContentHash,
      report_record_hash: `sha256:${'b'.repeat(64)}`
    },
    release_status: 'released',
    released_at: '2026-09-09T12:00:00+00:00',
    version_pins: {
      product_release: 'v1.0.0',
      question_bank_version: '1.0.0',
      scoring_model_version: '2.0.0',
      strategy_learning_version: '1.1.0',
      report_template_version: '2.0.0',
      industry_pack_id: 'industry_pack_100000000001',
      industry_pack_version: '1.0.0'
    },
    display_summary: {
      title: '测试品牌 AI 可见度诊断报告',
      overallScore: 78,
      conclusion: '该结论由 GeoGi OS 已发布报告提供。',
      dimensions: [{ name: '覆盖', score: 80 }],
      platforms: [{ name: '豆包', score: 79 }],
      keyFindings: ['已发布发现'],
      recommendations: ['已发布建议'],
      scope: ['中国市场']
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
      uri: 'https://delivery.example.invalid/report.pdf'
    }]
  };
  document.package_hash = sha256Canonical(document);
  return document;
}

function expectCode(fn, code) {
  let caught = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof DeliveryPackageError, `expected DeliveryPackageError ${code}`);
  assert.strictEqual(caught.code, code);
}

async function expectCodeAsync(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof DeliveryPackageError, `expected DeliveryPackageError ${code}`);
  assert.strictEqual(caught.code, code);
}

async function run() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'geogi-delivery-boundary-'));
  process.env.GEOGI_DELIVERY_PACKAGE_ROOT = root;

  const valid = buildValidPackage();
  validateDeliveryPackage(valid);

  expectCode(() => validateDeliveryPackage({
    report_id: 'raw-report',
    report_status: 'released'
  }), 'DELIVERY_PACKAGE_REQUIRED');

  const approvedOnly = buildValidPackage();
  approvedOnly.release_status = 'approved';
  approvedOnly.package_hash = sha256Canonical(Object.fromEntries(
    Object.entries(approvedOnly).filter(([key]) => key !== 'package_hash')
  ));
  expectCode(() => validateDeliveryPackage(approvedOnly), 'DELIVERY_PACKAGE_NOT_RELEASED');

  const tampered = buildValidPackage();
  tampered.display_summary.overallScore = 99;
  expectCode(() => validateDeliveryPackage(tampered), 'DELIVERY_PACKAGE_HASH_MISMATCH');

  const artifactMismatch = buildValidPackage();
  artifactMismatch.artifacts[0].report_content_hash = `sha256:${'d'.repeat(64)}`;
  artifactMismatch.package_hash = sha256Canonical(Object.fromEntries(
    Object.entries(artifactMismatch).filter(([key]) => key !== 'package_hash')
  ));
  expectCode(() => validateDeliveryPackage(artifactMismatch), 'DELIVERY_ARTIFACT_REPORT_HASH_MISMATCH');

  const first = await importDeliveryPackage(valid);
  assert.strictEqual(first.imported, true);
  const second = await importDeliveryPackage(valid);
  assert.strictEqual(second.idempotent, true);

  const loaded = await findDeliveryPackage({ clientId: valid.client_id, projectId: valid.project_id });
  assert(loaded);
  assert.strictEqual(loaded.package_hash, valid.package_hash);

  const customer = projectDeliveryForCustomer(loaded, {
    clientId: valid.client_id,
    projectId: valid.project_id
  });
  assert.strictEqual(customer.releaseStatus, 'released');
  assert.strictEqual(customer.deliveryPackageId, valid.delivery_package_id);
  assert.strictEqual(customer.reportLink, valid.artifacts[0].uri);
  assert.strictEqual(customer.overallScore, 78);

  expectCode(() => projectDeliveryForCustomer(loaded, {
    clientId: 'GG-OTHER',
    projectId: valid.project_id
  }), 'DELIVERY_SCOPE_MISMATCH');

  const conflicting = buildValidPackage();
  conflicting.display_summary.conclusion = 'mutated but rehashed content';
  delete conflicting.package_hash;
  conflicting.package_hash = sha256Canonical(conflicting);
  await expectCodeAsync(() => importDeliveryPackage(conflicting), 'DELIVERY_PACKAGE_IMMUTABLE_CONFLICT');

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const portalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'customer-portal.js'), 'utf8');

  const forbiddenServer = [
    "require('./services/diagnosis')",
    "require('./services/workflow-command')",
    "require('./services/report-pdf')",
    '/api/feishu/command',
    '/api/feishu/events',
    "app.use('/reports'"
  ];
  for (const token of forbiddenServer) {
    assert(!serverSource.includes(token), `production server bypass reintroduced: ${token}`);
  }
  assert(serverSource.includes("require('./services/os-intake')"));

  const forbiddenPortal = [
    'FEISHU_REPORTS_TABLE_ID',
    'FEISHU_ANALYSIS_TABLE_ID',
    'FEISHU_TEST_RECORDS_TABLE_ID',
    'buildDimensions(',
    'buildConclusion(',
    'buildPlatforms('
  ];
  for (const token of forbiddenPortal) {
    assert(!portalSource.includes(token), `customer portal business authority reintroduced: ${token}`);
  }
  assert(portalSource.includes('findDeliveryPackage'));
  assert(portalSource.includes('projectDeliveryForCustomer'));

  await fs.promises.rm(root, { recursive: true, force: true });
  console.log('GEOGI V1 MINIPROGRAM DELIVERY BOUNDARY: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
