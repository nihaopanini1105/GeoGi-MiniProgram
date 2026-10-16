'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {
  sha256Canonical,validateDeliveryPackage,DeliveryPackageError,
  importDeliveryPackage,findDeliveryPackage,projectDeliveryForCustomer,
  revokeDeliveryPackage
}=require('../src/services/delivery-package-store');
// The production bridge loads multer and Express; the immutable-package
// staging gate intentionally does not install runtime deps. Test the bridge
// route/authority contract as source and run store mutations with plain Node.
const bridgeSource=fs.readFileSync(path.join(__dirname,
  '../src/services/report-v2-bridge-operations.js'),'utf8');
const routeSource=fs.readFileSync(path.join(__dirname,
  '../src/server.js'),'utf8');
const V21_RELEASE_AUTHORITY='geo_diagnostic_html_release_v21';

function make(id,v21) {
  const stem=v21?'GeoGi-V21-0123456789abcdef':'GeoGi-V2-0123456789abcdef';
  const contentHash='sha256:'+'a'.repeat(64),recordHash='sha256:'+'b'.repeat(64);
  const report_version=2;
  const payload={
    object_type:'delivery_package',delivery_contract_version:'3.0.0',
    delivery_mode:'artifact_only',production_authority:'geogi_os',
    delivery_purpose:v21?'report_v21_diagnostic':'baseline_diagnostic_report',
    release_authority:v21?V21_RELEASE_AUTHORITY:'geo_diagnostic_html_release_v2',
    delivery_package_id:id,client_id:'client_test',project_id:'project_test',
    release_status:'released',
    released_at:v21?'2026-10-16T14:00:00Z':'2026-10-15T14:00:00Z',
    report_reference:{
      report_id:v21?'report-v21-test':'report-v2-test',
      report_type:'client_geo_diagnostic',report_version,
      object_version:v21?'2.1.0':'2.0.0',
      content_hash:contentHash,report_record_hash:recordHash
    },
    version_pins:{
      report_schema_version:v21?'2.1.0':'2.0.0',
      report_object_version:v21?'2.1.0':'2.0.0',
      report_version,
      release_record_version:v21?'2.1.0':'2.0.0',
      artifact_render_version:v21?'report-v21-customer-1':'report-v2-customer-1',
      canonical_client_id:'client_test',
      canonical_project_id:'project_test',
      ...(v21?{display_report_version:'2.1'}:{})
    },
    display_policy:{
      artifact_only:true,client_recomposition_allowed:false,
      client_scoring_allowed:false,client_summary_generation_allowed:false,
      client_diagnosis_generation_allowed:false
    },
    artifacts:[
      {
        artifact_id:'test-h5-'+(v21?'21':'2'),artifact_type:'h5',
        mime_type:'text/html',file_name:stem+'.html',
        render_version:v21?'report-v21-customer-1':'report-v2-customer-1',
        uri:'https://api.geogi.cn/uploads/'+stem+'.html',
        sha256:'c'.repeat(64),size_bytes:50000,
        report_content_hash:contentHash,report_record_hash:recordHash
      },
      {
        artifact_id:'test-pdf-'+(v21?'21':'2'),artifact_type:'pdf',
        mime_type:'application/pdf',file_name:stem+'.pdf',
        render_version:v21?'report-v21-customer-1':'report-v2-customer-1',
        uri:'https://api.geogi.cn/uploads/'+stem+'.pdf',
        sha256:'d'.repeat(64),size_bytes:50000,
        report_content_hash:contentHash,report_record_hash:recordHash
      }
    ]
  };
  payload.package_hash=sha256Canonical(payload);
  return payload;
}
function expectCode(fn,code) {
  assert.throws(fn,e=>e instanceof DeliveryPackageError&&e.code===code);
}
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-v21-bridge-'));
  const priorRoot=process.env.GEOGI_DELIVERY_PACKAGE_ROOT;
  const priorFlag=process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED;
  try {
    process.env.GEOGI_DELIVERY_PACKAGE_ROOT=root;
    delete process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED;
    const old=make('delivery_package_old_test0001',false);
    const next=make('delivery_package_new_test0001',true);
    assert(bridgeSource.includes("const V21_RELEASE_AUTHORITY='geo_diagnostic_html_release_v21'"));
    assert(bridgeSource.includes("function reportV21Capabilities()"));
    assert(bridgeSource.includes("enabled: v21Enabled()"));
    assert(bridgeSource.includes("revision_does_not_resettle_payment_or_commission: true"));
    assert(routeSource.includes("'/internal/os/report-v21/capabilities'"));
    assert(routeSource.includes("'/internal/os/report-v21/verify-customer-access'"));
    assert(routeSource.includes("'/internal/os/report-v21/revoke'"));
    assert(routeSource.includes("requireOsBridge"));
    validateDeliveryPackage(old);
    expectCode(()=>validateDeliveryPackage(next),'V21_DELIVERY_FEATURE_NOT_ACTIVATED');
    await importDeliveryPackage(old);
    assert.strictEqual((await findDeliveryPackage({
      clientId:'client_test',projectId:'project_test'
    })).delivery_package_id,old.delivery_package_id);
    process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED='true';
    assert.strictEqual(process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED,'true');
    validateDeliveryPackage(next);
    const saved=await importDeliveryPackage(next);
    assert.strictEqual(saved.imported,true);
    assert.strictEqual((await importDeliveryPackage(next)).idempotent,true);
    const selected=await findDeliveryPackage({clientId:'client_test',projectId:'project_test'});
    assert.strictEqual(selected.delivery_package_id,next.delivery_package_id);
    assert.strictEqual(
      projectDeliveryForCustomer(selected,{clientId:'client_test',projectId:'project_test'})
        .displayReportVersion,'2.1');
    const mixed=JSON.parse(JSON.stringify(next));
    mixed.artifacts[1].file_name='GeoGi-V21-ffffffffffffffff.pdf';
    delete mixed.package_hash;mixed.package_hash=sha256Canonical(mixed);
    expectCode(()=>validateDeliveryPackage(mixed),'V21_ARTIFACTS_MUST_BE_ONE_FROZEN_REVISION');
    const fake=JSON.parse(JSON.stringify(next));
    fake.artifacts[0].file_name='GeoGi-V2-0123456789abcdef.html';
    delete fake.package_hash;fake.package_hash=sha256Canonical(fake);
    expectCode(()=>validateDeliveryPackage(fake),'DELIVERY_ARTIFACT_TYPE_INVALID');
    const mismatched=JSON.parse(JSON.stringify(next));
    mismatched.report_reference.object_version='2.0.0';
    delete mismatched.package_hash;mismatched.package_hash=sha256Canonical(mismatched);
    expectCode(()=>validateDeliveryPackage(mismatched),'V21_EXPLICIT_VERSION_PINS_REQUIRED');
    assert(!await findDeliveryPackage({clientId:'another_client',projectId:'project_test'}));
    const rev=await revokeDeliveryPackage(next.delivery_package_id,{
      clientId:'client_test',projectId:'project_test',reason:'versioned regression rollback'
    });
    assert.strictEqual(rev.status,'revoked');
    assert.strictEqual((await findDeliveryPackage({
      clientId:'client_test',projectId:'project_test'
    })).delivery_package_id,old.delivery_package_id);
    process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED='false';
    assert.strictEqual(process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED,'false');
    assert.strictEqual((await findDeliveryPackage({
      clientId:'client_test',projectId:'project_test'
    })).delivery_package_id,old.delivery_package_id);
    console.log('GEOGI V21 MINIPROGRAM VERSIONED BRIDGE: PASS');
  } finally {
    if(priorRoot===undefined)delete process.env.GEOGI_DELIVERY_PACKAGE_ROOT;
    else process.env.GEOGI_DELIVERY_PACKAGE_ROOT=priorRoot;
    if(priorFlag===undefined)delete process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED;
    else process.env.GEOGI_REPORT_V21_CUSTOMER_DELIVERY_ENABLED=priorFlag;
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
