'use strict';
// Independent GeoGi Report V2.1 MiniProgram delivery contract.
// Activated only for the exact existing pilot; never retroactively rewrites V2,
// performs payments/commission reconciliation or opens public artifacts.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {getUploadRoot}=require('./uploads');
const {getCustomerReport}=require('./customer-portal');
const {getDeliveryPackageById,revokeDeliveryPackage,isDeliveryRevoked}=require('./delivery-package-store');
const {verifyGeoGiPilotBinding}=require('./report-v2-bridge-operations');

const RELEASE_AUTHORITY='geo_diagnostic_html_release_v21';
const PURPOSE='report_v21_diagnostic';
function enabled(){
  return String(process.env.GEOGI_REPORT_V21_BRIDGE_ENABLED||'').toLowerCase()==='true';
}
function reportV21Capabilities(){
  return {
    enabled: enabled(),
    release_authority: RELEASE_AUTHORITY,
    delivery_purpose: PURPOSE,
    delivery_contract_version:'3.0.0',
    report_object_version:'2.1.0',
    report_display_version:'2.1',
    customer_report_format:'h5_plus_pdf_same_version',
    authenticated_customer_access:true,
    revoke:true,
    rollback:true,
    supersede_v2_pointers:false,
    independent_v2_archive:true,
    revision_does_not_resettle_payment_or_commission:true
  };
}
function verifiedBytes(artifact){
  const root=path.resolve(getUploadRoot());
  const name=String(artifact&&artifact.file_name||'');
  if(!/^GeoGi-V21-[0-9a-f]{16}\.(?:html|pdf)$/.test(name)) return false;
  const file=path.resolve(root,name);
  if(path.dirname(file)!==root) return false;
  try {
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==artifact.size_bytes) return false;
    const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return hash===artifact.sha256;
  } catch(_) {return false;}
}
function isStrictV21(pack,request){
  return Boolean(pack && request && enabled()
    && pack.client_id===request.client_id
    && pack.project_id===request.project_id
    && pack.delivery_package_id===request.delivery_package_id
    && pack.delivery_purpose===PURPOSE
    && pack.release_authority===RELEASE_AUTHORITY
    && pack.release_status==='released'
    && pack.report_reference && pack.report_reference.object_version==='2.1.0'
    && Array.isArray(pack.artifacts) && pack.artifacts.length===2
    && pack.artifacts[0].artifact_type==='h5'
    && pack.artifacts[1].artifact_type==='pdf'
    && pack.artifacts[0].sha256===request.artifact_sha256);
}
async function verifyReportV21CustomerAccess(request={}){
  const client=String(request.client_id||'');
  const project=String(request.project_id||'');
  const id=String(request.delivery_package_id||'');
  const sha=String(request.artifact_sha256||'');
  const denied={
    authorized:false,accessible:false,client_id:client,project_id:project,
    delivery_package_id:id,artifact_sha256:sha
  };
  if(!enabled()||!client||!project||!/^delivery_package_v21_[0-9a-f]{24}$/.test(id)
      || !/^[a-f0-9]{64}$/.test(sha)) return denied;
  let pack;
  try {pack=await getDeliveryPackageById(id);}
  catch(_) {return denied;}
  if(!isStrictV21(pack,{client_id:client,project_id:project,delivery_package_id:id,artifact_sha256:sha})
      || isDeliveryRevoked(id)) return denied;
  const binding=await verifyGeoGiPilotBinding({clientId:client,projectId:project});
  if(!binding.ready) return denied;
  const customer=await getCustomerReport({clientId:client,projectId:project});
  const ready=Boolean(customer && customer.ok && customer.report &&
    customer.report.reportReady===true &&
    customer.report.deliveryPackageId===id &&
    customer.report.releaseAuthority===RELEASE_AUTHORITY &&
    customer.report.artifactSha256===sha);
  const intact=ready && pack.artifacts.every(verifiedBytes);
  return {...denied,authorized:ready,accessible:Boolean(ready&&intact)};
}
async function revokeReportV21Delivery(request={}){
  const id=String(request.delivery_package_id||'');
  const client=String(request.client_id||'');
  const project=String(request.project_id||'');
  const hash=String(request.artifact_sha256||'');
  if(!enabled()) throw new Error('V21_BRIDGE_NOT_ENABLED');
  const pack=await getDeliveryPackageById(id);
  if(!isStrictV21(pack,{client_id:client,project_id:project,
                          delivery_package_id:id,artifact_sha256:hash}))
    throw new Error('V21_REVOKE_SCOPE_INVALID');
  const result=await revokeDeliveryPackage(id,{
    clientId:client,projectId:project,reason:request.reason
  });
  return {status:'revoked',delivery_package_id:id,idempotent:result.idempotent};
}
module.exports={RELEASE_AUTHORITY,PURPOSE,reportV21Capabilities,
  verifyReportV21CustomerAccess,revokeReportV21Delivery};
