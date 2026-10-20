'use strict';
// A separate, opt-in V2.1 consumer. Nothing here changes the V2 customer pointer,
// the payment ledger, or commission settlement. Only the OS can admit a package.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTHORITY = 'geo_diagnostic_html_release_v21';
const PURPOSE = 'report_v21_diagnostic';
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^delivery_package_v21_[0-9a-f]{24}$/;
const STEM = /^GeoGi-V21-([0-9a-f]{16})\.(html|pdf)$/;

class V21DeliveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new V21DeliveryError(code); };
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const obj = {};
    for (const key of Object.keys(value).sort()) obj[key] = canonical(value[key]);
    return obj;
  }
  return value;
}
const json = (value) => JSON.stringify(canonical(value));
function enabled() { return process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED === 'true'; }
function generalEnabled() {
  return enabled() && process.env.GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED === 'true';
}
function capabilities() {
  return {
    enabled: enabled(), general_customer_delivery_enabled: generalEnabled(),
    release_authority: AUTHORITY, delivery_purpose: PURPOSE,
    delivery_contract_version: '3.0.0', report_object_version: '2.1.0',
    report_display_version: '2.1', customer_report_format: 'h5_plus_pdf_same_version',
    authenticated_customer_access: true, revoke: true, rollback: true,
    supersede_v2_pointers: false, independent_v2_archive: true,
    revision_does_not_resettle_payment_or_commission: true
  };
}
function validScope(clientId, projectId) {
  return typeof clientId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(clientId)
      && typeof projectId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(projectId);
}
function validatePackage(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('V21_PACKAGE_INVALID');
  if (doc.object_type !== 'delivery_package' || doc.delivery_contract_version !== '3.0.0'
      || doc.delivery_mode !== 'artifact_only' || doc.production_authority !== 'geogi_os'
      || doc.delivery_purpose !== PURPOSE || doc.release_authority !== AUTHORITY
      || doc.release_status !== 'released') fail('V21_PACKAGE_CONTRACT_INVALID');
  if (!validScope(doc.client_id, doc.project_id) || !ID.test(doc.delivery_package_id))
    fail('V21_PACKAGE_SCOPE_INVALID');
  if (typeof doc.released_at !== 'string' || !/Z$|[+-]\d\d:\d\d$/.test(doc.released_at)
      || !Number.isFinite(Date.parse(doc.released_at))) fail('V21_RELEASE_TIME_INVALID');
  if (Object.prototype.hasOwnProperty.call(doc, 'display_summary')) fail('V21_RECOMPOSITION_FORBIDDEN');
  const policy = doc.display_policy || {};
  if (policy.artifact_only !== true || [
    'client_recomposition_allowed', 'client_scoring_allowed',
    'client_summary_generation_allowed', 'client_diagnosis_generation_allowed'
  ].some(k => policy[k] !== false)) fail('V21_POLICY_INVALID');
  const pins = doc.version_pins || {}, report = doc.report_reference || {};
  if (pins.report_schema_version !== '2.1.0' || pins.report_object_version !== '2.1.0'
      || pins.release_record_version !== '2.1.0' || pins.report_version !== 2
      || pins.artifact_render_version !== 'report-v21-customer-1'
      || pins.display_report_version !== '2.1'
      || pins.canonical_client_id === undefined || pins.canonical_project_id === undefined
      || report.object_version !== '2.1.0' || report.report_version !== 2
      || report.report_type !== 'client_geo_diagnostic' || !String(report.report_id || '').startsWith('GEO-V21-')
      || !/^sha256:[0-9a-f]{64}$/.test(report.content_hash || '')
      || !/^sha256:[0-9a-f]{64}$/.test(report.report_record_hash || '')) fail('V21_VERSION_PINS_INVALID');
  // The OS report's canonical client may differ from its external CRM consumer alias.
  // Both must be explicit and independently bound by the upstream scoped API.
  if (pins.canonical_project_id !== doc.project_id || !validScope(pins.canonical_client_id, pins.canonical_project_id))
    fail('V21_CANONICAL_SCOPE_INVALID');
  if (!Array.isArray(doc.artifacts) || doc.artifacts.length !== 2)
    fail('V21_ARTIFACT_PAIR_REQUIRED');
  const expectations = [['h5', 'text/html', 'html'], ['pdf', 'application/pdf', 'pdf']];
  let sharedStem = null;
  for (let i = 0; i < 2; i++) {
    const item = doc.artifacts[i], [kind, mime, ext] = expectations[i];
    if (!item || item.artifact_type !== kind || item.mime_type !== mime
        || item.render_version !== 'report-v21-customer-1'
        || !HEX64.test(item.sha256 || '') || !Number.isSafeInteger(item.size_bytes)
        || item.size_bytes <= 0 || item.size_bytes > 25 * 1024 * 1024
        || item.report_content_hash !== report.content_hash
        || item.report_record_hash !== report.report_record_hash)
      fail('V21_ARTIFACT_INVALID');
    const match = STEM.exec(item.file_name || '');
    if (!match || match[2] !== ext || (sharedStem && sharedStem !== match[1]))
      fail('V21_ARTIFACT_PAIR_INVALID');
    sharedStem = match[1];
    if (typeof item.uri !== 'string' || !item.uri.startsWith('https://')
        || item.uri.split('/').pop() !== item.file_name) fail('V21_ARTIFACT_URI_INVALID');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(doc.package_hash || '')) fail('V21_PACKAGE_HASH_INVALID');
  const unsigned = { ...doc }; delete unsigned.package_hash;
  if (doc.package_hash !== 'sha256:' + sha(json(unsigned))) fail('V21_PACKAGE_HASH_MISMATCH');
  return doc;
}
function verifiedArtifact(artifact, root) {
  if (!STEM.test(artifact.file_name || '')) return false;
  const dest = path.resolve(root, artifact.file_name);
  if (path.dirname(dest) !== path.resolve(root)) return false;
  try {
    const st = fs.lstatSync(dest);
    if (!st.isFile() || st.isSymbolicLink() || st.size !== artifact.size_bytes) return false;
    return sha(fs.readFileSync(dest)) === artifact.sha256;
  } catch (_) { return false; }
}
function paths(root, client, project) {
  const key = sha(json([client, project]));
  return { key, pointer: path.join(root, 'pointers', key + '.json'),
    lock: path.join(root, 'locks', key + '.lock') };
}
async function writeImmutable(filename, content) {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  try { await fs.promises.writeFile(filename, content, { flag: 'wx', mode: 0o600 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const existing = await fs.promises.readFile(filename);
    if (!existing.equals(Buffer.from(content))) fail('V21_IMMUTABLE_CONFLICT');
  }
}
async function atomicPointer(filename, data) {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const tmp = filename + '.' + crypto.randomBytes(8).toString('hex') + '.next';
  try { await fs.promises.writeFile(tmp, json(data) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(tmp, filename); }
  finally { await fs.promises.unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
function createV21Bridge({findIntakes, findPayment, uploadRoot, dataRoot}) {
  if (typeof findIntakes !== 'function' || typeof findPayment !== 'function') fail('V21_DEPENDENCIES_REQUIRED');
  const root = path.resolve(dataRoot);
  const artifactRoot = path.resolve(uploadRoot);
  async function binding(clientId, projectId) {
    const denied = { verified: false, paid_order_verified: false, customer_access_scoped: false,
      client_id: clientId, project_id: projectId };
    if (!validScope(clientId, projectId) || !generalEnabled()) return denied;
    const leads = await findIntakes();
    if (!Array.isArray(leads) || !leads.some(x =>
      x.clientId === clientId && x.projectId === projectId && x.project
      && x.project.clientId === clientId && x.project.projectId === projectId)) return denied;
    const payment = await findPayment(projectId);
    const paid = payment && payment.clientId === clientId && payment.projectId === projectId
      && ['paid', 'partially_refunded'].includes(payment.status)
      && !!(payment.paidAt || payment.transactionId);
    if (!paid) return denied;
    return { ...denied, verified: true, paid_order_verified: true, customer_access_scoped: true };
  }
  async function _loadPack(id) {
    if (!ID.test(String(id || ''))) return null;
    try {
      const data = await fs.promises.readFile(path.join(root, 'packages', id + '.json'), 'utf8');
      return validatePackage(JSON.parse(data));
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async function _current(clientId, projectId) {
    if (!validScope(clientId, projectId)) return null;
    const { pointer } = paths(root, clientId, projectId);
    try {
      const index = JSON.parse(await fs.promises.readFile(pointer, 'utf8'));
      if (index.client_id !== clientId || index.project_id !== projectId) return null;
      const pack = await _loadPack(index.delivery_package_id);
      if (!pack || pack.client_id !== clientId || pack.project_id !== projectId) return null;
      if (fs.existsSync(path.join(root, 'revocations', pack.delivery_package_id + '.json'))) return null;
      return pack;
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async function publish(doc) {
    if (!enabled()) fail('V21_PUBLICATION_DISABLED');
    const pack = validatePackage(doc);
    const bound = await binding(pack.client_id, pack.project_id);
    if (!bound.verified) fail('V21_PAID_BINDING_REQUIRED');
    if (!pack.artifacts.every(a => verifiedArtifact(a, artifactRoot))) fail('V21_ARTIFACT_BYTES_NOT_VERIFIED');
    await fs.promises.mkdir(path.join(root, 'locks'), { recursive: true, mode: 0o700 });
    const p = paths(root, pack.client_id, pack.project_id);
    try { await fs.promises.mkdir(p.lock, { mode: 0o700 }); }
    catch (e) { if (e.code === 'EEXIST') fail('V21_PROJECT_RELEASE_BUSY'); throw e; }
    try {
      const current = await _current(pack.client_id, pack.project_id);
      if (current && current.delivery_package_id === pack.delivery_package_id)
        return { status:'published', deliveryPackageId:pack.delivery_package_id,
          clientId:pack.client_id, projectId:pack.project_id, idempotent:true,
          payment_mutated:false, commission_mutated:false };
      if (fs.existsSync(path.join(root,'revocations',pack.delivery_package_id+'.json')))
        fail('V21_REVOKED_PACKAGE_CANNOT_REPUBLISH');
      await writeImmutable(path.join(root,'packages',pack.delivery_package_id+'.json'), json(pack)+'\n');
      await atomicPointer(p.pointer, { client_id:pack.client_id, project_id:pack.project_id,
        delivery_package_id:pack.delivery_package_id });
      return { status:'published', deliveryPackageId:pack.delivery_package_id,
        clientId:pack.client_id, projectId:pack.project_id, idempotent:false,
        payment_mutated:false, commission_mutated:false };
    } finally { await fs.promises.rmdir(p.lock); }
  }
  async function accessible({client_id,project_id,delivery_package_id,artifact_sha256}) {
    const denied={authorized:false, accessible:false,client_id,project_id,delivery_package_id,artifact_sha256};
    if (!enabled()) return denied;
    const [bound, pack] = await Promise.all([binding(client_id,project_id),_current(client_id,project_id)]);
    if (!bound.verified || !pack || pack.delivery_package_id !== delivery_package_id
        || pack.artifacts[0].sha256 !== artifact_sha256) return denied;
    return { ...denied, authorized:true,
      accessible:pack.artifacts.every(a => verifiedArtifact(a,artifactRoot)) };
  }
  async function currentReport(clientId, projectId) {
    if (!enabled()) return null;
    const pack = await _current(clientId,projectId);
    if (!pack) return null;
    const result=await accessible({client_id:clientId,project_id:projectId,
      delivery_package_id:pack.delivery_package_id,artifact_sha256:pack.artifacts[0].sha256});
    if (!result.accessible) return null;
    return { clientId,projectId,version:'2.1',deliveryPackageId:pack.delivery_package_id,
      h5:pack.artifacts[0],pdf:pack.artifacts[1] };
  }
  async function revoke({client_id,project_id,delivery_package_id,artifact_sha256,reason}) {
    if (!enabled()) fail('V21_REVOCATION_DISABLED');
    const pack = await _loadPack(delivery_package_id);
    if (!pack || pack.client_id !== client_id || pack.project_id !== project_id
        || pack.artifacts[0].sha256 !== artifact_sha256) fail('V21_REVOCATION_SCOPE_INVALID');
    if (typeof reason !== 'string' || !reason.trim()) fail('V21_REVOCATION_REASON_REQUIRED');
    const filename=path.join(root,'revocations',delivery_package_id+'.json');
    const existed=fs.existsSync(filename);
    await writeImmutable(filename,json({client_id,project_id,delivery_package_id,
      artifact_sha256,reason:reason.slice(0,200),revoked_at:new Date().toISOString()})+'\n');
    return {status:'revoked',delivery_package_id,idempotent:existed};
  }
  return { capabilities,binding,publish,accessible,currentReport,revoke };
}
function live() {
  const { listOsIntakes } = require('./os-operations-bridge');
  const { findPaymentByProject } = require('./payment-store');
  const { getUploadRoot } = require('./uploads');
  return createV21Bridge({findIntakes:listOsIntakes,findPayment:findPaymentByProject,
    uploadRoot:getUploadRoot(),dataRoot:process.env.GEOGI_REPORT_V21_PRIVATE_ROOT || path.join(__dirname,'../../data/report-v21')});
}
module.exports = { V21DeliveryError, capabilities, createV21Bridge, validatePackage, verifiedArtifact,
  reportV21Capabilities:capabilities,
  verifyV21CustomerBinding:(c,p)=>live().binding(c,p),
  publishV21DeliveryPackage:(p)=>live().publish(p),
  verifyV21CustomerAccess:(v)=>live().accessible(v),
  getV21CustomerReport:(c,p)=>live().currentReport(c,p),
  revokeV21Report:(v)=>live().revoke(v) };