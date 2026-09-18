const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DELIVERY_CONTRACT_VERSION = '3.0.0';
const DELIVERY_MODE = 'artifact_only';
const PRODUCTION_AUTHORITY = 'geogi_os';
const DELIVERY_AUTHORITIES = Object.freeze({
  baseline_diagnostic_report: 'baseline_diagnostic_release_v1',
  final_outcome_report: 'm09_e2c_final_release'
});
const SUPPORTED_DELIVERY_CONTRACT_VERSIONS = new Set([DELIVERY_CONTRACT_VERSION]);

class DeliveryPackageError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Canonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')}`;
}

function requiredString(document, key, code = 'DELIVERY_PACKAGE_FIELD_REQUIRED') {
  const value = document && document[key];
  if (typeof value !== 'string' || !value.trim()) throw new DeliveryPackageError(code, key);
  return value.trim();
}

function isSha256Prefixed(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function validateDisplayOnlyPolicy(packageDocument) {
  if (packageDocument.delivery_mode !== DELIVERY_MODE) {
    throw new DeliveryPackageError('DELIVERY_ARTIFACT_ONLY_REQUIRED');
  }
  if (packageDocument.production_authority !== PRODUCTION_AUTHORITY) {
    throw new DeliveryPackageError('DELIVERY_OS_PRODUCTION_AUTHORITY_REQUIRED');
  }
  const purpose = String(packageDocument.delivery_purpose || '');
  const releaseAuthority = String(packageDocument.release_authority || '');
  if (!DELIVERY_AUTHORITIES[purpose] || DELIVERY_AUTHORITIES[purpose] !== releaseAuthority) {
    throw new DeliveryPackageError('DELIVERY_PURPOSE_OR_RELEASE_AUTHORITY_INVALID');
  }
  if (Object.prototype.hasOwnProperty.call(packageDocument, 'display_summary')) {
    throw new DeliveryPackageError('DELIVERY_CLIENT_REPORT_RECOMPOSITION_FORBIDDEN');
  }
  const policy = packageDocument.display_policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || policy.artifact_only !== true) {
    throw new DeliveryPackageError('DELIVERY_DISPLAY_POLICY_INVALID');
  }
  for (const key of [
    'client_recomposition_allowed',
    'client_scoring_allowed',
    'client_summary_generation_allowed',
    'client_diagnosis_generation_allowed'
  ]) {
    if (policy[key] !== false) {
      throw new DeliveryPackageError('DELIVERY_CLIENT_SIDE_PRODUCTION_FORBIDDEN', key);
    }
  }
}

function validateDeliveryPackage(packageDocument) {
  if (!packageDocument || typeof packageDocument !== 'object' || Array.isArray(packageDocument)) {
    throw new DeliveryPackageError('DELIVERY_PACKAGE_REQUIRED');
  }
  if (packageDocument.object_type !== 'delivery_package') {
    throw new DeliveryPackageError('DELIVERY_PACKAGE_REQUIRED');
  }
  const contractVersion = String(packageDocument.delivery_contract_version || '');
  if (!SUPPORTED_DELIVERY_CONTRACT_VERSIONS.has(contractVersion)) {
    throw new DeliveryPackageError('DELIVERY_CONTRACT_VERSION_UNSUPPORTED');
  }
  validateDisplayOnlyPolicy(packageDocument);
  if (packageDocument.release_status !== 'released') {
    throw new DeliveryPackageError('DELIVERY_PACKAGE_NOT_RELEASED');
  }

  requiredString(packageDocument, 'delivery_package_id');
  requiredString(packageDocument, 'project_id');
  requiredString(packageDocument, 'client_id');
  requiredString(packageDocument, 'released_at');
  const packageHash = requiredString(packageDocument, 'package_hash');
  if (!isSha256Prefixed(packageHash)) throw new DeliveryPackageError('DELIVERY_PACKAGE_HASH_INVALID');

  const report = packageDocument.report_reference;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new DeliveryPackageError('DELIVERY_REPORT_REFERENCE_REQUIRED');
  }
  requiredString(report, 'report_id', 'DELIVERY_REPORT_REFERENCE_INVALID');
  requiredString(report, 'object_version', 'DELIVERY_REPORT_REFERENCE_INVALID');
  if (!Number.isInteger(report.report_version) || report.report_version < 1) {
    throw new DeliveryPackageError('DELIVERY_REPORT_REFERENCE_INVALID', 'report_version');
  }
  if (!isSha256Prefixed(report.content_hash) || !isSha256Prefixed(report.report_record_hash)) {
    throw new DeliveryPackageError('DELIVERY_REPORT_REFERENCE_INVALID', 'hash');
  }

  const pins = packageDocument.version_pins;
  if (!pins || typeof pins !== 'object' || Array.isArray(pins)) {
    throw new DeliveryPackageError('DELIVERY_VERSION_PINS_REQUIRED');
  }
  for (const key of [
    'report_schema_version',
    'report_object_version',
    'report_delivery_record_version',
    'artifact_render_version',
    'canonical_client_id',
    'canonical_project_id'
  ]) requiredString(pins, key, 'DELIVERY_VERSION_PIN_REQUIRED');
  if (!Number.isInteger(pins.report_version) || pins.report_version !== report.report_version) {
    throw new DeliveryPackageError('DELIVERY_REPORT_VERSION_PIN_MISMATCH');
  }

  if (!Array.isArray(packageDocument.artifacts) || packageDocument.artifacts.length !== 1) {
    throw new DeliveryPackageError('DELIVERY_SINGLE_ARTIFACT_REQUIRED');
  }
  const artifact = packageDocument.artifacts[0];
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new DeliveryPackageError('DELIVERY_ARTIFACT_INVALID');
  }
  for (const key of ['artifact_id', 'artifact_type', 'mime_type', 'file_name', 'render_version', 'uri']) {
    requiredString(artifact, key, 'DELIVERY_ARTIFACT_INVALID');
  }
  if (!/^[0-9a-f]{64}$/.test(String(artifact.sha256 || ''))) {
    throw new DeliveryPackageError('DELIVERY_ARTIFACT_HASH_INVALID');
  }
  if (!Number.isInteger(artifact.size_bytes) || artifact.size_bytes < 0) {
    throw new DeliveryPackageError('DELIVERY_ARTIFACT_INVALID', 'size_bytes');
  }
  if (artifact.report_content_hash !== report.content_hash || artifact.report_record_hash !== report.report_record_hash) {
    throw new DeliveryPackageError('DELIVERY_ARTIFACT_REPORT_HASH_MISMATCH');
  }

  const hashInput = JSON.parse(JSON.stringify(packageDocument));
  delete hashInput.package_hash;
  if (sha256Canonical(hashInput) !== packageHash) {
    throw new DeliveryPackageError('DELIVERY_PACKAGE_HASH_MISMATCH');
  }
  return packageDocument;
}

