'use strict';
const fs=require('fs');
const crypto=require('crypto');
const path=require('path');
const {getUploadRoot}=require('./uploads');
const {getCustomerReport}=require('./customer-portal');
const {
  getDeliveryPackageById, revokeDeliveryPackage, isDeliveryRevoked,
  isR01SealedPair, r01SealedPairEnabled
}=require('./delivery-package-store');

const RELEASE_AUTHORITY='geo_diagnostic_html_release_v2';

function r01ArtifactBase() {
  const base = String(process.env.PUBLIC_UPLOAD_BASE_URL || '').trim().replace(/\/$/, '');
  try {
    const url = new URL(base);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      && !url.search && !url.hash ? base : '';
  } catch (_) {
    return '';
  }
}

function reportV2Capabilities() {
  return {
    release_authority:RELEASE_AUTHORITY,
    delivery_contract_version:'3.0.0',
    customer_report_format:'h5_plus_pdf_same_version',
    idempotent_upload:true,
    idempotent_publish:true,
    authenticated_customer_access:true,
    revoke:true,
    rollback:true,
    ...(r01SealedPairEnabled() && r01ArtifactBase() && require('./os-operations-bridge').configured()
      ? { r01_sealed_h5_pdf_customer_delivery: true } : {})
  };
}

function verifyR01ArtifactPair(packageDocument) {
  const base = r01ArtifactBase();
  return Boolean(base && packageDocument.artifacts.every(artifact =>
    artifact.uri === base + '/' + encodeURIComponent(artifact.file_name) && _verifiedBytes(artifact)));
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

async function verifyGeoGiPilotBinding({clientId,projectId}) {
  // Read-only, private, and fail closed: do not grant the pilot based solely
  // on env names. The exact customer and project must exist in Feishu.
  const expectedClient=String(process.env.GEOGI_V2_PILOT_CONSUMER_CLIENT_ID||'').trim();
  const expectedProject=String(process.env.GEOGI_V2_PILOT_CONSUMER_PROJECT_ID||'').trim();
  if (String(process.env.GEOGI_V2_EXACT_PILOT_ENABLED||'').toLowerCase()!=='true'
      || !expectedClient || !expectedProject
      || clientId!==expectedClient || projectId!==expectedProject) {
    return {ready:false};
  }
  try {
    const {listOsIntakes}=require('./os-operations-bridge');
    const candidates=await listOsIntakes();
    const found=candidates.some(x=>
      x.clientId===expectedClient && x.projectId===expectedProject
      && x.project && x.project.clientId===expectedClient
      && x.project.projectId===expectedProject
    );
    return {ready:Boolean(found)};
  } catch (_) { return {ready:false}; }
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
  if (!pack || pack.delivery_package_id!==id || pack.client_id!==client || pack.project_id!==project
      || pack.release_authority!==RELEASE_AUTHORITY) return denied;
  const paired = isR01SealedPair(pack);
  const artifact = paired ? pack.artifacts.find(item => item.sha256 === hash) : pack.artifacts[0];
  if (!artifact || artifact.sha256 !== hash) return denied;
  if (isDeliveryRevoked(id)) return denied;
  const result=await getCustomerReport({clientId:client,projectId:project});
  const ready=result && result.ok && result.report
     && result.report.reportReady===true
     && result.report.deliveryPackageId===id;
  if (!ready || (paired && isDeliveryRevoked(id))) return denied;
  if (paired) {
    const report = result.report;
    const projected = artifact.artifact_type === 'h5'
      ? report.artifactType === 'h5' && report.artifactMimeType === 'text/html'
        && report.artifactSha256 === hash && report.artifactFileName === artifact.file_name
      : report.pdfAvailable === true && report.pdfArtifactSha256 === hash
        && report.pdfArtifactFileName === artifact.file_name;
    if (!projected) return denied;
  }
  const intact=paired ? _verifiedBytes(artifact) : pack.artifacts.every(_verifiedBytes);
  return {...denied,authorized:true,accessible:intact};
}

async function revokeCustomerReportDelivery(request) {
  const id=String(request.delivery_package_id||'');
  const client=String(request.client_id||'');
  const project=String(request.project_id||'');
  const hash=String(request.artifact_sha256||'');
  const pack=await getDeliveryPackageById(id);
  if (!pack || pack.delivery_package_id!==id || pack.client_id!==client || pack.project_id!==project
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
  revokeCustomerReportDelivery,verifyGeoGiPilotBinding,verifyR01ArtifactPair
};
