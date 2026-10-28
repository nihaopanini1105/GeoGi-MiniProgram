'use strict';
// R03 is a policy profile of the existing immutable report store, never a
// customer/payment database or another report renderer. No grant is inferred
// from an OS request or from public data. Deployment administrators provision
// a short-lived signed release authorization after the external gates pass.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {createV21Bridge, validatePackage:validateV21Package, V21DeliveryError, physicalLocation} = require('./report-v21-bridge-operations');
const AUTHORITY='geo_diagnostic_html_release_r03';
const PURPOSE='report_r03_diagnostic';
const SCOPE_KEYS=['client_id','project_id','snapshot_sha256','source_observation_batch_id',
  'source_score_snapshot_id','source_retest_comparison_id','report_id','report_object_version','artifact_hashes'];
const HEX=/^[0-9a-f]{64}$/;
const fail=code=>{throw new V21DeliveryError(code);};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const encode=value=>JSON.stringify(canonical(value));
const enabled=()=>process.env.GEOGI_R03_REPORT_PUBLISH_ENABLED==='true';
function capabilities(){return {enabled:enabled(),release_authority:AUTHORITY,delivery_purpose:PURPOSE,
  delivery_contract_version:'3.0.0',report_object_version:'2.1.0',
  supports_18_section_same_snapshot_h5_pdf:true,customer_scoped_access_and_revocation:true,
  revision_does_not_resettle_payment_or_commission:true,authorization_contract:'r03-release-grant/1',
  real_customer_business_accepted:false};}