function deliveryRoot() {
  return process.env.GEOGI_DELIVERY_PACKAGE_ROOT || path.join(__dirname, '../../data/delivery-packages');
}

function packagePath(packageId) {
  const safe = String(packageId || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(deliveryRoot(), `${safe}.json`);
}

async function importDeliveryPackage(packageDocument) {
  validateDeliveryPackage(packageDocument);
  const output = packagePath(packageDocument.delivery_package_id);
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  const canonical = `${canonicalStringify(packageDocument)}\n`;
  try {
    const existing = await fs.promises.readFile(output, 'utf8');
    const parsed = JSON.parse(existing);
    validateDeliveryPackage(parsed);
    if (canonicalStringify(parsed) === canonicalStringify(packageDocument)) {
      return { imported: false, idempotent: true, path: output, package: parsed };
    }
    throw new DeliveryPackageError('DELIVERY_PACKAGE_IMMUTABLE_CONFLICT', packageDocument.delivery_package_id);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  await fs.promises.writeFile(output, canonical, { encoding: 'utf8', flag: 'wx' });
  return { imported: true, idempotent: false, path: output, package: packageDocument };
}

async function listDeliveryPackages() {
  let names = [];
  try {
    names = await fs.promises.readdir(deliveryRoot());
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const packages = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const document = JSON.parse(await fs.promises.readFile(path.join(deliveryRoot(), name), 'utf8'));
    validateDeliveryPackage(document);
    packages.push(document);
  }
  return packages;
}

async function findDeliveryPackage({ clientId, projectId }) {
  const matches = (await listDeliveryPackages()).filter((item) => (
    item.client_id === String(clientId || '').trim() && item.project_id === String(projectId || '').trim()
  ));
  if (!matches.length) return null;
  matches.sort((a, b) => String(b.released_at).localeCompare(String(a.released_at)));
  return matches[0];
}

function assertScope(packageDocument, { clientId, projectId }) {
  validateDeliveryPackage(packageDocument);
  if (packageDocument.client_id !== String(clientId || '').trim() || packageDocument.project_id !== String(projectId || '').trim()) {
    throw new DeliveryPackageError('DELIVERY_SCOPE_MISMATCH');
  }
}

function projectDeliveryForCustomer(packageDocument, scope) {
  assertScope(packageDocument, scope);
  const artifact = packageDocument.artifacts[0];
  return {
    deliveryPackageId: packageDocument.delivery_package_id,
    deliveryContractVersion: packageDocument.delivery_contract_version,
    deliveryMode: packageDocument.delivery_mode,
    productionAuthority: packageDocument.production_authority,
    deliveryPurpose: packageDocument.delivery_purpose || '',
    releaseAuthority: packageDocument.release_authority || '',
    releaseStatus: packageDocument.release_status,
    releasedAt: packageDocument.released_at,
    reportId: packageDocument.report_reference.report_id,
    reportType: packageDocument.report_reference.report_type || '',
    reportVersion: packageDocument.report_reference.report_version,
    reportContentHash: packageDocument.report_reference.content_hash,
    reportRecordHash: packageDocument.report_reference.report_record_hash,
    reportLink: artifact.uri,
    artifactId: artifact.artifact_id,
    artifactMimeType: artifact.mime_type,
    artifactSha256: artifact.sha256,
    artifactSizeBytes: artifact.size_bytes,
    artifactRenderVersion: artifact.render_version,
    versionPins: { ...packageDocument.version_pins }
  };
}

module.exports = {
  DELIVERY_CONTRACT_VERSION,
  DELIVERY_MODE,
  PRODUCTION_AUTHORITY,
  DELIVERY_AUTHORITIES,
  SUPPORTED_DELIVERY_CONTRACT_VERSIONS,
  DeliveryPackageError,
  canonicalStringify,
  sha256Canonical,
  validateDisplayOnlyPolicy,
  validateDeliveryPackage,
  importDeliveryPackage,
  listDeliveryPackages,
  findDeliveryPackage,
  projectDeliveryForCustomer,
  assertScope
};
