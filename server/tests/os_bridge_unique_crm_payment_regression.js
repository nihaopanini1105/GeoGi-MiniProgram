'use strict';
// Real Mini listOsIntakes branch semantics, mocked Feishu + payment only.
// A paid order MUST NOT make ambiguous duplicate CRM rows processable.
const assert = require('node:assert/strict');

process.env.GEOGI_OS_BRIDGE_TOKEN = 'synthetic-scope-token';
process.env.FEISHU_APP_ID = 'synthetic-feishu-id';
process.env.FEISHU_APP_SECRET = 'synthetic-feishu-secret';
process.env.FEISHU_BASE_APP_TOKEN = 'synthetic-feishu-base';
process.env.FEISHU_LEADS_TABLE_ID = 'synthetic-leads';
process.env.FEISHU_PROJECTS_TABLE_ID = 'synthetic-projects';

let leads = [], projects = [], order = null;
const feishuPath = require.resolve('../src/services/feishu');
const paymentsPath = require.resolve('../src/services/payment-store');
const feishu = require(feishuPath);
const payments = require(paymentsPath);
require.cache[feishuPath].exports = {
  ...feishu,
  getTenantAccessToken: async () => 'synthetic-tenant-token',
  listBitableRecords: async ({ tableId }) =>
    tableId === 'synthetic-leads' ? leads :
    tableId === 'synthetic-projects' ? projects : []
};
require.cache[paymentsPath].exports = {
  ...payments,
  findPaymentByProject: async () => order,
  publicPaymentView: row => ({ status: row ? row.status : 'unpaid' })
};
const { listOsIntakes } = require('../src/services/os-operations-bridge');

const client = 'client_alpha', project = 'project_alpha';
const lead = (submittedAt='2026-10-24T00:00:00Z', clientId=client) =>
  ({fields: {'客户编号': clientId, '项目编号': project, '提交时间': submittedAt}});
const projectRow = (clientId=client) =>
  ({fields: {'客户编号': clientId, '项目编号': project}});
const paid = () => ({clientId:client,projectId:project,status:'paid'});
const assertBlocked = async (code) => {
  const rows=await listOsIntakes();
  assert(rows.length > 0, code + ': rows required');
  for (const row of rows) {
    assert.equal(row.paymentEligibleForProcessing,false,code);
    assert.equal(row.crmScopeUnique,false,code);
    assert.equal(row.paymentRequired,true,code);
    assert.equal(row.paymentAdmissionMode,'crm_scope_ambiguous',code);
    assert.equal(row.project,null,code);
  }
};

(async()=>{
  leads=[lead()]; projects=[projectRow()]; order=paid();
  let rows=await listOsIntakes();
  assert.equal(rows.length,1);
  assert.equal(rows[0].crmScopeUnique,true);
  assert.equal(rows[0].paymentEligibleForProcessing,true);
  assert.equal(rows[0].paymentAdmissionMode,'paid');

  leads=[lead(),lead()]; projects=[projectRow()]; order=paid();
  await assertBlocked('duplicate-lead-even-when-paid');

  leads=[lead()]; projects=[projectRow(),projectRow()]; order=paid();
  await assertBlocked('duplicate-project-even-when-paid');

  leads=[lead(),lead()]; projects=[projectRow(),projectRow()]; order=paid();
  await assertBlocked('both-crm-tables-duplicated');

  // A valid project's payment cannot authorize a second customer's record.
  leads=[lead()]; projects=[projectRow()];
  order={clientId:'client_other',projectId:project,status:'paid'};
  rows=await listOsIntakes();
  assert.equal(rows[0].crmScopeUnique,true);
  assert.equal(rows[0].paymentEligibleForProcessing,false);
  assert.equal(rows[0].paymentAdmissionMode,'payment_required');

  order=null;
  rows=await listOsIntakes();
  assert.equal(rows[0].paymentEligibleForProcessing,false);

  order={clientId:client,projectId:project,status:'free',channelId:'ch',sourceId:'src'};
  rows=await listOsIntakes();
  assert.equal(rows[0].paymentEligibleForProcessing,true);
  assert.equal(rows[0].paymentAdmissionMode,'channel_offer');

  order=null; leads=[lead('2026-09-22T07:00:00Z')];
  rows=await listOsIntakes();
  assert.equal(rows[0].paymentEligibleForProcessing,true);
  assert.equal(rows[0].paymentAdmissionMode,'legacy_pre_payment');

  // Even legacy status must be blocked when the CRM scope is ambiguous.
  leads=[lead('2026-09-22T07:00:00Z'),lead('2026-09-22T07:00:00Z')];
  await assertBlocked('duplicate-legacy-rows');
  console.log('OS_BRIDGE_UNIQUE_CRM_PAID_PROCESSING=PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
