'use strict';
const assert = require('node:assert/strict');
const { assessV2ReleaseEligibility: decide } = require('../src/services/os-v2-release-eligibility');
const cutoff='2026-09-22T07:33:31Z';
const base={
  packageDocument:{client_id:'client_A',project_id:'project_1',delivery_authority:'geogi_os',
    delivery_purpose:'baseline_diagnostic_report',release_authority:'geo_diagnostic_html_release_v2'},
  leadRecord:{fields:{客户编号:'client_A',项目编号:'project_1',提交时间:'2026-10-15T01:00:00Z'}},
  payment:null,legacyCutoffAt:cutoff,env:{}
};
const call=(change={})=>decide({...base,...change});
const order=(status,extras={})=>({clientId:'client_A',projectId:'project_1',status,...extras});
assert.deepEqual(call(),{allowed:false,reason:'paid_release_eligibility_missing'});
assert.equal(call({payment:order('unpaid')}).allowed,false);
assert.equal(call({payment:order('paying')}).allowed,false);
assert.equal(call({payment:order('paid')}).reason,'verified_paid_order');
assert.equal(call({payment:order('partially_refunded')}).allowed,true);
assert.equal(call({payment:order('free',{channelId:'channel',sourceId:'source'})}).reason,'verified_channel_offer');
assert.equal(call({payment:order('free',{channelId:'channel'})}).allowed,false);
assert.equal(call({payment:order('free')}).allowed,false);
assert.equal(call({payment:{...order('paid'),clientId:'client_B'}}).reason,'payment_scope_mismatch');
assert.equal(call({leadRecord:{fields:{客户编号:'client_B',项目编号:'project_1',提交时间:'2026-10-01T00:00:00Z'}},payment:order('paid')}).reason,'crm_scope_invalid');
const legacyLead={fields:{客户编号:'client_A',项目编号:'project_1',提交时间:'2026-09-21T00:00:00Z'}};
assert.equal(call({leadRecord:legacyLead}).reason,'prepaid_product_launch_legacy');
assert.equal(call({leadRecord:legacyLead,payment:order('refunded')}).allowed,false);
assert.equal(call({leadRecord:legacyLead,payment:order('refund_processing')}).allowed,false);
assert.equal(call({leadRecord:{fields:{...legacyLead.fields,提交时间:'nonsense'}}}).allowed,false);
assert.equal(call({leadRecord:{fields:{...legacyLead.fields,提交时间:cutoff}}}).allowed,false);
assert.equal(call({env:{GEOGI_V2_EXACT_PILOT_ENABLED:'true',GEOGI_V2_PILOT_CONSUMER_CLIENT_ID:'client_A',GEOGI_V2_PILOT_CONSUMER_PROJECT_ID:'project_1'}}).reason,'exact_geogi_pilot');
assert.equal(call({env:{GEOGI_V2_EXACT_PILOT_ENABLED:'true',GEOGI_V2_PILOT_CONSUMER_CLIENT_ID:'client_B',GEOGI_V2_PILOT_CONSUMER_PROJECT_ID:'project_1'}}).allowed,false);
assert.equal(call({packageDocument:{...base.packageDocument,release_authority:'baseline_diagnostic_release_v1'}}).reason,'other_authority_not_applicable');
console.log('OS_V2_RELEASE_PAID_OR_EXACT_GRANT=PASS (19 cases)');