function validScope(value){
  return value && SCOPE_KEYS.slice(0,8).every(k=>typeof value[k]==='string' && value[k].length>0 && value[k].length<=160)
    && /^[A-Za-z0-9_-]{1,128}$/.test(value.client_id) && /^[A-Za-z0-9_-]{1,128}$/.test(value.project_id)
    && HEX.test(value.snapshot_sha256) && /^GEO-V21-[0-9A-F]{12}$/.test(value.report_id)
    && value.report_object_version==='2.1.0' && value.artifact_hashes
    && Object.keys(value.artifact_hashes).sort().join(',')==='h5,pdf'
    && ['h5','pdf'].every(k=>HEX.test(value.artifact_hashes[k]||''));
}
function packageScope(pack){
  const lineage=pack.r03_current_cycle_source_readback||{};
  return {client_id:pack.client_id,project_id:pack.project_id,
    snapshot_sha256:String(pack.report_reference.content_hash).slice(7),
    source_observation_batch_id:lineage.source_observation_batch_id,
    source_score_snapshot_id:lineage.source_score_snapshot_id,
    source_retest_comparison_id:lineage.source_retest_comparison_id,
    report_id:pack.report_reference.report_id,report_object_version:pack.report_reference.object_version,
    artifact_hashes:Object.fromEntries(pack.artifacts.map(a=>[a.artifact_type,a.sha256]))};
}
function sameScope(a,b){return validScope(a)&&validScope(b)&&SCOPE_KEYS.every(k=>encode(a[k])===encode(b[k]));}
function validatePackage(doc){
  if(!doc || doc.release_authority!==AUTHORITY || doc.delivery_purpose!==PURPOSE)fail('R03_PACKAGE_AUTHORITY_INVALID');
  const unsigned={...doc};delete unsigned.package_hash;
  if(doc.package_hash!=='sha256:'+sha(encode(unsigned)))fail('R03_PACKAGE_HASH_MISMATCH');
  const definition=doc.r03_report_definition;
  if(!definition || definition.object_type!=='diagnostic_report')fail('R03_REPORT_DEFINITION_REQUIRED');
  const reportBody={...definition};delete reportBody.report_record_hash;
  const report=doc.report_reference||{},pins=doc.version_pins||{},lineagePins=doc.r03_current_cycle_source_readback||{};
  const sourceHash=String(report.content_hash||'').slice(7);
  const expectedIdentity='diagnostic_report_r03_'+sourceHash;
  if(definition.report_record_hash!=='sha256:'+sha(encode(reportBody))
    || report.report_record_hash!==definition.report_record_hash
    || definition.object_id!==expectedIdentity || definition.report_id!==expectedIdentity
    || definition.diagnostic_report_id!==expectedIdentity || report.reference_id!==expectedIdentity
    || definition.display_report_id!==report.report_id || definition.object_version!=='2.1.0'
    || definition.client_id!==pins.canonical_client_id || definition.project_id!==pins.canonical_project_id
    || definition.content_hash!==report.content_hash || definition.snapshot_sha256!==sourceHash
    || definition.report_snapshot_id!=='report_snapshot_r03_'+sourceHash
    || definition.html_sha256!==(doc.artifacts||[])[0]?.sha256
    || definition.pdf_sha256!==(doc.artifacts||[])[1]?.sha256
    || ['source_observation_batch_id','source_score_snapshot_id','source_retest_comparison_id']
      .some(k=>definition[k]!==lineagePins[k]))fail('R03_REPORT_DEFINITION_HASH_OR_SCOPE_INVALID');
  const sourcePins=definition.r03_source_object_pins||{};
  const kinds=['query_set','platform_test_plan','observation_batch','score_snapshot','optimization_plan','retest_run','retest_comparison','outcome_assessment'];
  if(Object.keys(sourcePins).sort().join(',')!==kinds.sort().join(',') || kinds.some(k=>{
    const pin=sourcePins[k];return !pin || !pin.object_id || !/^\d+\.\d+\.\d+$/.test(pin.object_version||'') || !HEX.test(pin.payload_sha256||'');
  }) || ['observation_batch','score_snapshot','retest_comparison'].some(k=>sourcePins[k].object_id!==definition['source_'+k+'_id']))
    fail('R03_REPORT_SOURCE_VERSIONS_REQUIRED');
  // Reuse V21's pure byte-pair/ID validator. Its legacy record hash is a
  // small identity projection; R03 separately verifies the FULL definition.
  const common=structuredClone(doc);
  common.release_authority='geo_diagnostic_html_release_v21';common.delivery_purpose='report_v21_diagnostic';
  const legacyRecord='sha256:'+sha(encode({client:doc.client_id,project:doc.project_id,snapshot_sha256:sourceHash,
    report_object_version:'2.1.0',html_sha256:definition.html_sha256,pdf_sha256:definition.pdf_sha256}));
  common.report_reference.report_record_hash=legacyRecord;
  common.artifacts.forEach(a=>a.report_record_hash=legacyRecord);
  delete common.package_hash;common.package_hash='sha256:'+sha(encode(common));
  validateV21Package(common);
  if(doc.artifacts.some(a=>a.report_record_hash!==definition.report_record_hash))fail('R03_REPORT_ARTIFACT_RECORD_HASH_INVALID');
  const scope=packageScope(doc),lineage=doc.r03_current_cycle_source_readback||{};
  if(!validScope(scope) || lineage.lineage_contract!=='r03_current_cycle_report_source_v1'
    || lineage.status!=='PROVENANCE_READBACK_ONLY_NOT_PUBLISHED'
    || lineage.source_report_snapshot_sha256!==doc.report_reference.content_hash
    || lineage.customer_release_authorized!==true || lineage.independent_a01_epoch_verified!==true)
    fail('R03_PACKAGE_LINEAGE_INVALID');
  return doc;
}
function readPrivateFile(filename,maxBytes,publicRoots){
  if(!filename || !path.isAbsolute(filename))fail('R03_RELEASE_GRANT_NOT_CONFIGURED');
  const resolved=path.resolve(filename),physical=fs.realpathSync(resolved);
  const stat=fs.lstatSync(resolved);
  if(physical!==resolved || !stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0
    || stat.uid!==process.getuid() || stat.size<1 || stat.size>maxBytes)
    fail('R03_RELEASE_GRANT_PRIVATE_FILE_REQUIRED');
  for(const root of publicRoots){
    const publicPath=physicalLocation(root);
    if(physical===publicPath || physical.startsWith(publicPath+path.sep))fail('R03_RELEASE_GRANT_PRIVATE_FILE_REQUIRED');
  }
  return fs.readFileSync(resolved);
}
function loadReleaseGrants(publicRoots=[]){
  const file=process.env.GEOGI_R03_RELEASE_GRANTS_FILE;
  const keyFile=process.env.GEOGI_R03_RELEASE_GRANT_KEY_FILE;
  if(!file || !keyFile)return [];
  const secret=readPrivateFile(keyFile,4096,publicRoots);
  if(secret.length<32)fail('R03_RELEASE_GRANT_SIGNING_KEY_INVALID');
  const raw=JSON.parse(readPrivateFile(file,1024*1024,publicRoots).toString('utf8'));
  if(!raw || raw.contract!=='r03-release-grants/1' || !Array.isArray(raw.grants) || raw.grants.length>1000)
    fail('R03_RELEASE_GRANT_DOCUMENT_INVALID');
  return raw.grants.map(grant=>{
    const unsigned={...grant};delete unsigned.signature;
    const expected=crypto.createHmac('sha256',secret).update(encode(unsigned)).digest('hex');
    if(!HEX.test(grant.signature||'') || !crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(grant.signature,'hex')))
      fail('R03_RELEASE_GRANT_SIGNATURE_INVALID');
    return unsigned;
  });
}
function validGrant(grant,now){
  if(!validScope(grant) || grant.contract!=='r03-release-grant/1'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(grant.grant_id||''))return false;
  const issued=Date.parse(grant.issued_at),expires=Date.parse(grant.expires_at);
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires<=now||expires<=issued
    || expires-issued>24*60*60*1000 || !/Z$|[+-]\d\d:\d\d$/.test(grant.issued_at)
    || !/Z$|[+-]\d\d:\d\d$/.test(grant.expires_at))return false;
  const refs=grant.evidence_references;
  return refs && ['a01_epoch','sixteen_metrics','source_rights','customer_release'].every(k=>{
    const ref=refs[k];return ref && typeof ref.evidence_id==='string' && ref.evidence_id.length>0
      && /^sha256:[0-9a-f]{64}$/.test(ref.sha256||'');
  });
}
function createR03Bridge(options){
  const v21Root=physicalLocation(process.env.GEOGI_REPORT_V21_PRIVATE_ROOT || path.join(__dirname,'../../data/report-v21'));
  const ownRoot=physicalLocation(options.dataRoot);
  if(ownRoot===v21Root || ownRoot.startsWith(v21Root+path.sep) || v21Root.startsWith(ownRoot+path.sep))
    fail('R03_PRIVATE_STORE_MUST_BE_INDEPENDENT_OF_V21');
  const publicRoots=[options.uploadRoot,...(options.publicRoots||[])];
  const grantSource=options.findReleaseGrants || (()=>loadReleaseGrants(publicRoots));
  async function authorization(scope){
    if(!validScope(scope))return null;
    const grants=await grantSource();
    // Duplicate scope/grant identities are ambiguous even if one is expired.
    const matches=grants.filter(g=>sameScope(g,scope));
    if(matches.length!==1 || grants.filter(g=>g.grant_id===matches[0].grant_id).length!==1
      || !validGrant(matches[0],Date.now()))return null;
    return matches[0];
  }
  const common=createV21Bridge({...options,policy:{enabled,validatePackage,capabilities,
    displayVersion:'R03',packageScope,readScope:(pack,input)=>sameScope(packageScope(pack),input),
    authorizePackage:async pack=>!!await authorization(packageScope(pack))}});
  // OS submits six immutable cycle identifiers *before* it constructs the
  // final R03 package. This is only a lookup into full, signed authorization,
  // never a permission to publish with six fields.
  const PREBIND_KEYS=SCOPE_KEYS.slice(0,6);
  const REPORT_KEYS=SCOPE_KEYS.slice(6);
  async function prebindGrant(input){
    if(!input || typeof input!=='object' || Array.isArray(input)
       || !/^[A-Za-z0-9_-]{1,128}$/.test(input.client_id||'')
       || !/^[A-Za-z0-9_-]{1,128}$/.test(input.project_id||'')
       || !HEX.test(input.snapshot_sha256||'')
       || PREBIND_KEYS.slice(3).some(k=>
          typeof input[k]!=='string' || !input[k] || input[k].length>160))return null;
    // Full or partially supplied report fields may never fall back to a
    // permissive prefix lookup: require exact nine-field signed scope.
    if(REPORT_KEYS.some(k=>Object.prototype.hasOwnProperty.call(input,k)))
      return authorization(input);
    const grants=await grantSource();
    const matching=grants.filter(g=>PREBIND_KEYS.every(k=>g[k]===input[k]));
    if(matching.length!==1
       || grants.filter(g=>g.grant_id===matching[0].grant_id).length!==1
       || !validGrant(matching[0],Date.now()))return null;
    return matching[0];
  }
  async function binding(input){
    input=input && typeof input==='object' && !Array.isArray(input)?input:{};
    const denied={...Object.fromEntries(SCOPE_KEYS.map(k=>[k,input[k]])),verified:false,
      paid_order_verified:false,customer_access_scoped:false,customer_release_authorized:false,
      independent_a01_epoch_verified:false,sixteen_metrics_evidence_verified:false,source_rights_verified:false};
    if(!enabled())return denied;
    const [paid,grant]=await Promise.all([common.binding(input.client_id,input.project_id),prebindGrant(input)]);
    if(!paid.verified || !grant)return denied;
    return {...denied,...Object.fromEntries(REPORT_KEYS.map(k=>[k,grant[k]])),
      verified:true,paid_order_verified:true,customer_access_scoped:true,
      customer_release_authorized:true,independent_a01_epoch_verified:true,
      sixteen_metrics_evidence_verified:true,source_rights_verified:true,
      grant_id:grant.grant_id,expires_at:grant.expires_at,
      evidence_references:grant.evidence_references};
  }
  async function accessible(input){
    const result=await common.accessible(input);
    return {...Object.fromEntries(SCOPE_KEYS.map(k=>[k,input[k]])),...result};
  }
  async function revoke(input){
    // Revocation uses the exact stored package; a disabled/expired grant must
    // never prevent recovery. The shared store preserves immutable history.
    const result=await common.revoke(input);
    return {...Object.fromEntries(SCOPE_KEYS.map(k=>[k,input[k]])),...result};
  }
  return {...common,binding,accessible,revoke};
}
function live(){
  const {listOsIntakes}=require('./os-operations-bridge');
  const {findPaymentByProject}=require('./payment-store');
  const {getUploadRoot}=require('./uploads');
  const {sourceCodeRoot}=require('./channel-service');
  const root=process.env.GEOGI_REPORT_R03_PRIVATE_ROOT || path.join(__dirname,'../../data/report-r03');
  const v21=process.env.GEOGI_REPORT_V21_PRIVATE_ROOT || path.join(__dirname,'../../data/report-v21');
  if(path.resolve(root)===path.resolve(v21))fail('R03_V21_PRIVATE_ROOT_COLLISION');
  return createR03Bridge({findIntakes:listOsIntakes,findPayment:findPaymentByProject,
    uploadRoot:getUploadRoot(),publicRoots:[sourceCodeRoot()],dataRoot:root});
}
module.exports={createR03Bridge,validatePackage,packageScope,sameScope,loadReleaseGrants,
  reportR03Capabilities:capabilities,verifyR03CustomerBinding:input=>live().binding(input),
  publishR03DeliveryPackage:pack=>live().publish(pack),verifyR03CustomerAccess:input=>live().accessible(input),
  revokeR03Report:input=>live().revoke(input),getR03CustomerReport:(c,p)=>live().currentReport(c,p)};
