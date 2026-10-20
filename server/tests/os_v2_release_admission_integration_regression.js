'use strict';
// Exercise the actual MiniProgram OS bridge with isolated Feishu/payment/import
// dependencies. No real Feishu, WeChat, or customer files are contacted.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const bridgePath = path.resolve(__dirname,'../src/services/os-operations-bridge.js');
const originalLoad = Module._load;
const originalEnv = { ...process.env };
const state = { payment:null,submittedAt:'2026-10-01T00:00:00Z',updates:[],imports:[],marks:[],commissions:[] };
const clientId='client_A',projectId='project_1';
function reset() { state.updates=[];state.imports=[];state.marks=[];state.commissions=[];state.payment=null;
  state.submittedAt='2026-10-01T00:00:00Z'; }
const feishu={
  getTenantAccessToken:async()=> 'synthetic_tenant_token',
  listBitableRecords:async({tableId})=> tableId==='leads'
    ? [{record_id:'lead_A',fields:{客户编号:clientId,项目编号:projectId,提交时间:state.submittedAt}}]
    : [{record_id:'project_A',fields:{客户编号:clientId,项目编号:projectId}}],
  updateBitableRecord:async (args)=>{state.updates.push(args);return {ok:true};}
};
const delivery={importDeliveryPackage:async doc=>{state.imports.push(doc);return {imported:true,idempotent:false};}};
const paymentStore={
  findPaymentByProject:async()=>state.payment,
  markProjectReportReleased:async(project,released,client)=>{
    state.marks.push([project,released,client]);return state.payment;},
  publicPaymentView:order=>order
};
const channel={reconcileCommission:async args=>{state.commissions.push(args);return null;}};
Module._load = function(request,parent,isMain) {
  if (parent && parent.filename===bridgePath && request==='./feishu') return feishu;
  if (parent && parent.filename===bridgePath && request==='./delivery-package-store') return delivery;
  if (parent && parent.filename===bridgePath && request==='./payment-store') return paymentStore;
  if (parent && parent.filename===bridgePath && request==='./channel-service') return channel;
  return originalLoad.call(this,request,parent,isMain);
};
let os;
try { os=require(bridgePath); } finally { Module._load=originalLoad; }
const report={client_id:clientId,project_id:projectId,release_authority:'geo_diagnostic_html_release_v2',
  delivery_purpose:'baseline_diagnostic_report',delivery_package_id:'synthetic_pkg',released_at:'2026-10-20T09:00:00Z'};
function verifyNoWrites() {
  assert.equal(state.imports.length,0,'invalid customer report must not be imported');
  assert.equal(state.updates.length,0,'invalid customer must not change Feishu');
  assert.equal(state.marks.length,0,'invalid customer must not mark payment');
  assert.equal(state.commissions.length,0,'invalid customer must not earn commission');
}
(async()=>{
  try {
    process.env.FEISHU_LEADS_TABLE_ID='leads';process.env.FEISHU_PROJECTS_TABLE_ID='projects';
    process.env.FEISHU_BASE_APP_TOKEN='synthetic_app_token';
    process.env.GEOGI_V2_EXACT_PILOT_ENABLED='false';
    await assert.rejects(os.publishOsDeliveryPackage(report),/OS_BRIDGE_V2_RELEASE_NOT_ELIGIBLE/);
    verifyNoWrites();
    reset();state.payment={clientId:'another_client',projectId,status:'paid'};
    await assert.rejects(os.publishOsDeliveryPackage(report),/OS_BRIDGE_PAYMENT_SCOPE_MISMATCH/);
    verifyNoWrites();
    reset();state.payment={clientId,projectId,status:'refund_processing'};
    await assert.rejects(os.publishOsDeliveryPackage(report),/OS_BRIDGE_V2_RELEASE_NOT_ELIGIBLE/);
    verifyNoWrites();
    reset();state.payment={clientId,projectId,status:'free'};
    await assert.rejects(os.publishOsDeliveryPackage(report),/OS_BRIDGE_V2_RELEASE_NOT_ELIGIBLE/);
    verifyNoWrites();
    reset();state.payment={clientId,projectId,status:'paid'};
    const published=await os.publishOsDeliveryPackage(report);
    assert.equal(published.status,'published');
    assert.equal(state.imports.length,1);assert.equal(state.updates.length,2);
    assert.deepEqual(state.marks[0],[projectId,report.released_at,clientId]);
    reset();state.payment={clientId,projectId,status:'free',channelId:'channel_1',sourceId:'source_1'};
    assert.equal((await os.publishOsDeliveryPackage(report)).status,'published');
    reset();state.submittedAt='2026-09-21T00:00:00Z';
    assert.equal((await os.publishOsDeliveryPackage(report)).status,'published');
    reset();process.env.GEOGI_V2_EXACT_PILOT_ENABLED='true';
    process.env.GEOGI_V2_PILOT_CONSUMER_CLIENT_ID=clientId;
    process.env.GEOGI_V2_PILOT_CONSUMER_PROJECT_ID=projectId;
    assert.equal((await os.publishOsDeliveryPackage(report)).status,'published');
    console.log('OS_V2_ADMISSION_BEFORE_IMPORT_INTEGRATION=PASS (8 scenarios)');
  } finally { process.env=originalEnv; }
})().catch(e=>{console.error(e);process.exitCode=1;});