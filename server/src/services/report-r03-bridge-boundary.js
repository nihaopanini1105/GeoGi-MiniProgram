'use strict';
// R03 receiver compatibility boundary. The actual standalone R03 durable
// customer reader and independent evidence attestation have NOT been accepted.
// Never route an R03 package into the legacy V2 saga or V21 pointer.
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
function rejectR03Package(value) {
  if (!isR03Package(value)) return false;
  throw new R03DeliveryError();
}
function revokeR03() { throw new R03DeliveryError(); }
module.exports = {
  R03DeliveryError, isR03Package, capabilities,
  deniedBinding, deniedAccess, rejectR03Package, revokeR03
};
