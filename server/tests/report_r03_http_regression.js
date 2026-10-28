'use strict';
// Real Express HTTP and disk receipts. All CRM/payment/grants here are synthetic.
const assert=require('node:assert/strict');const fs=require('node:fs');
const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const {spawn}=require('node:child_process');const {once}=require('node:events');
const {packageScope,validatePackage,reportR03Capabilities,loadReleaseGrants}=require('../src/services/report-r03-bridge-operations');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>JSON.stringify(canonical(v));
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'geogi-r03-real-http-')));
const checked=[];const check=(name,value)=>{assert(value,name);checked.push(name);};
const client='client_http_r03',project='project_http_r03',snapshot=sha('synthetic frozen snapshot');
const html=Buffer.from('<!doctype html><html lang="zh"><body><h1>合成 R03 技术链路</h1></body></html>');
const pdf=Buffer.from('%PDF-1.7\n'+('SYNTHETIC-ONLY PDF\n'.repeat(1200)));
const hd=sha(html),pd=sha(pdf),stem=sha(['V21',client,project,snapshot,hd,pd].join(':')).slice(0,16);
const record='sha256:'+sha(encode({client,project,snapshot_sha256:snapshot,report_object_version:'2.1.0',html_sha256:hd,pdf_sha256:pd}));
const pack=structuredClone(require('./fixtures/report_v21_python_generated.json'));
Object.assign(pack,{client_id:client,project_id:project,delivery_purpose:'report_r03_diagnostic',
 release_authority:'geo_diagnostic_html_release_r03',released_at:new Date().toISOString(),
 delivery_package_id:'delivery_package_v21_'+sha([client,project,snapshot,hd,pd].join(':')).slice(0,24),
 report_reference:{report_id:'GEO-V21-'+snapshot.slice(0,12).toUpperCase(),report_type:'client_geo_diagnostic',
 report_version:2,object_version:'2.1.0',content_hash:'sha256:'+snapshot,report_record_hash:record}});
pack.version_pins.canonical_client_id=client;pack.version_pins.canonical_project_id=project;
pack.artifacts=[['h5','text/html',html,'html'],['pdf','application/pdf',pdf,'pdf']].map(([kind,mime,body,ext])=>({
 artifact_id:'v21_'+kind+'_'+stem,artifact_type:kind,mime_type:mime,file_name:'GeoGi-V21-'+stem+'.'+ext,
 render_version:'report-v21-customer-1',uri:'https://artifacts.synthetic.invalid/GeoGi-V21-'+stem+'.'+ext,
 sha256:sha(body),size_bytes:body.length,report_content_hash:'sha256:'+snapshot,report_record_hash:record}));
pack.r03_current_cycle_source_readback={lineage_contract:'r03_current_cycle_report_source_v1',
 status:'PROVENANCE_READBACK_ONLY_NOT_PUBLISHED',source_observation_batch_id:'synthetic_batch',
 source_score_snapshot_id:'synthetic_score',source_retest_comparison_id:'synthetic_retest',
 source_report_snapshot_sha256:'sha256:'+snapshot,independent_a01_epoch_verified:true,
 customer_release_authorized:true,real_customer_business_accepted:false};
const definition={object_type:'diagnostic_report',object_id:'diagnostic_report_r03_'+snapshot,
 diagnostic_report_id:'diagnostic_report_r03_'+snapshot,report_id:'diagnostic_report_r03_'+snapshot,
 display_report_id:pack.report_reference.report_id,object_version:'2.1.0',client_id:client,project_id:project,
 content_hash:'sha256:'+snapshot,snapshot_sha256:snapshot,report_snapshot_id:'report_snapshot_r03_'+snapshot,
 html_sha256:hd,pdf_sha256:pd,...Object.fromEntries(['source_observation_batch_id','source_score_snapshot_id','source_retest_comparison_id'].map(k=>[k,pack.r03_current_cycle_source_readback[k]])),
 r03_source_object_pins:Object.fromEntries(['query_set','platform_test_plan','observation_batch','score_snapshot','optimization_plan','retest_run','retest_comparison','outcome_assessment'].map(k=>[k,{object_id:pack.r03_current_cycle_source_readback['source_'+k+'_id']||'synthetic_'+k,object_version:'1.0.0',payload_sha256:sha(k)}]))};
