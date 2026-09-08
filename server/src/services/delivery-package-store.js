'use strict';

const fs = require('fs');
const path = require('path');

function getDeliveryRoot() {
  return path.resolve(
    process.env.GEOGI_DELIVERY_ROOT || path.join(__dirname, '..', '..', 'output', 'delivery')
  );
}

function getPackageRoot() {
  return path.join(getDeliveryRoot(), 'packages');
}

function getArtifactRoot() {
  return path.join(getDeliveryRoot(), 'artifacts');
}

function safeProjectId(value) {
  const clean = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(clean)) return '';
  return clean;
}

function packagePath(projectId) {
  const clean = safeProjectId(projectId);
  if (!clean) return '';
  return path.join(getPackageRoot(), `${clean}.json`);
}

function readDeliveryPackage(projectId) {
  const file = packagePath(projectId);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateDeliveryPackage(payload, projectId);
    return payload;
  } catch (error) {
    console.error('readDeliveryPackage failed', error);
    return null;
  }
}

function validateDeliveryPackage(payload, projectId) {
  if (!payload || payload.object_type !== 'delivery_package') throw new Error('DELIVERY_PACKAGE_INVALID');
  if (payload.release_status !== 'released') throw new Error('DELIVERY_PACKAGE_NOT_RELEASED');
  if (String(payload.project_id || '') !== String(projectId || '')) throw new Error('DELIVERY_PACKAGE_PROJECT_MISMATCH');
  if (!payload.report_reference || !payload.report_reference.content_hash) throw new Error('DELIVERY_PACKAGE_REPORT_REFERENCE_MISSING');
  if (!Array.isArray(payload.artifacts) || !payload.artifacts.length) throw new Error('DELIVERY_PACKAGE_ARTIFACTS_MISSING');
  for (const artifact of payload.artifacts) {
    if (!artifact || !artifact.artifact_id || !artifact.uri || !/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) {
      throw new Error('DELIVERY_PACKAGE_ARTIFACT_INVALID');
    }
    if (artifact.report_content_hash !== payload.report_reference.content_hash) {
      throw new Error('DELIVERY_PACKAGE_ARTIFACT_REPORT_HASH_MISMATCH');
    }
  }
  return true;
}

function publicArtifactUrl(uri) {
  const value = String(uri || '').trim();
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith('/delivery/')) return value;
  return '';
}

module.exports = {
  getDeliveryRoot,
  getPackageRoot,
  getArtifactRoot,
  readDeliveryPackage,
  validateDeliveryPackage,
  publicArtifactUrl
};
