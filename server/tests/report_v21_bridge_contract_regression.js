'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-v21-contract-'));
process.env.GEOGI_DELIVERY_PACKAGE_ROOT=root;
const {
  sha256Canonical,validateDeliveryPackage,importDeliveryPackage,
  getDeliveryPackageById,findDeliveryPackage,projectDeliveryForCustomer,
  revokeDeliveryPackage
}=require('../src/services/delivery-package-store');
const v21=require('../src/services/report-v21-bridge-operations');

function pkg(version='v21'){
  const isV21=version==='v21';
  const stem=isV21?'GeoGi-V21-aaaaaaaaaaaaaaaa':'GeoGi-V2-aaaaaaaaaaaaaaaa';
  const obj={
    object_type:'delivery_package',delivery_contract_version:'3.0.0',
    delivery_mode:'artifact_only',production_authority:'geogi_os',
    delivery_purpose:isV21?'report_v21_diagnostic':'baseline_diagnostic_report',
    release_authority:isV21?'geo_diagnostic_html_release_v21':'geo_diagnostic_html_release_v2',
    delivery_package_id:isV21?'delivery_package_v21_'+'a'.repeat(24):'delivery_package_test_v2_001',
    project_id:'GG-P-202609-709405',client_id:'GG-202609-0001',
    release_status:'released',released_at:isV21?'2026-10-16T12:00:00Z':'2026-10-15T12:00:00Z',
    report_reference:{
      report_id:isV21?'GEO-V21-CHECK':'GEO-V2-CHECK',
      report_type:'client_geo_diagnostic',
      report_version:2,object_version:isV21?'2.1.0':'2.0.0',
      content_hash:'sha256:'+'a'.repeat(64),report_record_hash:'sha256:'+'b'.repeat(64)
    },
    version_pins:{
      report_schema_version:isV21?'2.1.0':'2.0.0',
      report_object_version:isV21?'2.1.0':'2.0.0',
      report_version:2,
      release_record_version:isV21?'2.1.0':'2.0.0',
      artifact_render_version:isV21?'report-v21-customer-1':'report-v2-customer-1',
      canonical_client_id:'client_test',canonical_project_id:'project_test'
    },
    display_policy:{
      artifact_only:true,client_recomposition_allowed:false,
      client_scoring_allowed:false,client_summary_generation_allowed:false,
      client_diagnosis_generation_allowed:false
    },
    artifacts:[
      {artifact_id:'h5',artifact_type:'h5',mime_type:'text/html',
       file_name:stem+'.html',sha256:'c'.repeat(64),size_bytes:300,
       uri:'https://api.geogi.cn/uploads/'+stem+'.html',
       render_version:isV21?'report-v21-customer-1':'report-v2-customer-1',
       report_content_hash:'sha256:'+'a'.repeat(64),
       report_record_hash:'sha256:'+'b'.repeat(64)},
      {artifact_id:'pdf',artifact_type:'pdf',mime_type:'application/pdf',
       file_name:stem+'.pdf',sha256:'d'.repeat(64),size_bytes:800,
       uri:'https://api.geogi.cn/uploads/'+stem+'.pdf',
       render_version:isV21?'report-v21-customer-1':'report-v2-customer-1',
       report_content_hash:'sha256:'+'a'.repeat(64),
       report_record_hash:'sha256:'+'b'.repeat(64)}
    ]
  };
  if(isV21)obj.version_pins.display_report_version='2.1';
  obj.package_hash=sha256Canonical(obj);
  return obj;
}
function verifyFailure(obj,expected){
  let caught;try{validateDeliveryPackage(obj)}catch(e){caught=e}
  assert(caught,expected);assert.strictEqual(caught.code,expected);
}
function rehash(obj){delete obj.package_hash;obj.package_hash=sha256Canonical(obj);return obj;}
async function main(){
  delete process.env.GEOGI_REPORT_V21_BRIDGE_ENABLED;
  assert.strictEqual(v21.reportV21Capabilities().enabled,false);
  const v2=pkg('v2');
  validateDeliveryPackage(v2);
  verifyFailure(pkg('v21'),'V21_DELIVERY_FEATURE_NOT_ACTIVATED');
  await importDeliveryPackage(v2);
  assert.strictEqual((await findDeliveryPackage({clientId:v2.client_id,projectId:v2.project_id})).delivery_package_id,v2.delivery_package_id);

  process.env.GEOGI_REPORT_V21_BRIDGE_ENABLED='true';
  assert.strictEqual(v21.reportV21Capabilities().enabled,true);
  assert.strictEqual(v21.reportV21Capabilities().revision_does_not_resettle_payment_or_commission,true);
  const newer=pkg('v21');
  validateDeliveryPackage(newer);
  const expectedKinds=newer.artifacts.map(x=>x.artifact_type).join('/');
  assert.strictEqual(expectedKinds,'h5/pdf');
  const badPrefix=JSON.parse(JSON.stringify(newer));
  badPrefix.artifacts[0].file_name=v2.artifacts[0].file_name;
  rehash(badPrefix);
  verifyFailure(badPrefix,'DELIVERY_ARTIFACT_TYPE_INVALID');
  const badPins=JSON.parse(JSON.stringify(newer));
  badPins.version_pins.display_report_version='2';
  rehash(badPins);
  verifyFailure(badPins,'V21_STRICT_VERSION_OR_AUTHORITY_INVALID');
  await importDeliveryPackage(newer);
  // OS -> MiniProgram V2.1 uses the distinct revision branch. It must NOT
  // invoke the legacy Feishu stage, payment completion or commission path.
  const historical=require('../src/services/report-v2-bridge-operations');
  const previousVerifier=historical.verifyGeoGiPilotBinding;
  historical.verifyGeoGiPilotBinding=async()=>({ready:true});
  try {
    const {publishOsDeliveryPackage}=require('../src/services/os-operations-bridge');
    const released=await publishOsDeliveryPackage(newer);
    assert.strictEqual(released.status,'published');
    assert.strictEqual(released.payment_mutated,false);
    assert.strictEqual(released.commission_mutated,false);
    assert.strictEqual(released.historical_v2_unchanged,true);
  } finally {
    historical.verifyGeoGiPilotBinding=previousVerifier;
  }
  const again=await importDeliveryPackage(newer);
  assert.strictEqual(again.idempotent,true);
  assert.strictEqual((await getDeliveryPackageById(v2.delivery_package_id)).package_hash,v2.package_hash);
  const current=await findDeliveryPackage({clientId:newer.client_id,projectId:newer.project_id});
  assert.strictEqual(current.delivery_package_id,newer.delivery_package_id);
  assert.strictEqual(projectDeliveryForCustomer(current,{
    clientId:newer.client_id,projectId:newer.project_id}).displayReportVersion,'2.1');
  assert.strictEqual((await v21.verifyReportV21CustomerAccess({
      delivery_package_id:newer.delivery_package_id,client_id:'other',
      project_id:newer.project_id,artifact_sha256:newer.artifacts[0].sha256
  })).accessible,false);
  const denied=await v21.verifyReportV21CustomerAccess({
    delivery_package_id:newer.delivery_package_id,
    client_id:newer.client_id,project_id:newer.project_id,
    artifact_sha256:'f'.repeat(64)
  });
  assert.strictEqual(denied.accessible,false);

  await v21.revokeReportV21Delivery({
    delivery_package_id:newer.delivery_package_id,
    client_id:newer.client_id,project_id:newer.project_id,
    artifact_sha256:newer.artifacts[0].sha256,
    reason:'automated rollback test'
  });
  assert.strictEqual((await findDeliveryPackage({
    clientId:v2.client_id,projectId:v2.project_id})).delivery_package_id,v2.delivery_package_id);
  assert.strictEqual((await getDeliveryPackageById(v2.delivery_package_id)).package_hash,v2.package_hash);
  const legacy=require('../src/services/report-v2-bridge-operations');
  assert.strictEqual(legacy.reportV2Capabilities().release_authority,'geo_diagnostic_html_release_v2');
  console.log('GEOGI_REPORT_V21_BRIDGE_REGRESSION=PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;})
  .finally(()=>fs.rmSync(root,{recursive:true,force:true}));
