'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-v2-bridge-'));
  process.env.GEOGI_DELIVERY_PACKAGE_ROOT = path.join(root, 'delivery-packages');
  process.env.UPLOAD_DIR = path.join(root, 'uploads');
  process.env.GEOGI_REPORT_V2_BRIDGE_ENABLED = 'true';
  process.env.CUSTOMER_SESSION_SECRET = 'fixture-secret-only-for-tests';
  process.env.GEOGI_OS_BRIDGE_TOKEN = 'fixture-os-bridge';
  for (const key of ['FEISHU_APP_ID','FEISHU_APP_SECRET','FEISHU_BASE_APP_TOKEN',
    'FEISHU_LEADS_TABLE_ID','FEISHU_PROJECTS_TABLE_ID']) process.env[key] = 'fixture-' + key;

  const {
    sha256Canonical, validateDeliveryPackage, importDeliveryPackage,
    findDeliveryPackage, projectDeliveryForCustomer
  } = require('../src/services/delivery-package-store');
  const { revokeV2Package, getRevocation } = require('../src/services/report-v2-revocation-store');
  const { v2Capabilities, verifyV2CustomerAccess, revokeV2Delivery, lookupExactV2Package } =
    require('../src/services/report-v2-bridge');
  const { reportPaymentEligible } = require('../src/services/customer-portal');

  function pkg(id, authority = 'geo_diagnostic_html_release_v2', mime = 'text/html') {
    const contentHash = 'sha256:' + 'a'.repeat(64);
    const recordHash = 'sha256:' + 'b'.repeat(64);
    const html = mime === 'text/html';
    const out = {
      object_type: 'delivery_package',
      delivery_contract_version: '3.0.0',
      delivery_mode: 'artifact_only',
      production_authority: 'geogi_os',
      delivery_purpose: 'baseline_diagnostic_report',
      release_authority: authority,
      delivery_package_id: id,
      client_id: 'GG-202609-0001',
      project_id: 'GG-P-202609-000001',
      release_status: 'released',
      released_at: '2026-10-12T12:00:00Z',
      report_reference: {
        report_id: 'report-v2-1', report_version: 1, object_version: '2.0.0',
        content_hash: contentHash, report_record_hash: recordHash
      },
      version_pins: {
        report_schema_version: '2.0.0', report_object_version: '2.0.0',
        report_version: 1, release_record_version: '2.0.0',
        artifact_render_version: '2.0.0',
        canonical_client_id: 'client-os-1', canonical_project_id: 'project-os-1'
      },
      display_policy: {
        artifact_only: true, client_recomposition_allowed: false,
        client_scoring_allowed: false, client_summary_generation_allowed: false,
        client_diagnosis_generation_allowed: false
      },
      artifacts: [{
        artifact_id: 'artifact-v2-1', artifact_type: html ? 'h5' : 'pdf',
        mime_type: mime, file_name: html ? 'report-v2-1.html' : 'report-v2-1.pdf',
        sha256: 'c'.repeat(64), size_bytes: 120, render_version: '2.0.0',
        report_content_hash: contentHash, report_record_hash: recordHash,
        uri: 'https://api.geogi.cn/uploads/report-v2-1.html'
      }]
    };
    out.package_hash = sha256Canonical(out);
    return out;
  }

  const v2 = pkg('delivery_package_v2_1');
  const v1 = pkg('delivery_package_v1_1', 'baseline_diagnostic_release_v1','application/pdf');
  v1.released_at = '2026-09-01T00:00:00Z';
  delete v1.package_hash;
  v1.package_hash = sha256Canonical(v1);
  validateDeliveryPackage(v2);
  validateDeliveryPackage(v1);
  assert.throws(() => validateDeliveryPackage(
    pkg('delivery_package_bad_v2_pdf','geo_diagnostic_html_release_v2','application/pdf')
  ), /DELIVERY_V2_HTML_ARTIFACT_REQUIRED/);

  assert.strictEqual(v2Capabilities().authenticated_customer_access,true);
  process.env.GEOGI_REPORT_V2_BRIDGE_ENABLED='false';
  assert.strictEqual(v2Capabilities().authenticated_customer_access,false);
  process.env.GEOGI_REPORT_V2_BRIDGE_ENABLED='true';

  await importDeliveryPackage(v2);
  await importDeliveryPackage(v1);
  assert.strictEqual((await findDeliveryPackage({clientId:v2.client_id,projectId:v2.project_id})).delivery_package_id,v2.delivery_package_id);
  assert((await lookupExactV2Package({
    delivery_package_id:v2.delivery_package_id,client_id:v2.client_id,
    project_id:v2.project_id,artifact_sha256:v2.artifacts[0].sha256
  })).delivery_package_id === v2.delivery_package_id);

  const scope = {
    delivery_package_id:v2.delivery_package_id, client_id:v2.client_id,
    project_id:v2.project_id, artifact_sha256:v2.artifacts[0].sha256
  };
  const deps = {
    ownershipLookup: async () => true,
    reportLookup: async () => ({ok:true,report:{
      reportReady:true, deliveryPackageId:v2.delivery_package_id,
      artifactSha256:scope.artifact_sha256, artifactType:'h5',
      artifactMimeType:'text/html', artifactFileName:v2.artifacts[0].file_name
    }}),
    reader:()=>Buffer.from('<!doctype html><html></html>')
  };
  const accessible=await verifyV2CustomerAccess(scope,deps);
  assert.strictEqual(accessible.authorized,true);
  assert.strictEqual(accessible.accessible,true);
  assert.strictEqual((await verifyV2CustomerAccess(scope,{...deps,ownershipLookup:async()=>false})).accessible,false);
  assert.strictEqual((await verifyV2CustomerAccess(scope,{...deps,reader:()=>{throw new Error('missing')}})).accessible,false);
  assert.strictEqual((await verifyV2CustomerAccess({
    ...scope,artifact_sha256:'d'.repeat(64)
  },deps)).accessible,false);

  // Disabling the V2 feature must block existing customer access instantly,
  // yet a compensating OS revocation must remain available.
  process.env.GEOGI_REPORT_V2_BRIDGE_ENABLED='false';
  assert.strictEqual((await verifyV2CustomerAccess(scope,deps)).accessible,false);
  assert.strictEqual(await findDeliveryPackage({clientId:v2.client_id,projectId:v2.project_id}),null);
  const revoke=await revokeV2Delivery({...scope,reason:'fixture revoke while disabled'});
  process.env.GEOGI_REPORT_V2_BRIDGE_ENABLED='true';
  assert.strictEqual(revoke.status,'revoked');
  assert.strictEqual(getRevocation(scope.delivery_package_id).artifact_sha256,scope.artifact_sha256);
  assert.strictEqual(revokeV2Package(v2,{...scope,reason:'repeat'}).idempotent,true);
  assert.strictEqual((await verifyV2CustomerAccess(scope,deps)).accessible,false);
  assert.strictEqual(await findDeliveryPackage({clientId:v2.client_id,projectId:v2.project_id}),null,
    'revocation must not fall back to older package');
  assert.throws(()=>projectDeliveryForCustomer(v2,{clientId:v2.client_id,projectId:v2.project_id}),
    /DELIVERY_V2_UNAVAILABLE_OR_REVOKED/);
  await assert.rejects(()=>importDeliveryPackage(v2),/DELIVERY_V2_REVOKED_CANNOT_REPUBLISH/);
  assert.deepStrictEqual(await importDeliveryPackage(v1).then(x=>x.idempotent),true);
  assert(fs.existsSync(path.join(process.env.GEOGI_DELIVERY_PACKAGE_ROOT,v2.delivery_package_id+'.json')),
    'audit package immutable after revocation');

  const prePayLead={fields:{'提交时间':'2026-09-16T10:08:00+08:00'}};
  assert.strictEqual(reportPaymentEligible({payment:null,lead:prePayLead,deliveryPackage:v2}),true);
  assert.strictEqual(reportPaymentEligible({payment:null,lead:prePayLead,deliveryPackage:v1}),false);
  for (const status of ['refunded', 'refund_processing', 'closed', 'payment_failed', 'partially_refunded']) {
    assert.strictEqual(reportPaymentEligible({payment:{status},lead:prePayLead,deliveryPackage:v2}),false, status);
  }
  assert.strictEqual(reportPaymentEligible({payment:{status:'partially_refunded'},lead:prePayLead,deliveryPackage:v1}),true);
  assert.strictEqual(reportPaymentEligible({payment:{status:'paid'},lead:prePayLead,deliveryPackage:v2}),true);
  assert.strictEqual(reportPaymentEligible({
    payment:null,lead:{fields:{'提交时间':'2026-10-12T00:00:00Z'}},deliveryPackage:v2
  }),false);

  console.log('GEOGI_V2_PROTECTED_DELIVERY_REVOCATION_AND_SCOPE_PASS');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
