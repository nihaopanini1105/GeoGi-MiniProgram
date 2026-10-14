'use strict';
const fs=require('fs');
const crypto=require('crypto');
const path=require('path');
const {getUploadRoot}=require('./uploads');
const {getCustomerReport}=require('./customer-portal');
const {
  getDeliveryPackageById, revokeDeliveryPackage, isDeliveryRevoked
}=require('./delivery-package-store');

const RELEASE_AUTHORITY='geo_diagnostic_html_release_v2';

function reportV2Capabilities() {
  return {
    release_authority:RELEASE_AUTHORITY,
    delivery_contract_version:'3.0.0',
    customer_report_format:'h5_plus_pdf_same_version',
    idempotent_upload:true,
    idempotent_publish:true,
    authenticated_customer_access:true,
    revoke:true,
    rollback:true
  };
}

function _verifiedBytes(artifact) {
  const root=path.resolve(getUploadRoot());
  const name=String(artifact.file_name||'');
  if (!/^[a-zA-Z0-9._-]{1,180}\.(html|pdf)$/.test(name)) return false;
  const file=path.resolve(root,name);
  if (path.dirname(file)!==root) return false;
  try {
    const stat=fs.lstatSync(file);
    if (!stat.isFile()||stat.isSymbolicLink()||stat.size!==artifact.size_bytes) return false;
    const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return hash===artifact.sha256;
  } catch (_) { return false; }
}

async function verifyCustomerReportAccess(request) {
  const id=String(request.delivery_package_id||'');
  const client=String(request.client_id||'');
  const project=String(request.project_id||'');
  const hash=String(request.artifact_sha256||'');
  const denied={
    authorized:false,accessible:false,
    client_id:client,project_id:project,
    delivery_package_id:id,artifact_sha256:hash,
  };
  if (!id || !client || !project || !/^[a-f0-9]{64}$/.test(hash)) return denied;
  const pack=await getDeliveryPackageById(id);
  if (!pack || pack.client_id!==client || pack.project_id!==project
      || pack.release_authority!==RELEASE_AUTHORITY) return denied;
  if (!pack.artifacts || pack.artifacts.length!==2
      || pack.artifacts[0].sha256!==hash) return denied;
  if (isDeliveryRevoked(id)) return denied;
  const result=await getCustomerReport({clientId:client,projectId:project});
  const ready=result && result.ok && result.report
     && result.report.reportReady===true
     && result.report.deliveryPackageId===id;
  const intact=pack.artifacts.every(_verifiedBytes);
  return {...denied,authorized:Boolean(ready),accessible:Boolean(ready&&intact)};
}

async function revokeCustomerReportDelivery(request) {
  const id=String(request.delivery_package_id||'');
  const client=String(request.client_id||'');
  const project=String(request.project_id||'');
  const hash=String(request.artifact_sha256||'');
  const pack=await getDeliveryPackageById(id);
  if (!pack || pack.client_id!==client || pack.project_id!==project
      || pack.artifacts[0].sha256!==hash
      || pack.release_authority!==RELEASE_AUTHORITY) {
    throw new Error('V2_REVOKE_SCOPE_INVALID');
  }
  const result=await revokeDeliveryPackage(id,{
    clientId:client,projectId:project,reason:request.reason
  });
  return {status:'revoked',delivery_package_id:id,idempotent:result.idempotent};
}

module.exports={
  RELEASE_AUTHORITY,reportV2Capabilities,verifyCustomerReportAccess,
  revokeCustomerReportDelivery
};
