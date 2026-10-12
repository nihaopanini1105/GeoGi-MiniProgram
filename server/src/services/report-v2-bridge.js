'use strict';
const fs = require('fs');
const path = require('path');
const { validateDeliveryPackage, listDeliveryPackages } = require('./delivery-package-store');

const AUTHORITY = 'geo_diagnostic_html_release_v2';

function statePath() {
  return path.join(process.env.GEOGI_DELIVERY_PACKAGE_ROOT || path.join(__dirname, '../../data/delivery-packages'), 'v2-access-state.dat');
}
function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (!parsed || parsed.version !== 1 || typeof parsed.revoked !== 'object' || !parsed.revoked) throw Error('V2_STATE_INVALID');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, revoked: {} };
    throw error;
  }
}
function persistState(value) {
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + '.tmp-' + process.pid + '-' + require('crypto').randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag:'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function isRevoked(id) {
  return Boolean(readState().revoked[String(id || '')]);
}
async function resolveScopedPackage(body) {
  const id = String(body.delivery_package_id || '');
  const client = String(body.client_id || '');
  const project = String(body.project_id || '');
  const digest = String(body.artifact_sha256 || '').replace(/^sha256:/, '');
  if (!id || !client || !project || !/^[0-9a-f]{64}$/.test(digest)) throw Error('V2_SCOPE_INVALID');
  const matches = (await listDeliveryPackages()).filter(p => p.delivery_package_id === id);
  if (matches.length !== 1) throw Error('V2_PACKAGE_NOT_FOUND');
  const item = validateDeliveryPackage(matches[0]);
  if (item.release_authority !== AUTHORITY || item.client_id !== client ||
      item.project_id !== project || item.artifacts[0].sha256 !== digest) {
    throw Error('V2_PACKAGE_SCOPE_MISMATCH');
  }
  return item;
}
async function verifyAccess(body) {
  const item = await resolveScopedPackage(body);
  // This probe checks the release and exact artifact only. It cannot certify
  // a customer's phone-session entitlement; that is enforced by the reader.
  const revoked = isRevoked(item.delivery_package_id);
  return { authorized: false, accessible: false, release_valid: !revoked,
    customer_session_verified: false, client_id:item.client_id,
    project_id:item.project_id, delivery_package_id:item.delivery_package_id,
    artifact_sha256:item.artifacts[0].sha256 };
}
async function revoke(body) {
  const item = await resolveScopedPackage(body);
  if (!String(body.reason || '').trim()) throw Error('V2_REVOCATION_REASON_REQUIRED');
  const state=readState();
  state.revoked[item.delivery_package_id] = {
    artifact_sha256: item.artifacts[0].sha256,
    reason: String(body.reason).slice(0,500),
    revoked_at: new Date().toISOString(),
  };
  persistState(state);
  return { status:'revoked', delivery_package_id:item.delivery_package_id };
}
function capabilities() {
  return { release_authority:AUTHORITY, idempotent_upload:true,
    idempotent_publish:true, authenticated_customer_access:false,
    revoke:true, rollback:false };
}
module.exports = { AUTHORITY, isRevoked, verifyAccess, revoke, capabilities };
