'use strict';
const fs = require('fs');
const path = require('path');

const AUTHORITY = 'geo_diagnostic_html_release_v2';
const ID = /^[A-Za-z0-9_.-]{1,180}$/;
const SHA = /^[a-f0-9]{64}$/;

function stateRoot() {
  const packageRoot = path.resolve(process.env.GEOGI_DELIVERY_PACKAGE_ROOT ||
    path.join(__dirname, '../../data/delivery-packages'));
  return path.resolve(process.env.GEOGI_REPORT_V2_STATE_ROOT ||
    path.join(packageRoot, '.v2-revocations'));
}

function revokedPath(packageId) {
  const id = String(packageId || '');
  if (!ID.test(id)) throw new Error('REPORT_V2_PACKAGE_ID_INVALID');
  return path.join(stateRoot(), id + '.json');
}

function readRevocation(packageId) {
  try { return JSON.parse(fs.readFileSync(revokedPath(packageId), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertNotRevoked(packageId) {
  if (readRevocation(packageId)) throw new Error('REPORT_V2_PACKAGE_REVOKED');
}

function revokeV2Package({ packageDocument, clientId, projectId, artifactSha256, reason }) {
  if (!packageDocument || packageDocument.release_authority !== AUTHORITY ||
      packageDocument.client_id !== clientId ||
      packageDocument.project_id !== projectId ||
      packageDocument.delivery_package_id === '' ||
      packageDocument.artifacts?.[0]?.sha256 !== artifactSha256 ||
      !SHA.test(String(artifactSha256 || '')) || !String(reason || '').trim()) {
    throw new Error('REPORT_V2_REVOKE_SCOPE_INVALID');
  }
  const record = {
    delivery_package_id: packageDocument.delivery_package_id,
    client_id: clientId, project_id: projectId,
    artifact_sha256: artifactSha256,
    status: 'revoked', reason: String(reason).slice(0, 500),
    revoked_at: new Date().toISOString()
  };
  const target = revokedPath(packageDocument.delivery_package_id);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(target, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = readRevocation(packageDocument.delivery_package_id);
    if (!prior || prior.client_id !== clientId || prior.project_id !== projectId ||
        prior.artifact_sha256 !== artifactSha256) throw new Error('REPORT_V2_REVOKE_CONFLICT');
    return prior;
  }
  return record;
}

module.exports = { AUTHORITY, readRevocation, assertNotRevoked, revokeV2Package };
