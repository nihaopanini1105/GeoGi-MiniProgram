'use strict';
const assert=require('node:assert/strict');
const {
 R03DeliveryError, isR03Package, capabilities, deniedBinding,
 deniedAccess, rejectR03Package, revokeR03, inspectR03PackageCandidate
}=require('../src/services/report-r03-bridge-boundary');
const original={...process.env};
try {
 const oldV21={delivery_purpose:'report_v21_diagnostic',release_authority:'geo_diagnostic_html_release_v21'};
 const oldV2={delivery_purpose:'baseline_diagnostic_report',release_authority:'geo_diagnostic_html_release_v2'};
 const r03={delivery_purpose:'report_r03_diagnostic',release_authority:'geo_diagnostic_html_release_r03'};
 assert.equal(isR03Package(oldV21),false);
 assert.equal(isR03Package(oldV2),false);
 assert.equal(isR03Package(null),false);
 assert.equal(rejectR03Package(oldV21),false);
 assert.equal(rejectR03Package(oldV2),false);
 for(const candidate of [r03,
   {...r03,delivery_purpose:'baseline_diagnostic_report'},
   {...r03,release_authority:'geo_diagnostic_html_release_v21'}]){
   assert.equal(isR03Package(candidate),true);
   assert.throws(()=>rejectR03Package(candidate),e=>e instanceof R03DeliveryError
      && e.code==='R03_RECEIVER_NOT_READY');
 }
 for(const flag of ['false','true']){
   process.env.GEOGI_REPORT_R03_PUBLISH_ENABLED=flag;
   process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED=flag;
   const c=capabilities();
   assert.equal(c.enabled,false);
   assert.equal(c.release_authority,'geo_diagnostic_html_release_r03');
   assert.equal(c.supports_18_section_same_snapshot_h5_pdf,false);
   assert.equal(c.production_release_approved,false);
   const binding=deniedBinding({client_id:'client_1',project_id:'project_1'});
   assert.equal(binding.verified,false);
   assert.equal(binding.independent_a01_epoch_verified,false);
   assert.equal(binding.sixteen_metrics_evidence_verified,false);
   assert.equal(binding.paid_order_verified,false);
   assert.equal(deniedAccess({delivery_package_id:'r03_1'}).accessible,false);
   assert.throws(()=>revokeR03(),/R03_RECEIVER_NOT_READY/);
 }
 // Route contract is owned by the real Express server: prevent a future
 // refactor silently sending independent R03 packages into V2/V21.
 const fs=require('node:fs'),path=require('node:path');
 const crypto=require('node:crypto');
 const fixture=require('./fixtures/report_v21_python_generated.json');
 const canonical=(v)=>Array.isArray(v)?v.map(canonical):
   v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const sha=(v)=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
 const checkHash=(v)=>{
   const x={...v}; delete x.package_hash;
   v.package_hash='sha256:'+sha(x);
   return v;
 };
 const candidate=checkHash({
   ...JSON.parse(JSON.stringify(fixture)),
   delivery_purpose:'report_r03_diagnostic',
   release_authority:'geo_diagnostic_html_release_r03',
   r03_current_cycle_source_readback:{
     lineage_contract:'r03_current_cycle_report_source_v1',
     status:'PROVENANCE_READBACK_ONLY_NOT_PUBLISHED',
     source_observation_batch_id:'observation_batch_current',
     source_score_snapshot_id:'score_snapshot_current',
     source_retest_comparison_id:'retest_comparison_current',
     source_report_snapshot_sha256:fixture.report_reference.content_hash,
     customer_release_authorized:true,
     independent_a01_epoch_verified:true,
     real_customer_business_accepted:false
   }
 });
 const inspected=inspectR03PackageCandidate(candidate);
 assert.equal(inspected.status,'R03_STRUCTURAL_ONLY_NOT_AUTHORIZED');
 assert.equal(inspected.structural_contract_valid,true);
 assert.equal(inspected.paid_binding_verified,false);
 assert.equal(inspected.customer_release_approved,false);
 assert.equal(capabilities().enabled,false);
 function deniedPatch(change, code) {
   const tampered=JSON.parse(JSON.stringify(candidate));
   change(tampered);
   checkHash(tampered);
   assert.throws(()=>inspectR03PackageCandidate(tampered),e=>
     e instanceof R03DeliveryError && e.code===code);
 }
 deniedPatch(v=>{v.r03_current_cycle_source_readback.source_score_snapshot_id='';},
   'R03_CANDIDATE_SOURCE_PINS_INVALID');
 deniedPatch(v=>{v.r03_current_cycle_source_readback.independent_a01_epoch_verified=false;},
   'R03_CANDIDATE_SOURCE_PINS_INVALID');
 deniedPatch(v=>{v.r03_current_cycle_source_readback.source_report_snapshot_sha256='sha256:'+'a'.repeat(64);},
   'R03_CANDIDATE_SNAPSHOT_MISMATCH');
 deniedPatch(v=>{v.artifacts[1].file_name='GeoGi-V21-malicious.pdf';},
   'R03_CANDIDATE_PAIRED_ARTIFACT_CONTRACT_INVALID');
 deniedPatch(v=>{v.artifacts[0].sha256='a'.repeat(64);},
   'R03_CANDIDATE_PAIRED_ARTIFACT_CONTRACT_INVALID');
 deniedPatch(v=>{v.report_reference.report_record_hash='sha256:'+'b'.repeat(64);},
   'R03_CANDIDATE_PAIRED_ARTIFACT_CONTRACT_INVALID');
 deniedPatch(v=>{v.delivery_package_id='delivery_package_v21_'+'f'.repeat(24);},
   'R03_CANDIDATE_PAIRED_ARTIFACT_CONTRACT_INVALID');
 deniedPatch(v=>{v.display_policy.client_scoring_allowed=true;},
   'R03_CANDIDATE_PAIRED_ARTIFACT_CONTRACT_INVALID');
 deniedPatch(v=>{v.delivery_purpose='report_v21_diagnostic';},
   'R03_CANDIDATE_CONTRACT_INVALID');
 const hashTampered={...candidate, client_id:'client_other'};
 assert.throws(()=>inspectR03PackageCandidate(hashTampered),e=>
   e instanceof R03DeliveryError && e.code==='R03_CANDIDATE_HASH_MISMATCH');

 const server=fs.readFileSync(path.join(__dirname,'../src/server.js'),'utf8');
 assert(server.includes("rejectR03Package(payload);"));
 assert(server.includes("inspectR03PackageCandidate(req.body||{})"));
 assert(server.includes("app.post('/internal/os/report-r03/inspect-candidate', requireOsBridge"));
 assert(server.indexOf("rejectR03Package(payload);") < server.indexOf("publishV21DeliveryPackage(payload)"));
 for(const segment of [
 '/internal/os/report-r03/capabilities',
 '/internal/os/report-r03/inspect-candidate',
 '/internal/os/report-r03/verify-customer-binding',
 '/internal/os/report-r03/verify-customer-access',
 '/internal/os/report-r03/revoke'
 ]) assert(server.includes(segment),segment);
 console.log('PASS: R03 receiver pending is an isolated default-OFF 403 boundary; legacy V2/V21 preserved');
} finally {process.env=original;}
