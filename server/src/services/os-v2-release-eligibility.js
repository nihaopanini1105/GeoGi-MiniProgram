'use strict';

// Customer report release is a separate authority check from package schema
// validation. A signed, well-formed package must not bypass the paid-product
// admission rules. No database access or mutable side effects live here.
function assessV2ReleaseEligibility({ packageDocument, leadRecord, payment, legacyCutoffAt, env = process.env }) {
  if (packageDocument.release_authority !== 'geo_diagnostic_html_release_v2' ||
      packageDocument.delivery_purpose !== 'baseline_diagnostic_report') {
    return { allowed: true, reason: 'other_authority_not_applicable' };
  }
  const clientId = packageDocument.client_id;
  const projectId = packageDocument.project_id;
  const fields = leadRecord && leadRecord.fields || {};
  const leadClient = text(fields.客户编号);
  const leadProject = text(fields.项目编号);
  if (!clientId || !projectId || leadClient !== clientId || leadProject !== projectId) {
    return { allowed: false, reason: 'crm_scope_invalid' };
  }
  const actualPayment = payment && payment.clientId === clientId && payment.projectId === projectId
    ? payment : null;
  if (payment && !actualPayment) return { allowed: false, reason: 'payment_scope_mismatch' };
  const pilot = String(env.GEOGI_V2_EXACT_PILOT_ENABLED || '').toLowerCase() === 'true'
    && clientId === String(env.GEOGI_V2_PILOT_CONSUMER_CLIENT_ID || '')
    && projectId === String(env.GEOGI_V2_PILOT_CONSUMER_PROJECT_ID || '')
    && clientId.length > 0 && projectId.length > 0;
  if (pilot) return { allowed: true, reason: 'exact_geogi_pilot' };
  if (actualPayment && ['paid', 'partially_refunded'].includes(actualPayment.status)) {
    return { allowed: true, reason: 'verified_paid_order' };
  }
  if (actualPayment && actualPayment.status === 'free' && actualPayment.channelId && actualPayment.sourceId) {
    return { allowed: true, reason: 'verified_channel_offer' };
  }
  if (actualPayment && ['refund_processing', 'refunded'].includes(actualPayment.status)) {
    return { allowed: false, reason: 'payment_refunded_or_refunding' };
  }
  const submittedMs = Date.parse(text(fields.提交时间));
  const cutoffMs = Date.parse(legacyCutoffAt);
  if (Number.isFinite(submittedMs) && Number.isFinite(cutoffMs) && submittedMs < cutoffMs) {
    return { allowed: true, reason: 'prepaid_product_launch_legacy' };
  }
  return { allowed: false, reason: 'paid_release_eligibility_missing' };
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('');
  if (value && typeof value === 'object') return text(value.text || value.name || value.value || '');
  return String(value || '').trim();
}

module.exports = { assessV2ReleaseEligibility };