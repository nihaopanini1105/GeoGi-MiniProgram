'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createV21Bridge,capabilities,validatePackage,V21DeliveryError}=require('../src/services/report-v21-bridge-operations');
const sha=d=>crypto.createHash('sha256').update(d).digest('hex');
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v!==null&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=canonical(v[k]);return o;}return v;}
const enc=v=>JSON.stringify(canonical(v));
function fixture(upload){
 const client='client_one',project='project_one',snapshot=sha('snapshot');
 const html=Buffer.from('<!doctype html><html><body>synthetic report</body></html>');
 const pdf=Buffer.from('%PDF-1.7\n'+'synthetic PDF\n'.repeat(1200));
 const contentHash='sha256:'+snapshot;
 const recordHash='sha256:'+sha(enc({client,project,snapshot_sha256:snapshot,
   report_object_version:'2.1.0',html_sha256:sha(html),pdf_sha256:sha(pdf)}));
 const stem=sha(['V21',client,project,snapshot,sha(html),sha(pdf)].join(':')).slice(0,16);
 const name='GeoGi-V21-'+stem;
 const artifacts=[['h5','text/html',html,'html'],['pdf','application/pdf',pdf,'pdf']].map(([kind,mime,raw,extension])=>({
  artifact_id:'v21_'+kind+'_'+stem,artifact_type:kind,mime_type:mime,
  file_name:name+'.'+extension,render_version:'report-v21-customer-1',
  uri:'https://assets.example/'+name+'.'+extension,
  sha256:sha(raw),size_bytes:raw.length,report_content_hash:contentHash,report_record_hash:recordHash
 }));
 fs.mkdirSync(upload,{recursive:true});for(const [kind,mime,raw,extension] of [['h5','text/html',html,'html'],['pdf','application/pdf',pdf,'pdf']]){
  fs.writeFileSync(path.join(upload,name+'.'+extension),raw,{mode:0o600});
 }
 const p={object_type:'delivery_package',delivery_contract_version:'3.0.0',delivery_mode:'artifact_only',
 production_authority:'geogi_os',delivery_purpose:'report_v21_diagnostic',
 release_authority:'geo_diagnostic_html_release_v21',delivery_package_id:'delivery_package_v21_'+sha([client,project,snapshot,sha(html),sha(pdf)].join(':')).slice(0,24),
 client_id:client,project_id:project,release_status:'released',released_at:'2026-10-20T12:00:00Z',
 report_reference:{report_id:'GEO-V21-'+snapshot.slice(0,12).toUpperCase(),report_type:'client_geo_diagnostic',report_version:2,
 object_version:'2.1.0',content_hash:contentHash,report_record_hash:recordHash},
 version_pins:{report_schema_version:'2.1.0',report_object_version:'2.1.0',report_version:2,
 release_record_version:'2.1.0',artifact_render_version:'report-v21-customer-1',canonical_client_id:client,
 canonical_project_id:project,display_report_version:'2.1'},
 display_policy:{artifact_only:true,client_recomposition_allowed:false,client_scoring_allowed:false,
 client_summary_generation_allowed:false,client_diagnosis_generation_allowed:false},artifacts};
 p.package_hash='sha256:'+sha(enc(p));return p;
}
(async()=>{
 const previous={...process.env};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-v21-'));
 const uploads=path.join(root,'uploads');const data=path.join(root,'v21');
 try{
  const doc=fixture(uploads);
  const lead={clientId:doc.client_id,projectId:doc.project_id,project:{clientId:doc.client_id,projectId:doc.project_id}};
  let payment={clientId:doc.client_id,projectId:doc.project_id,status:'paid',paidAt:'2026-10-20T01:00:00Z'};
  const bridge=createV21Bridge({findIntakes:async()=>[lead],findPayment:async()=>payment,uploadRoot:uploads,dataRoot:data});
  assert.throws(()=>createV21Bridge({findIntakes:async()=>[lead],findPayment:async()=>payment,
    uploadRoot:uploads,dataRoot:path.join(uploads,'private')}),/V21_PRIVATE_STORE_OUTSIDE_PUBLIC_UPLOADS_REQUIRED/);
  // The path is lexically private, but an existing symlink points into the
  // public static upload root. This must fail at initialization.
  const alias=path.join(root,'outside-looking-symlink');
  fs.symlinkSync(uploads,alias,'dir');
  assert.throws(()=>createV21Bridge({findIntakes:async()=>[lead],findPayment:async()=>payment,
    uploadRoot:uploads,dataRoot:path.join(alias,'private')}),/V21_PRIVATE_STORE_OUTSIDE_PUBLIC_UPLOADS_REQUIRED/);
  const dangling=path.join(root,'dangling-private-symlink');
  fs.symlinkSync(path.join(root,'non-existent-private'),dangling,'dir');
  assert.throws(()=>createV21Bridge({findIntakes:async()=>[lead],findPayment:async()=>payment,
    uploadRoot:uploads,dataRoot:dangling}),/V21_PRIVATE_STORE_PHYSICAL_PATH_INVALID/);
  // /source-codes is independently public. A private store must not be
  // located there or reachable through a symlink to that second static root.
  const publicCodes=path.join(root,'source-codes-public');
  fs.mkdirSync(publicCodes,{recursive:true});
  assert.throws(()=>createV21Bridge({
    findIntakes:async()=>[lead],findPayment:async()=>payment,
    uploadRoot:uploads,dataRoot:path.join(publicCodes,'reports'),publicRoots:[publicCodes]
  }),/V21_PRIVATE_STORE_OUTSIDE_PUBLIC_UPLOADS_REQUIRED/);
  const codesLink=path.join(root,'private-looking-codes-link');
  fs.symlinkSync(publicCodes,codesLink,'dir');
  assert.throws(()=>createV21Bridge({
    findIntakes:async()=>[lead],findPayment:async()=>payment,
    uploadRoot:uploads,dataRoot:path.join(codesLink,'reports'),publicRoots:[publicCodes]
  }),/V21_PRIVATE_STORE_OUTSIDE_PUBLIC_UPLOADS_REQUIRED/);
    // A non-public root is not enough when a service-owned subdirectory is
  // symlinked into the static upload directory, leaking customer package data.
  for (const folder of ['packages','pointers','revocations','locks']) {
    const isolated=path.join(root,'private-with-'+folder);
    fs.mkdirSync(isolated,{recursive:true});
    fs.symlinkSync(uploads,path.join(isolated,folder),'dir');
    assert.throws(()=>createV21Bridge({
      findIntakes:async()=>[lead],findPayment:async()=>payment,
      uploadRoot:uploads,dataRoot:isolated
    }),/V21_PRIVATE_STORE_DIRECTORY_INVALID/);
  }
  assert.equal(capabilities().enabled,false);
  assert.equal((await bridge.binding(doc.client_id,doc.project_id)).verified,false);
  await assert.rejects(bridge.publish(doc),/V21_PUBLICATION_DISABLED/);
  process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED='true';
  process.env.GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED='true';
  assert.equal(capabilities().general_customer_delivery_enabled,true);
  assert.equal((await bridge.binding(doc.client_id,doc.project_id)).verified,true);
  assert.equal(validatePackage(doc),doc);
  const osPythonFixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/report_v21_python_generated.json')));
  assert.equal(validatePackage(osPythonFixture),osPythonFixture);
  let x=await bridge.publish(doc);assert.equal(x.payment_mutated,false);assert.equal(x.commission_mutated,false);
  assert.equal(x.idempotent,false);
  x=await bridge.publish(doc);assert.equal(x.idempotent,true);
  assert.equal((await bridge.accessible({client_id:doc.client_id,project_id:doc.project_id,
   delivery_package_id:doc.delivery_package_id,artifact_sha256:doc.artifacts[0].sha256})).accessible,true);
  assert.equal((await bridge.currentReport(doc.client_id,doc.project_id)).version,'2.1');
  assert.equal(await bridge.currentReport('other_client',doc.project_id),null);
  assert.equal((await bridge.accessible({client_id:'other_client',project_id:doc.project_id,
   delivery_package_id:doc.delivery_package_id,artifact_sha256:doc.artifacts[0].sha256})).accessible,false);
  const tampered=structuredClone(doc);tampered.artifacts[0].sha256='0'.repeat(64);
  assert.throws(()=>validatePackage(tampered),/V21_PACKAGE_CANONICAL_IDENTITY_MISMATCH/);
  // Even a freshly recomputed outer package hash may not reassign the
  // evidence-linked report ID or individual artifact identities.
  for (const changed of ['report_id','artifact_id']) {
    const manipulated=structuredClone(doc);
    if (changed==='report_id') manipulated.report_reference.report_id='GEO-V21-MALICIOUSID';
    else manipulated.artifacts[0].artifact_id='v21_h5_unrelated012345';
    const unsigned={...manipulated};delete unsigned.package_hash;
    manipulated.package_hash='sha256:'+sha(enc(unsigned));
    assert.throws(()=>validatePackage(manipulated),/V21_PACKAGE_CANONICAL_IDENTITY_MISMATCH/);
  }

  payment={...payment,status:'refunded'};
  assert.equal((await bridge.binding(doc.client_id,doc.project_id)).verified,false);
  assert.equal(await bridge.currentReport(doc.client_id,doc.project_id),null);
  payment={...payment,status:'paid'};
  const rev=await bridge.revoke({client_id:doc.client_id,project_id:doc.project_id,
    delivery_package_id:doc.delivery_package_id,artifact_sha256:doc.artifacts[0].sha256,reason:'test_revoke'});
  assert.equal(rev.status,'revoked');
  assert.equal(rev.idempotent,false);
  const revokedFile=path.join(data,'revocations',doc.delivery_package_id+'.json');
  const firstRevocation=fs.readFileSync(revokedFile,'utf8');
  const again=await bridge.revoke({client_id:doc.client_id,project_id:doc.project_id,
    delivery_package_id:doc.delivery_package_id,artifact_sha256:doc.artifacts[0].sha256,reason:'test_revoke'});
  assert.equal(again.idempotent,true);
  assert.equal(fs.readFileSync(revokedFile,'utf8'),firstRevocation);
  const concurrent=await Promise.all([0,1,2].map(()=>bridge.revoke({
    client_id:doc.client_id,project_id:doc.project_id,
    delivery_package_id:doc.delivery_package_id,artifact_sha256:doc.artifacts[0].sha256,reason:'test_revoke'})));
  assert(concurrent.every(x=>x.idempotent));
  const changed=JSON.parse(firstRevocation);changed.client_id='other_client';
  fs.writeFileSync(revokedFile,JSON.stringify(changed)+'\n');
  await assert.rejects(bridge.revoke({client_id:doc.client_id,project_id:doc.project_id,
    delivery_package_id:doc.delivery_package_id,artifact_sha256:doc.artifacts[0].sha256,reason:'test_revoke'}),
    /V21_REVOCATION_IMMUTABLE_SCOPE_CONFLICT/);
  fs.writeFileSync(revokedFile,firstRevocation);
  assert.equal(await bridge.currentReport(doc.client_id,doc.project_id),null);
  await assert.rejects(bridge.publish(doc),/V21_REVOKED_PACKAGE_CANNOT_REPUBLISH/);
  // Pilot review is an explicit separate grant; it cannot make generic
  // customers eligible or bypass the real customer/project registry.
  process.env.GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED='false';
  process.env.GEOGI_V2_EXACT_PILOT_ENABLED='true';
  process.env.GEOGI_V2_PILOT_CONSUMER_CLIENT_ID=doc.client_id;
  process.env.GEOGI_V2_PILOT_CONSUMER_PROJECT_ID=doc.project_id;
  payment={...payment,status:'refunded'};
  const pilot=createV21Bridge({findIntakes:async()=>[lead],findPayment:async()=>payment,
    uploadRoot:uploads,dataRoot:path.join(root,'pilot')});
  assert.equal((await pilot.binding(doc.client_id,doc.project_id)).verified,false);
  assert.equal((await pilot.publish(doc)).payment_mutated,false);
  assert.equal((await pilot.currentReport(doc.client_id,doc.project_id)).version,'2.1');
  process.env.GEOGI_V2_EXACT_PILOT_ENABLED='false';
  assert.equal(await pilot.currentReport(doc.client_id,doc.project_id),null);
  process.env.GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED='true';
  const bad=structuredClone(doc);bad.version_pins.report_object_version='2.0.0';
  assert.throws(()=>validatePackage(bad),/V21_VERSION_PINS_INVALID/);
  console.log('V21 bridge regression: 27 assertions passed, including isolation/revocation/pilot guards');
 }finally{fs.rmSync(root,{recursive:true,force:true});process.env=previous;}
})().catch(e=>{console.error(e);process.exitCode=1});