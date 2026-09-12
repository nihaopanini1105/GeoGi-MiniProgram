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

function buildValidPackage(version = '2.1.0') {
  const reportContentHash = `sha256:${'a'.repeat(64)}`;
  const reportRecordHash = `sha256:${'b'.repeat(64)}`;
  const governed = version === '2.1.0';
  const document = {
    object_type: 'delivery_package',
    delivery_contract_version: version,
    delivery_package_id: governed ? 'delivery_package_test0001' : 'delivery_package_legacy0001',
    project_id: 'GG-P-202609-000001',
    client_id: 'GG-202609-0001',
    report_reference: {
      report_id: governed ? 'report_test0001' : 'report_legacy0001',
      report_version: 1,
      object_version: '2.0.0',
      content_hash: reportContentHash,
      report_record_hash: reportRecordHash
    },
    release_status: 'released',
    released_at: governed ? '2026-09-11T12:00:00+00:00' : '2026-09-09T12:00:00+00:00',
    version_pins: governed ? {
      product_release: 'v1.1.0',
      presentation_version: '1.0.0',
      canonical_client_id: 'client_test0001',
      canonical_project_id: 'project_test0001'
    } : {
      product_release: 'v1.0.0'
    },
    display_summary: governed ? {
      presentationVersion: '1.0.0',
      presentationAuthority: 'os_m09_governed_report',
      reportStatus: 'released',
      reportType: 'client_geo_diagnostic',
      title: '测试品牌 AI 可见度诊断报告',
      summary: '该摘要由 GeoGi OS 已发布报告提供。',
      conclusion: '该结论由 GeoGi OS 已发布报告提供。',
      overallScore: null,
      scoreStatus: '未形成正式总分',
      dimensions: [],
      platforms: [
        { platformId: 'doubao', name: '豆包', role: '正式评估平台', status: '已纳入报告范围', formalDenominatorIncluded: null },
        { platformId: 'kimi', name: 'Kimi', role: '补充观察平台', status: 'validation_pending', formalDenominatorIncluded: false }
      ],
      keyFindings: ['已发布发现'],
      recommendations: ['已发布建议'],
      limitations: ['样本范围限制'],
      risks: ['本报告不保证长期表现'],
      scope: ['正式评估平台：豆包、DeepSeek、腾讯元宝、通义千问'],
      evidenceCount: 4,
      integrity: {
        reportRecordHash,
        sourceManifestHash: `sha256:${'d'.repeat(64)}`,
        contentHash: reportContentHash
      }
    } : {
      title: '历史报告',
      summary: '历史 DeliveryPackage/2.0.0',
      conclusion: '历史结论',
      overallScore: 78,
      dimensions: [{ name: '覆盖', score: 80 }],
      platforms: [],
      keyFindings: [],
      recommendations: [],
      scope: []
    },
    artifacts: [{
      artifact_id: governed ? 'delivery_artifact_test0001' : 'delivery_artifact_legacy0001',
      artifact_type: 'pdf',
      mime_type: 'application/pdf',
      file_name: governed ? 'report.pdf' : 'legacy-report.pdf',
      sha256: 'c'.repeat(64),
      size_bytes: 128,
      render_version: '1.0.0',
      report_content_hash: reportContentHash,
      uri: governed ? 'https://delivery.example.invalid/report.pdf' : 'https://delivery.example.invalid/legacy-report.pdf'
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
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'geogi-delivery-boundary-'));
  process.env.GEOGI_DELIVERY_PACKAGE_ROOT = root;

  const valid = buildValidPackage();
  validateDeliveryPackage(valid);

  expectCode(() => validateDeliveryPackage({ report_id: 'raw-report', report_status: 'released' }), 'DELIVERY_PACKAGE_REQUIRED');

  const approvedOnly = buildValidPackage();
  approvedOnly.release_status = 'approved';
  rehash(approvedOnly);
  expectCode(() => validateDeliveryPackage(approvedOnly), 'DELIVERY_PACKAGE_NOT_RELEASED');

  const tampered = buildValidPackage();
  tampered.display_summary.conclusion = 'tampered without package rehash';
  expectCode(() => validateDeliveryPackage(tampered), 'DELIVERY_PACKAGE_HASH_MISMATCH');

  const scored = buildValidPackage();
  scored.display_summary.overallScore = 78;
  rehash(scored);
  expectCode(() => validateDeliveryPackage(scored), 'DELIVERY_UNAPPROVED_SCORE_FORBIDDEN');

  const wrongAuthority = buildValidPackage();
  wrongAuthority.display_summary.presentationAuthority = 'miniprogram_local_engine';
  rehash(wrongAuthority);
  expectCode(() => validateDeliveryPackage(wrongAuthority), 'DELIVERY_PRESENTATION_AUTHORITY_INVALID');

  const wrongPresentationHash = buildValidPackage();
  wrongPresentationHash.display_summary.integrity.contentHash = `sha256:${'e'.repeat(64)}`;
  rehash(wrongPresentationHash);
  expectCode(() => validateDeliveryPackage(wrongPresentationHash), 'DELIVERY_PRESENTATION_REPORT_HASH_MISMATCH');

  const artifactMismatch = buildValidPackage();
  artifactMismatch.artifacts[0].report_content_hash = `sha256:${'f'.repeat(64)}`;
  rehash(artifactMismatch);
  expectCode(() => validateDeliveryPackage(artifactMismatch), 'DELIVERY_ARTIFACT_REPORT_HASH_MISMATCH');

  const first = await importDeliveryPackage(valid);
  assert.strictEqual(first.imported, true);
  const second = await importDeliveryPackage(valid);
  assert.strictEqual(second.idempotent, true);

  const legacy = buildValidPackage('2.0.0');
  validateDeliveryPackage(legacy);
  await fs.promises.writeFile(path.join(root, `${legacy.delivery_package_id}.json`), `${JSON.stringify(legacy)}\n`, 'utf8');
  await expectCodeAsync(() => importDeliveryPackage(legacy), 'DELIVERY_LEGACY_PACKAGE_IMPORT_FORBIDDEN');

  const loaded = await findDeliveryPackage({ clientId: valid.client_id, projectId: valid.project_id });
  assert(loaded);
  assert.strictEqual(loaded.package_hash, valid.package_hash);
  assert.strictEqual(loaded.delivery_contract_version, '2.1.0');

  const customer = projectDeliveryForCustomer(loaded, { clientId: valid.client_id, projectId: valid.project_id });
  assert.strictEqual(customer.releaseStatus, 'released');
  assert.strictEqual(customer.deliveryPackageId, valid.delivery_package_id);
  assert.strictEqual(customer.reportLink, valid.artifacts[0].uri);
  assert.strictEqual(customer.overallScore, null);
  assert.strictEqual(customer.presentationAuthority, 'os_m09_governed_report');
  assert.strictEqual(customer.evidenceCount, 4);
  assert.deepStrictEqual(customer.keyFindings, ['已发布发现']);

  const legacyCustomer = projectDeliveryForCustomer(legacy, { clientId: legacy.client_id, projectId: legacy.project_id });
  assert.strictEqual(legacyCustomer.deliveryContractVersion, '2.0.0');
  assert.strictEqual(legacyCustomer.legacyDelivery, true);
  assert.strictEqual(legacyCustomer.overallScore, null);
  assert.strictEqual(legacyCustomer.presentationAuthority, 'legacy_delivery_package_v2_0');
  assert(legacyCustomer.scoreStatus.includes('历史报告格式'));

  expectCode(() => projectDeliveryForCustomer(loaded, { clientId: 'GG-OTHER', projectId: valid.project_id }), 'DELIVERY_SCOPE_MISMATCH');

  const conflicting = buildValidPackage();
  conflicting.display_summary.conclusion = 'mutated but rehashed content';
  rehash(conflicting);
  await expectCodeAsync(() => importDeliveryPackage(conflicting), 'DELIVERY_PACKAGE_IMMUTABLE_CONFLICT');

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const portalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'customer-portal.js'), 'utf8');
  const reportPageSource = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'report-detail', 'report-detail.wxml'), 'utf8');
  const reportPageLogic = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'report-detail', 'report-detail.js'), 'utf8');

  const forbiddenServer = [
    "require('./services/diagnosis')",
    "require('./services/workflow-command')",
    "require('./services/report-pdf')",
    '/api/feishu/command',
    '/api/feishu/events',
    "app.use('/reports'"
  ];
  for (const token of forbiddenServer) assert(!serverSource.includes(token), `production server bypass reintroduced: ${token}`);
  assert(serverSource.includes("require('./services/os-intake')"));

  const forbiddenPortal = [
    'FEISHU_REPORTS_TABLE_ID',
    'FEISHU_ANALYSIS_TABLE_ID',
    'FEISHU_TEST_RECORDS_TABLE_ID',
    'buildDimensions(',
    'buildConclusion(',
    'buildPlatforms('
  ];
  for (const token of forbiddenPortal) assert(!portalSource.includes(token), `customer portal business authority reintroduced: ${token}`);
  assert(portalSource.includes('findDeliveryPackage'));
  assert(portalSource.includes('projectDeliveryForCustomer'));

  assert(!reportPageSource.includes('综合可见度'));
  assert(!reportPageSource.includes('核心评分'));
  assert(!reportPageSource.includes('=== false'));
  assert(reportPageSource.includes('item.isSupplemental'));
  assert(reportPageLogic.includes('formalDenominatorIncluded === false'));
  assert(reportPageSource.includes('报告结论与治理状态'));
  assert(reportPageSource.includes('仅展示已通过 GeoGi OS 报告治理并由 M09 发布的数据'));

  await fs.promises.rm(root, { recursive: true, force: true });
  console.log('GEOGI V1.1 MINIPROGRAM GOVERNED DELIVERY BOUNDARY: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
