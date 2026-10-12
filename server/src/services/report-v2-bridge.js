'use strict';

// GeoGi OS report V2 bridge. All OS routes require the existing bearer bridge
// guard. Customer access is additionally checked against real phone ownership,
// exact project, payment policy and immutable on-disk HTML bytes.
const fs = require('fs');
const { getTenantAccessToken, listBitableRecords } = require('./feishu');
const { resolveOwnedClientId } = require('./customer-session');
const { getCustomerReport } = require('./customer-portal');
const { getUploadRoot } = require('./uploads');
const { readVerifiedH5Artifact } = require('./h5-reader-ticket');
const { listDeliveryPackages } = require('./delivery-package-store');
const { getRevocation, revokeV2Package } = require('./report-v2-revocation-store');
const { configured: osConfigured } = require('./os-operations-bridge');

const AUTHORITY = 'geo_diagnostic_html_release_v2';
const SHA_RE = /^[0-9a-f]{64}$/;

function isV2Enabled() {
  // Must be explicitly enabled AFTER versioned deployment and private H5
  // end-to-end access / revocation tests. No silent migration from V1.
  return process.env.GEOGI_REPORT_V2_BRIDGE_ENABLED === 'true' &&
    osConfigured() &&
    Boolean(process.env.CUSTOMER_SESSION_SECRET);
}

function v2Capabilities() {
  const enabled = isV2Enabled();
  return {
    release_authority: AUTHORITY,
    idempotent_upload: enabled,
    idempotent_publish: enabled,
    authenticated_customer_access: enabled,
    revoke: enabled,
    rollback: enabled
  };
}

function requireV2Enabled() {
  if (!isV2Enabled()) {
    const error = new Error('V2_BRIDGE_NOT_ENABLED');
    error.code = 'V2_BRIDGE_NOT_ENABLED';
    throw error;
  }
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

function exactScope(request) {
  const row = request || {};
  for (const key of ['delivery_package_id', 'client_id', 'project_id']) {
    if (!/^[A-Za-z0-9_.-]{1,180}$/.test(String(row[key] || ''))) {
      const error = new Error('V2_BRIDGE_SCOPE_INVALID');
      error.code = 'V2_BRIDGE_SCOPE_INVALID';
      throw error;
    }
  }
  if (!SHA_RE.test(String(row.artifact_sha256 || ''))) {
    const error = new Error('V2_BRIDGE_ARTIFACT_SHA_INVALID');
    error.code = 'V2_BRIDGE_ARTIFACT_SHA_INVALID';
    throw error;
  }
  return row;
}

async function lookupExactV2Package(request) {
  const scoped = exactScope(request);
  const packages = await listDeliveryPackages();
  const matches = packages.filter(item => item.delivery_package_id === scoped.delivery_package_id);
  if (matches.length !== 1) return null;
  const pkg = matches[0];
  const artifact = (pkg.artifacts || [])[0] || {};
  if (pkg.release_authority !== AUTHORITY ||
      pkg.client_id !== scoped.client_id ||
      pkg.project_id !== scoped.project_id ||
      artifact.sha256 !== scoped.artifact_sha256 ||
      artifact.mime_type !== 'text/html' || artifact.artifact_type !== 'h5') return null;
  return pkg;
}

async function confirmCustomerOwnership({ clientId, projectId }) {
  const token = await getTenantAccessToken();
  const rows = await listBitableRecords({
    tenantToken: token,
    appToken: process.env.FEISHU_BASE_APP_TOKEN,
    tableId: process.env.FEISHU_LEADS_TABLE_ID,
    pageSize: 100
  });
  const owned = rows.filter(row => (
    text(row.fields && row.fields.客户编号) === clientId &&
    text(row.fields && row.fields.项目编号) === projectId
  ));
  if (owned.length !== 1) return false;
  const phone = text(owned[0].fields && owned[0].fields.联系方式);
  if (!/^\+?[0-9]{8,20}$/.test(phone)) return false;
  const resolved = await resolveOwnedClientId({
    phoneNumber: phone,
    requestedClientId: clientId
  });
  return resolved === clientId;
}

async function verifyV2CustomerAccess(request, deps = {}) {
  requireV2Enabled();
  const scoped = exactScope(request);
  const base = {
    authorized: false, accessible: false,
    client_id: scoped.client_id,
    project_id: scoped.project_id,
    delivery_package_id: scoped.delivery_package_id,
    artifact_sha256: scoped.artifact_sha256
  };
  const packageLookup = deps.packageLookup || lookupExactV2Package;
  const revokedLookup = deps.revokedLookup || getRevocation;
  const ownershipLookup = deps.ownershipLookup || confirmCustomerOwnership;
  const reportLookup = deps.reportLookup || getCustomerReport;
  const reader = deps.reader || readVerifiedH5Artifact;
  const pkg = await packageLookup(scoped);
  if (!pkg || revokedLookup(scoped.delivery_package_id)) return base;
  if (!await ownershipLookup({ clientId: scoped.client_id, projectId: scoped.project_id })) return base;
  const report = await reportLookup({ clientId: scoped.client_id, projectId: scoped.project_id });
  const delivery = report && report.report;
  if (!report || report.ok !== true || !delivery || !delivery.reportReady ||
      delivery.deliveryPackageId !== scoped.delivery_package_id ||
      delivery.artifactSha256 !== scoped.artifact_sha256 ||
      delivery.artifactType !== 'h5' || delivery.artifactMimeType !== 'text/html') return base;
  const artifact = pkg.artifacts[0];
  if (delivery.artifactFileName !== artifact.file_name) return base;
  try {
    const bytes = reader(getUploadRoot(), artifact.file_name, scoped.artifact_sha256);
    if (!Buffer.isBuffer(bytes) || !bytes.length) return base;
  } catch (error) {
    return base;
  }
  return { ...base, authorized: true, accessible: true };
}

async function revokeV2Delivery(request) {
  requireV2Enabled();
  const scoped = exactScope(request);
  const pkg = await lookupExactV2Package(scoped);
  if (!pkg) {
    const error = new Error('V2_DELIVERY_PACKAGE_NOT_FOUND');
    error.code = 'V2_DELIVERY_PACKAGE_NOT_FOUND';
    throw error;
  }
  return revokeV2Package(pkg, scoped);
}

module.exports = {
  AUTHORITY, isV2Enabled, v2Capabilities, exactScope,
  lookupExactV2Package, confirmCustomerOwnership,
  verifyV2CustomerAccess, revokeV2Delivery
};
