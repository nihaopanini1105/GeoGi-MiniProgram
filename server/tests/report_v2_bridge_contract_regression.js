'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  sha256Canonical, validateDeliveryPackage, importDeliveryPackage,
  findDeliveryPackage
} = require('../src/services/delivery-package-store');
const {
  AUTHORITY, readRevocation, revokeV2Package
} = require('../src/services/report-v2-revocations');

function fixture(authority = AUTHORITY) {
  const contentHash = 'sha256:' + 'a'.repeat(64);
  const recordHash = 'sha256:' + 'b'.repeat(64);
  const p = {
    object_type:'delivery_package',
    delivery_contract_version:'3.0.0',
    delivery_mode:'artifact_only',
    production_authority:'geogi_os',
    delivery_purpose:'baseline_diagnostic_report',
    release_authority:authority,
    delivery_package_id:'v2-test-release-1',
    project_id:'project-test-1',
    client_id:'customer-test-1',
    release_status:'released', released_at:'2026-10-12T00:00:00Z',
    report_reference:{
      report_id:'report-test-1', report_type:'client_geo_diagnostic',
      report_version:2, object_version:'2.0.0',
      content_hash:contentHash, report_record_hash:recordHash
    },
    version_pins:{
      report_schema_version:'2.0.0', report_object_version:'2.0.0',
      release_record_version:'2.0.0', artifact_render_version:'2.0.0',
      canonical_client_id:'customer-test-1',
      canonical_project_id:'project-test-1', report_version:2
    },
    display_policy:{
      artifact_only:true, client_recomposition_allowed:false,
      client_scoring_allowed:false,client_summary_generation_allowed:false,
      client_diagnosis_generation_allowed:false
    },
    artifacts:[{
      artifact_id:'artifact-1',artifact_type:'h5',mime_type:'text/html',
      file_name:'report-test.html', sha256:'c'.repeat(64),
      size_bytes:100,render_version:'2.0.0',
      report_content_hash:contentHash, report_record_hash:recordHash,
      uri:'https://delivery.example.invalid/report-test.html'
    }]
  };
  p.package_hash=sha256Canonical(p);
  return p;
}

async function run() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-v2-bridge-'));
  process.env.GEOGI_DELIVERY_PACKAGE_ROOT=path.join(dir,'packages');
  process.env.GEOGI_REPORT_V2_STATE_ROOT=path.join(dir,'revocations');
  try {
    const p=fixture();
    validateDeliveryPackage(p);
    let wrong=fixture('baseline_diagnostic_release_v1');
    validateDeliveryPackage(wrong); // Legacy V1 H5 remains allowed.
    const bad=fixture();bad.artifacts[0].mime_type='application/pdf';
    bad.package_hash=sha256Canonical(Object.fromEntries(Object.entries(bad).filter(([k])=>k!=='package_hash')));
    assert.throws(()=>validateDeliveryPackage(bad),/DELIVERY_ARTIFACT_TYPE_INVALID/);
    const imported=await importDeliveryPackage(p);
    assert.strictEqual(imported.imported,true);
    assert.strictEqual((await findDeliveryPackage({clientId:p.client_id,projectId:p.project_id})).delivery_package_id,p.delivery_package_id);
    assert.throws(()=>revokeV2Package({
      packageDocument:p,clientId:'other-customer',projectId:p.project_id,
      artifactSha256:p.artifacts[0].sha256,reason:'scope'
    }),/REPORT_V2_REVOKE_SCOPE_INVALID/);
    const revoke=()=>revokeV2Package({
      packageDocument:p,clientId:p.client_id,projectId:p.project_id,
      artifactSha256:p.artifacts[0].sha256,reason:'test-revocation'
    });
    assert.strictEqual(revoke().status,'revoked');
    assert.strictEqual(revoke().status,'revoked'); // Idempotent.
    assert(readRevocation(p.delivery_package_id));
    assert.strictEqual(await findDeliveryPackage({clientId:p.client_id,projectId:p.project_id}),null);
    await assert.rejects(()=>importDeliveryPackage(p),/DELIVERY_REVOKED_PACKAGE_CANNOT_REPUBLISH/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

run().then(()=>console.log('V2 bridge authority/revocation regression passed')).catch(error=>{
  console.error(error);process.exitCode=1;
});
