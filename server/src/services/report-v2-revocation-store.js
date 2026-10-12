'use strict';

// Durable, fail-closed report V2 revocation ledger. V1 packages are untouched.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function revocationRoot() {
  const packages = process.env.GEOGI_DELIVERY_PACKAGE_ROOT ||
    path.join(__dirname, '../../data/delivery-packages');
  return path.resolve(packages, '_report-v2-revocations');
}

function revocationPath(packageId) {
  const identifier = String(packageId || '');
  if (!/^[A-Za-z0-9_.-]{1,180}$/.test(identifier)) {
    throw new Error('V2_REVOCATION_PACKAGE_ID_INVALID');
  }
  const digest = crypto.createHash('sha256').update(identifier).digest('hex');
  return path.join(revocationRoot(), digest + '.json');
}

function getRevocation(packageId) {
  const filename = revocationPath(packageId);
  let row;
  try {
    row = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw new Error('V2_REVOCATION_LEDGER_UNAVAILABLE');
  }
  if (!row || row.delivery_package_id !== String(packageId) ||
      row.status !== 'revoked' ||
      !/^[0-9a-f]{64}$/.test(String(row.artifact_sha256 || '')) ||
      !String(row.client_id || '') || !String(row.project_id || '')) {
    throw new Error('V2_REVOCATION_LEDGER_INVALID');
  }
  return row;
}

function revokeV2Package(packageDocument, request) {
  const pkg = packageDocument || {};
  const artifact = (pkg.artifacts || [])[0] || {};
  const expected = request || {};
  if (pkg.release_authority !== 'geo_diagnostic_html_release_v2' ||
      pkg.delivery_package_id !== expected.delivery_package_id ||
      pkg.client_id !== expected.client_id ||
      pkg.project_id !== expected.project_id ||
      artifact.sha256 !== expected.artifact_sha256 ||
      !/^[0-9a-f]{64}$/.test(String(artifact.sha256 || '')) ||
      !String(expected.reason || '').trim()) {
    throw new Error('V2_REVOCATION_EXACT_SCOPE_REQUIRED');
  }
  const previous = getRevocation(pkg.delivery_package_id);
  if (previous) {
    if (previous.client_id !== pkg.client_id ||
        previous.project_id !== pkg.project_id ||
        previous.artifact_sha256 !== artifact.sha256) {
      throw new Error('V2_REVOCATION_CONFLICT');
    }
    return { status: 'revoked', delivery_package_id: pkg.delivery_package_id, idempotent: true };
  }
  const document = {
    schema_version: 'report-v2-revocation/v1',
    status: 'revoked',
    delivery_package_id: pkg.delivery_package_id,
    client_id: pkg.client_id,
    project_id: pkg.project_id,
    artifact_sha256: artifact.sha256,
    reason: String(expected.reason).trim().slice(0, 300),
    revoked_at: new Date().toISOString()
  };
  fs.mkdirSync(revocationRoot(), { recursive: true, mode: 0o700 });
  const filename = revocationPath(pkg.delivery_package_id);
  try {
    fs.writeFileSync(filename, JSON.stringify(document) + '\n', {
      flag: 'wx', encoding: 'utf8', mode: 0o600
    });
  } catch (error) {
    if (error && error.code === 'EEXIST') return revokeV2Package(pkg, expected);
    throw error;
  }
  return { status: 'revoked', delivery_package_id: pkg.delivery_package_id, idempotent: false };
}

module.exports = { revocationPath, getRevocation, revokeV2Package };
