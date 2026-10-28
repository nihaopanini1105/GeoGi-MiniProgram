'use strict';
const assert=require('node:assert/strict');
const {
 R03DeliveryError, isR03Package, capabilities, deniedBinding,
 deniedAccess, rejectR03Package, revokeR03
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
 const server=fs.readFileSync(path.join(__dirname,'../src/server.js'),'utf8');
 assert(server.includes("rejectR03Package(payload);"));
 for(const segment of [
 '/internal/os/report-r03/capabilities',
 '/internal/os/report-r03/verify-customer-binding',
 '/internal/os/report-r03/verify-customer-access',
 '/internal/os/report-r03/revoke'
 ]) assert(server.includes(segment),segment);
 console.log('PASS: R03 receiver pending is an isolated default-OFF 403 boundary; legacy V2/V21 preserved');
} finally {process.env=original;}