definition.report_record_hash='sha256:'+sha(encode(definition));pack.r03_report_definition=definition;
pack.report_reference.reference_id=definition.object_id;pack.report_reference.reference_object_type='diagnostic_report';
pack.report_reference.report_record_hash=definition.report_record_hash;
pack.artifacts.forEach(a=>a.report_record_hash=definition.report_record_hash);
delete pack.package_hash;pack.package_hash='sha256:'+sha(encode(pack));
const scope=packageScope(pack);
const grant={...scope,contract:'r03-release-grant/1',grant_id:'synthetic_release_grant_01',
 issued_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),
 evidence_references:Object.fromEntries(['a01_epoch','sixteen_metrics','source_rights','customer_release']
 .map(k=>[k,{evidence_id:'synthetic_'+k,sha256:'sha256:'+sha('synthetic '+k)}]))};
fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({client_id:client,project_id:project,grant}),{mode:0o600});
function signedGrant(update){
 const raw={...grant,...update};raw.signature=crypto.createHmac('sha256',fs.readFileSync(path.join(root,'grant.key'))).update(encode(raw)).digest('hex');
 fs.writeFileSync(path.join(root,'grants.json'),JSON.stringify({contract:'r03-release-grants/1',grants:[raw]}),{mode:0o600});
}
(async()=>{
 check('default_off',reportR03Capabilities().enabled===false);
 check('valid_python_contract_identity',validatePackage(pack)===pack);
 function rehash(doc){delete doc.package_hash;doc.package_hash='sha256:'+sha(encode(doc));return doc;}
 for(const field of ['content_hash','source_score_snapshot_id','client_id','html_sha256']){
   const bad=structuredClone(pack);bad.r03_report_definition[field]='tampered';rehash(bad);
   assert.throws(()=>validatePackage(bad),/R03_REPORT_DEFINITION_HASH_OR_SCOPE_INVALID/);
   checked.push('full_report_definition_tamper_'+field);
 }
 const missing=structuredClone(pack);delete missing.r03_report_definition;rehash(missing);
 assert.throws(()=>validatePackage(missing),/R03_REPORT_DEFINITION_REQUIRED/);checked.push('missing_full_report_definition_denied');
 const {inspectR03PackageCandidate}=require('../src/services/report-r03-bridge-boundary');
 check('structural_preflight_does_not_authorize_new_definition',inspectR03PackageCandidate(pack).customer_release_approved===false);

 let child;
 try{
 child=spawn(process.execPath,[path.join(__dirname,'r03_http_fixture.js')],{env:{...process.env,GEOGI_R03_HTTP_TEST_ROOT:root},stdio:['ignore','pipe','pipe']});
 let err='';child.stderr.on('data',b=>err+=b);
 const ready=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('fixture startup timeout '+err)),15000);
 child.stdout.on('data',b=>{text+=b;const line=text.split('\n').find(x=>x.startsWith('{'));if(line){clearTimeout(timer);resolve(JSON.parse(line));}});
 child.once('exit',code=>{clearTimeout(timer);reject(Error('fixture exited '+code+' '+err));});});
 const base='http://127.0.0.1:'+ready.port;
 async function request(route,{body,token=ready.bridge_token,raw,headers={}}={}){
  const response=await fetch(base+route,{method:body!==undefined||raw?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:raw|| (body!==undefined?JSON.stringify(body):undefined)});
  const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(bytes);}catch{}return {code:response.status,data,bytes,headers:response.headers};
 }
 check('capability_auth_required',(await request('/internal/os/report-r03/capabilities',{token:null})).code===401);
 check('capability_distinct',(await request('/internal/os/report-r03/capabilities')).data.result.release_authority==='geo_diagnostic_html_release_r03');
 check('customer_anonymous_denied',(await request('/api/customer/report-r03/'+project,{token:null})).code===401);
 check('before_publish_not_accessible',(await request('/api/customer/report-r03/'+project+'?clientId='+client,{token:ready.client_token})).code===404);
 const binding=await request('/internal/os/report-r03/verify-customer-binding',{body:scope});
 check('signed_exact_binding '+JSON.stringify(binding.data),binding.data.result && binding.data.result.verified===true && binding.data.result.grant_id===grant.grant_id);
 const osPrebind=Object.fromEntries(['client_id','project_id','snapshot_sha256',
   'source_observation_batch_id','source_score_snapshot_id','source_retest_comparison_id']
    .map(k=>[k,scope[k]]));
 const early=await request('/internal/os/report-r03/verify-customer-binding',{body:osPrebind});
 check('os_six_pin_prebind_requires_unique_signed_complete_grant',
   early.data.result?.verified===true
   && early.data.result?.grant_id===grant.grant_id
   && early.data.result?.report_id===scope.report_id
   && early.data.result?.artifact_hashes?.pdf===pd
   && early.data.result?.artifact_hashes?.h5===hd);
 check('os_wrong_epoch_never_qualifies',
   (await request('/internal/os/report-r03/verify-customer-binding',
    {body:{...osPrebind,source_score_snapshot_id:'old_score'}})).data.result?.verified===false);
 check('os_missing_epoch_never_qualifies',
   (await request('/internal/os/report-r03/verify-customer-binding',
    {body:{...osPrebind,source_retest_comparison_id:''}})).data.result?.verified===false);
 check('full_hash_mismatch_never_falls_back_to_os_prefix',
   (await request('/internal/os/report-r03/verify-customer-binding',
    {body:{...osPrebind,artifact_hashes:{h5:hd,pdf:'a'.repeat(64)}}})).data.result?.verified===false);
 check('binding_wrong_pdf_denied',(await request('/internal/os/report-r03/verify-customer-binding',{body:{...scope,artifact_hashes:{h5:hd,pdf:'a'.repeat(64)}}})).data.result.verified===false);
 for(const [index,body] of [html,pdf].entries()){
  const artifact=pack.artifacts[index];const upload=await request('/internal/os/artifacts',{raw:body,headers:{'Content-Type':'application/octet-stream','X-GeoGi-Artifact-Filename':artifact.file_name,'X-GeoGi-Artifact-SHA256':artifact.sha256,'X-GeoGi-Artifact-Size':String(body.length),'X-GeoGi-Artifact-Mime-Type':artifact.mime_type}});
  check('real_'+artifact.artifact_type+'_ingress',upload.code===200 && upload.data.result.sha256===artifact.sha256);
 }
 check('publish_two_hashes',(await request('/internal/os/delivery-packages',{body:pack})).data.result.status==='published');
 check('publish_exact_replay_idempotent',(await request('/internal/os/delivery-packages',{body:pack})).data.result.idempotent===true);
 const read={...scope,delivery_package_id:pack.delivery_package_id,artifact_sha256:hd};
 check('access_exact_scope_and_hashes',(await request('/internal/os/report-r03/verify-customer-access',{body:read})).data.result.accessible===true);
 check('wrong_pdf_access_denied',(await request('/internal/os/report-r03/verify-customer-access',{body:{...read,artifact_hashes:{h5:hd,pdf:'a'.repeat(64)}}})).data.result.accessible===false);
 check('other_customer_denied',(await request('/api/customer/report-r03/'+project+'?clientId='+client,{token:ready.other_token})).code===404);
 check('v21_pointer_not_overwritten',(await request('/api/customer/report-v21/'+project+'?clientId='+client,{token:ready.client_token})).code===404);
 for(const [kind,bytes] of [['h5',html],['pdf',pdf]]){
  const ticket=await request('/api/customer/report-r03/'+project+'/'+kind+'-ticket',{body:{clientId:client},token:ready.client_token});
  const response=await request(ticket.data.readerPath,{token:null});
  check(kind+'_customer_reader_real_bytes',response.code===200 && response.bytes.equals(bytes));
  check(kind+'_private_no_store',(response.headers.get('cache-control')||'').includes('no-store'));
  check(kind+'_ticket_single_use',(await request(ticket.data.readerPath,{token:null})).code===404);
  const cross=await request('/api/customer/report-r03/'+project+'/'+kind+'-ticket',{body:{clientId:client},token:ready.client_token});
  check(kind+'_ticket_protocol_audience',(await request(cross.data.readerPath.replace('report-r03','report-v21'),{token:null})).code===404);
 }
 const target=path.join(root,'uploads',pack.artifacts[1].file_name);
 fs.writeFileSync(target,Buffer.concat([pdf,Buffer.from('corrupt')]));
 check('actual_disk_pdf_corruption_denied',(await request('/internal/os/report-r03/verify-customer-access',{body:read})).data.result.accessible===false);
 fs.writeFileSync(target,pdf);
 signedGrant({expires_at:new Date(Date.now()-1).toISOString()});
 check('expired_signed_grant_access_denied',(await request('/internal/os/report-r03/verify-customer-access',{body:read})).data.result.accessible===false);
 check('expired_signed_grant_binding_denied',(await request('/internal/os/report-r03/verify-customer-binding',{body:scope})).data.result.verified===false);
 check('revoke_when_grant_expired',(await request('/internal/os/report-r03/revoke',{body:{...read,reason:'synthetic_test_complete'}})).data.result.status==='revoked');
 check('revoke_exact_replay_idempotent',(await request('/internal/os/report-r03/revoke',{body:{...read,reason:'synthetic_test_complete'}})).data.result.idempotent===true);
 signedGrant({});
 check('revoked_report_cannot_access',(await request('/internal/os/report-r03/verify-customer-access',{body:read})).data.result.accessible===false);
 check('revoked_package_cannot_republish',(await request('/internal/os/delivery-packages',{body:pack})).code===409);
 check('revocation_preserves_original',fs.readFileSync(target).equals(pdf));
 process.env.GEOGI_R03_RELEASE_GRANTS_FILE=path.join(root,'grants.json');process.env.GEOGI_R03_RELEASE_GRANT_KEY_FILE=path.join(root,'grant.key');
 check('real_signature_readback',loadReleaseGrants().length===1);
 const duplicate=JSON.parse(fs.readFileSync(path.join(root,'grants.json')));
 duplicate.grants.push(duplicate.grants[0]);fs.writeFileSync(path.join(root,'grants.json'),JSON.stringify(duplicate));
 check('duplicate_signed_grants_are_not_authority',(await request('/internal/os/report-r03/verify-customer-binding',{body:scope})).data.result.verified===false);
 check('duplicate_signed_grants_deny_os_partial_binding',
   (await request('/internal/os/report-r03/verify-customer-binding',{body:osPrebind})).data.result?.verified===false);
 signedGrant({});

 fs.chmodSync(path.join(root,'grants.json'),0o644);
 assert.throws(()=>loadReleaseGrants(),/PRIVATE_FILE_REQUIRED/);checked.push('wide_grant_file_denied');
 fs.chmodSync(path.join(root,'grants.json'),0o600);
 const bad=JSON.parse(fs.readFileSync(path.join(root,'grants.json')));bad.grants[0].artifact_hashes.pdf='a'.repeat(64);
 fs.writeFileSync(path.join(root,'grants.json'),JSON.stringify(bad));
 assert.throws(()=>loadReleaseGrants(),/SIGNATURE_INVALID/);checked.push('tampered_grant_signature_denied');
 const receipt={status:'passed',synthetic_only:true,business_accepted:false,production_connected:false,checks:checked,check_count:checked.length};
 fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(receipt,null,2),{mode:0o600});
 console.log(JSON.stringify({status:'passed',check_count:checked.length,evidence:path.join(root,'summary.json'),synthetic_only:true}));
 }finally{if(child){child.kill('SIGTERM');await once(child,'exit');}}
})().catch(error=>{fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:String(error),checks:checked},null,2));console.error(error);process.exitCode=1;});
