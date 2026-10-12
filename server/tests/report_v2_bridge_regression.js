'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const os=require('os');
const path=require('path');
const store=require('../src/services/delivery-package-store');
const bridge=require('../src/services/report-v2-bridge');

function packageV2() {
  const source='sha256:'+'a'.repeat(64), record='sha256:'+'b'.repeat(64);
  const pkg={
    object_type:'delivery_package', delivery_contract_version:'3.0.0',
    delivery_mode:'artifact_only', production_authority:'geogi_os',
    delivery_purpose:'baseline_diagnostic_report',
    release_authority:'geo_diagnostic_html_release_v2',
    delivery_package_id:'v2-security-test-1', client_id:'client-test-1',
    project_id:'project-test-1', release_status:'released',
    released_at:'2026-10-12T00:00:00Z',
    report_reference:{report_id:'report-v2-1',object_version:'2.0.0',report_version:2,
      content_hash:source,report_record_hash:record},
    version_pins:{report_schema_version:'2.0.0',report_object_version:'2.0.0',
      release_record_version:'2.0.0',artifact_render_version:'2.0.0',report_version:2,
      canonical_client_id:'client-test-1',canonical_project_id:'project-test-1'},
    display_policy:{artifact_only:true,client_recomposition_allowed:false,
      client_scoring_allowed:false,client_summary_generation_allowed:false,
      client_diagnosis_generation_allowed:false},
    artifacts:[{artifact_id:'artifact-v2-1',artifact_type:'h5',mime_type:'text/html',
      file_name:'v2-secure-test.html',render_version:'2.0.0',
      sha256:'c'.repeat(64),size_bytes:255,uri:'/uploads/v2-secure-test.html',
      report_content_hash:source,report_record_hash:record}]
  };
  pkg.package_hash=store.sha256Canonical(pkg);
  return pkg;
}
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-v2-bridge-'));
 const previous=process.env.GEOGI_DELIVERY_PACKAGE_ROOT;
 process.env.GEOGI_DELIVERY_PACKAGE_ROOT=root;
 try {
  const pkg=packageV2();
  const html=Buffer.from('<!doctype html><html lang="zh"><body>GeoGi V2</body></html>');
  pkg.artifacts[0].sha256=crypto.createHash('sha256').update(html).digest('hex');
  pkg.artifacts[0].size_bytes=html.length;
  delete pkg.package_hash;
  pkg.package_hash=store.sha256Canonical(pkg);
  const uploadRoot=path.join(root,'uploads');
  fs.mkdirSync(uploadRoot);
  fs.writeFileSync(path.join(uploadRoot,pkg.artifacts[0].file_name),html);
  assert.equal(store.validateDeliveryPackage(pkg),pkg);
  assert.equal((await store.importDeliveryPackage(pkg)).imported,true);
  const args={client_id:pkg.client_id,project_id:pkg.project_id,
    delivery_package_id:pkg.delivery_package_id,artifact_sha256:pkg.artifacts[0].sha256};
  const {buildDeliveryAcknowledgement} = require('../src/services/os-operations-bridge');
  const v2Ack=buildDeliveryAcknowledgement(pkg,{imported:true,idempotent:false},null);
  assert.equal(v2Ack.status,'published');
  assert.equal(v2Ack.delivery_package_id,pkg.delivery_package_id);
  const v1Ack=buildDeliveryAcknowledgement({...pkg,release_authority:'baseline_diagnostic_release_v1'},
    {imported:true,idempotent:false},null);
  assert.equal(v1Ack.status,undefined);
  assert.equal(v1Ack.deliveryPackageId,pkg.delivery_package_id);
  const cap=bridge.capabilities();
  assert.equal(cap.release_authority,'geo_diagnostic_html_release_v2');
  assert.equal(bridge.isRevoked(pkg.delivery_package_id),false);
  const reader=require('../src/services/h5-reader-ticket').readVerifiedH5Artifact;
  const authentic={
    getCustomerReport:async ({clientId,projectId})=>({
      ok:clientId===pkg.client_id && projectId===pkg.project_id,
      report:{reportReady:true,deliveryPackageId:pkg.delivery_package_id,
        artifactSha256:pkg.artifacts[0].sha256}
    }),
    readVerifiedH5Artifact:reader,
    getUploadRoot:()=>uploadRoot,
  };
  const good=await bridge.verifyAccess(args, authentic);
  assert.equal(good.authorized,true);
  assert.equal(good.accessible,true);
  const wrong=await bridge.verifyAccess(args,{...authentic,
    getCustomerReport:async()=>({ok:true,report:{reportReady:false}})});
  assert.equal(wrong.authorized,false);
  assert.equal(wrong.accessible,false);

  assert.equal((await store.findDeliveryPackage({clientId:pkg.client_id,projectId:pkg.project_id})).delivery_package_id,pkg.delivery_package_id);
  await assert.rejects(()=>bridge.revoke({...args,artifact_sha256:'0'.repeat(64),reason:'qa'}),/SCOPE_MISMATCH/);
  assert.equal((await bridge.revoke({...args,reason:'test revocation'})).status,'revoked');
  assert.equal(bridge.isRevoked(pkg.delivery_package_id),true);
  assert.equal(await store.findDeliveryPackage({clientId:pkg.client_id,projectId:pkg.project_id}),null);
  const check=await bridge.verifyAccess(args);
  assert.equal(check.accessible,false);
  assert.equal(check.authorized,false);
  // Persistent revocation is not overwritten by another legitimate import.
  assert.equal((await store.importDeliveryPackage(pkg)).idempotent,true);
  assert.equal(bridge.isRevoked(pkg.delivery_package_id),true);
  const pdf=packageV2();
  pdf.artifacts[0].artifact_type='pdf';pdf.artifacts[0].mime_type='application/pdf';
  pdf.artifacts[0].file_name='report.pdf';
  delete pdf.package_hash;pdf.package_hash=store.sha256Canonical(pdf);
  assert.throws(()=>store.validateDeliveryPackage(pdf),/DELIVERY_ARTIFACT_TYPE_INVALID|DELIVERY_V2_HTML_REQUIRED/);
  assert(fs.existsSync(path.join(root,'v2-revocations',crypto.createHash('sha256').update(pkg.delivery_package_id).digest('hex')+'.revoked')));
  console.log('V2 bridge scoped revoke and customer-read fence passed');
 } finally {
  if(previous===undefined) delete process.env.GEOGI_DELIVERY_PACKAGE_ROOT;
  else process.env.GEOGI_DELIVERY_PACKAGE_ROOT=previous;
  fs.rmSync(root,{recursive:true,force:true});
 }
}
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports = { packageV2 };
