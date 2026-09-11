const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DELIVERY_CONTRACT_VERSION = '2.0.0';
const PRESENTATION_AUTHORITY = 'os_m09_governed_report';

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

function validateDisplaySummary(summary, report) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new DeliveryPackageError('DELIVERY_DISPLAY_SUMMARY_REQUIRED');
  }
  if (summary.presentationAuthority !== PRESENTATION_AUTHORITY) {
    throw new DeliveryPackageError('DELIVERY_PRESENTATION_AUTHORITY_INVALID');
  }
  requiredString(summary, 'presentationVersion', 'DELIVERY_PRESENTATION_VERSION_REQUIRED');
  if (summary.reportStatus !== 'released') {
    throw new DeliveryPackageError('DELIVERY_PRESENTATION_NOT_RELEASED');
  }
  if (summary.overallScore !== null && summary.overallScore !== undefined) {
    throw new DeliveryPackageError('DELIVERY_UNAPPROVED_SCORE_FORBIDDEN');
  }
  for (const key of ['scope', 'dimensions', 'platforms', 'keyFindings', 'recommendations', 'limitations', 'risks']) {
    if (!Array.isArray(summary[key])) throw new DeliveryPackageError('DELIVERY_PRESENTATION_LIST_REQUIRED', key);
  }
  if (!Number.isInteger(summary.evidenceCount) || summary.evidenceCount < 0) {
    throw new DeliveryPackageError('DELIVERY_PRESENTATION_EVIDENCE_COUNT_INVALID');
  }
  const integrity = summary.integrity;
  if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) {
    throw new DeliveryPackageError('DELIVERY_PRESENTATION_INTEGRITY_REQUIRED');
  }
  if (integrity.contentHash !== report.content_hash || integrity.reportRecordHash !== report.report_record_hash) {
    throw new DeliveryPackageError('DELIVERY_PRESENTATION_REPORT_HASH_MISMATCH');
  }
  if (!isSha256Prefixed(integrity.sourceManifestHash)) {
    throw new DeliveryPackageError('DELIVERY_PRESENTATION_SOURCE_HASH_INVALID');
  }
}

function validateDeliveryPackage(packageDocument) {
  if (!packageDocument || typeof packageDocument !== 'object' || Array.isArray(packageDocument)) {
    throw new DeliveryPackageError('DELIVERY_PACKAGE_REQUIRED');
  }
  if (packageDocument.object_type !== 'delivery_package') {
    throw new DeliveryPackageError('DELIVERY_PACKAGE_REQUIRED');
  }
  if (packageDocument.delivery_contract_version !== DELIVERY_CONTRACT_VERSION) {
    throw new DeliveryPackageError('DELIVERY_CONTRACT_VERSION_UNSUPPORTED');
  }
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

  if (!packageDocument.version_pins || typeof packageDocument.version_pins !== 'object' || Array.isArray(packageDocument.version_pins)) {
    throw new DeliveryPackageError('DELIVERY_VERSION_PINS_REQUIRED');
  }
  validateDisplaySummary(packageDocument.display_summary, report);
  if (packageDocument.version_pins.presentation_version !== packageDocument.display_summary.presentationVersion) {
    throw new DeliveryPackageError('DELIVERY_PRESENTATION_VERSION_PIN_MISMATCH');
  }
  if (!Array.isArray(packageDocument.artifacts) || packageDocument.artifacts.length === 0) {
    throw new DeliveryPackageError('DELIVERY_ARTIFACT_REQUIRED');
  }

  for (const artifact of packageDocument.artifacts) {
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
    if (artifact.report_content_hash !== report.content_hash) {
      throw new DeliveryPackageError('DELIVERY_ARTIFACT_REPORT_HASH_MISMATCH');
    }
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
  const summary = packageDocument.display_summary || {};
  const pdf = packageDocument.artifacts.find((item) => item.mime_type === 'application/pdf' || item.artifact_type === 'pdf') || packageDocument.artifacts[0];
  return {
    ...summary,
    deliveryPackageId: packageDocument.delivery_package_id,
    deliveryContractVersion: packageDocument.delivery_contract_version,
    releaseStatus: packageDocument.release_status,
    releasedAt: packageDocument.released_at,
    reportId: packageDocument.report_reference.report_id,
    reportVersion: packageDocument.report_reference.report_version,
    reportContentHash: packageDocument.report_reference.content_hash,
    versionPins: { ...packageDocument.version_pins },
    reportLink: pdf ? pdf.uri : '',
    artifactId: pdf ? pdf.artifact_id : '',
    artifactSha256: pdf ? pdf.sha256 : '',
    dimensions: Array.isArray(summary.dimensions) ? summary.dimensions : [],
    platforms: Array.isArray(summary.platforms) ? summary.platforms : [],
    keyFindings: Array.isArray(summary.keyFindings) ? summary.keyFindings : [],
    recommendations: Array.isArray(summary.recommendations) ? summary.recommendations : [],
    limitations: Array.isArray(summary.limitations) ? summary.limitations : [],
    risks: Array.isArray(summary.risks) ? summary.risks : [],
    scope: Array.isArray(summary.scope) ? summary.scope : []
  };
}

module.exports = {
  DELIVERY_CONTRACT_VERSION,
  PRESENTATION_AUTHORITY,
  DeliveryPackageError,
  canonicalStringify,
  sha256Canonical,
  validateDeliveryPackage,
  validateDisplaySummary,
  importDeliveryPackage,
  findDeliveryPackage,
  projectDeliveryForCustomer,
  assertScope
};
