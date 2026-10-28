'use strict';
const crypto = require('node:crypto');
const { validatePackage: validateV21StructuralPackage } =
  require('./report-v21-bridge-operations');
// R03 structural preflight and historical denial helpers. Live capability,
// authorization and delivery now belong to report-r03-bridge-operations.
// These legacy denial exports never authorize a package or a customer reader.
const AUTHORITY = 'geo_diagnostic_html_release_r03';
const PURPOSE = 'report_r03_diagnostic';
const STATUS = 'R03_RECEIVER_NOT_READY';

class R03DeliveryError extends Error {
  constructor(code=STATUS) { super(code); this.code=code; }
}
function isR03Package(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value.delivery_purpose === PURPOSE || value.release_authority === AUTHORITY);
}
function capabilities() {
  return {
    enabled: false,
    release_authority: AUTHORITY,
    delivery_purpose: PURPOSE,
    supports_18_section_same_snapshot_h5_pdf: false,
    customer_scoped_access_and_revocation: false,
    receiver_status: 'EXTERNAL_BLOCKED_R03_RECEIVER',
    v2_v21_unchanged: true,
    production_release_approved: false
  };
}
function deniedBinding(input={}) {
  return {
    verified: false, paid_order_verified: false,
    customer_access_scoped: false, customer_release_authorized: false,
    independent_a01_epoch_verified: false,
    sixteen_metrics_evidence_verified: false, source_rights_verified: false,
    client_id: input.client_id || null, project_id: input.project_id || null,
    receiver_status: STATUS
  };
}
function deniedAccess(input={}) {
  return {
    authorized: false, accessible: false,
    client_id: input.client_id || null, project_id: input.project_id || null,
    delivery_package_id: input.delivery_package_id || null,
    receiver_status: STATUS
  };
}
// Read-only cross-repository R03 package handshake. Reuse the existing V21
// canonical content-addressed artifact contract because the OS R03 builder
// intentionally uses that version's H5/PDF byte pair. NEVER reuse its paid
// binding, delivery pointer, legacy publication or customer reader.
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}
const canonicalJson = (value) => JSON.stringify(canonical(value));
const PIN = /^[A-Za-z0-9_-]{1,128}$/;
function inspectR03PackageCandidate(value) {
  if (!isR03Package(value) || value.delivery_purpose !== PURPOSE
      || value.release_authority !== AUTHORITY
      || value.release_status !== 'released'
      || typeof value.package_hash !== 'string'
      || !/^sha256:[0-9a-f]{64}$/.test(value.package_hash)) {
    throw new R03DeliveryError('R03_CANDIDATE_CONTRACT_INVALID');
  }
  const unsigned = {...value}; delete unsigned.package_hash;
  if (value.package_hash !== 'sha256:' + hash(canonicalJson(unsigned))) {
    throw new R03DeliveryError('R03_CANDIDATE_HASH_MISMATCH');
  }
  const lineage = value.r03_current_cycle_source_readback;
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)
      || lineage.lineage_contract !== 'r03_current_cycle_report_source_v1'
      || lineage.status !== 'PROVENANCE_READBACK_ONLY_NOT_PUBLISHED'
      || lineage.customer_release_authorized !== true
      || lineage.independent_a01_epoch_verified !== true
      || lineage.real_customer_business_accepted !== false
      || !/^sha256:[0-9a-f]{64}$/.test(lineage.source_report_snapshot_sha256 || '')
      || !['source_observation_batch_id', 'source_score_snapshot_id',
            'source_retest_comparison_id'].every(k =>
              typeof lineage[k] === 'string' && PIN.test(lineage[k]))) {
    throw new R03DeliveryError('R03_CANDIDATE_SOURCE_PINS_INVALID');
  }
  if (lineage.source_report_snapshot_sha256 !==
      (value.report_reference || {}).content_hash) {
    throw new R03DeliveryError('R03_CANDIDATE_SNAPSHOT_MISMATCH');
  }
  if(value.r03_report_definition){
    try {require('./report-r03-bridge-operations').validatePackage(value);}
    catch(_error){throw new R03DeliveryError('R03_CANDIDATE_PAIRED_ARTIFACT_CONTRACT_INVALID');}
  } else {
  // Re-compute the V21 projection hash solely for reuse of the EXISTING pure
  // canonical checker. This does not turn the R03 payload into a V21 release.
  const structuralProjection = {
    ...value,
    delivery_purpose:'report_v21_diagnostic',
    release_authority:'geo_diagnostic_html_release_v21'
  };
  delete structuralProjection.r03_current_cycle_source_readback;
  delete structuralProjection.package_hash;
  structuralProjection.package_hash =
    'sha256:' + hash(canonicalJson(structuralProjection));
  try {
    validateV21StructuralPackage(structuralProjection);
  } catch (_e) {
    throw new R03DeliveryError('R03_CANDIDATE_PAIRED_ARTIFACT_CONTRACT_INVALID');
  }
  }
  // A package is not an independent A01/rights/payment/customer attestation.
  // NEVER return enabled:true, verified:true, a readable URL or a publish ack.
  return {
    status:'R03_STRUCTURAL_ONLY_NOT_AUTHORIZED',
    structural_contract_valid:true,
    release_authority:AUTHORITY,
    delivery_purpose:PURPOSE,
    package_hash:value.package_hash,
    independent_business_evidence_verified:false,
    paid_binding_verified:false,
    private_artifact_bytes_verified:false,
    customer_release_approved:false,
    production_release_approved:false
  };
}
function rejectR03Package(value) {
  if (!isR03Package(value)) return false;
  throw new R03DeliveryError();
}
function revokeR03() { throw new R03DeliveryError(); }
module.exports = {
  R03DeliveryError, isR03Package, capabilities,
  deniedBinding, deniedAccess, inspectR03PackageCandidate,
  rejectR03Package, revokeR03
};
