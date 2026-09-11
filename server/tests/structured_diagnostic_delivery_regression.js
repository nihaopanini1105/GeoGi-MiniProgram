const assert = require('assert');

const {
  sha256Canonical,
  validateDeliveryPackage,
  projectDeliveryForCustomer
} = require('../src/services/delivery-package-store');

function structuredDiagnosticPackage() {
  const reportContentHash = `sha256:${'a'.repeat(64)}`;
  const document = {
    object_type: 'delivery_package',
    delivery_contract_version: '2.0.0',
    delivery_package_id: 'delivery_package_structured01',
    project_id: 'GG-P-202609-STRUCT01',
    client_id: 'GG-202609-STRUCT01',
    report_reference: {
      report_id: 'report_structured01',
      report_version: 1,
      object_version: '1.0.0',
      content_hash: reportContentHash,
      report_record_hash: `sha256:${'b'.repeat(64)}`
    },
    release_status: 'released',
    released_at: '2026-09-11T10:00:00+00:00',
    version_pins: {
      m09_delivery_record_type: 'diagnostic_report_delivery_record',
      m09_delivery_record_version: '1.0.0'
    },
    display_summary: {
      title: 'GeoGi AI 可见度诊断报告',
      overallScore: null,
      conclusion: '该页面直接展示 GeoGi OS 正式发布的结构化诊断结果。',
      dimensions: [],
      platforms: [],
      keyFindings: ['正式诊断发现'],
      recommendations: ['正式优化建议'],
      scope: ['真实检测覆盖 5 个平台；正式 M06 分母为 4 个平台。'],
      governance: { authority: 'GeoGi OS', scoreInvented: false }
    },
    artifacts: [{
      artifact_id: 'delivery_artifact_structured01',
      artifact_type: 'report_artifact',
      mime_type: 'application/json',
      file_name: 'report_structured01.json',
      sha256: 'c'.repeat(64),
      size_bytes: 512,
      render_version: '1.0.0',
      report_content_hash: reportContentHash,
      uri: 'https://delivery.example.invalid/report_structured01.json'
    }]
  };
  document.package_hash = sha256Canonical(document);
  return document;
}

const document = structuredDiagnosticPackage();
validateDeliveryPackage(document);
const customer = projectDeliveryForCustomer(document, {
  clientId: document.client_id,
  projectId: document.project_id
});
assert.strictEqual(customer.releaseStatus, 'released');
assert.strictEqual(customer.reportLink, '');
assert.strictEqual(customer.artifactId, '');
assert.strictEqual(customer.artifactSha256, '');
assert.deepStrictEqual(customer.keyFindings, ['正式诊断发现']);
assert.deepStrictEqual(customer.recommendations, ['正式优化建议']);
assert.strictEqual(customer.governance.authority, 'GeoGi OS');
console.log('GEOGI V1 STRUCTURED DIAGNOSTIC DELIVERY: OK');
