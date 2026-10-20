'use strict';
// An authenticated customer's Mine view should reflect the independently
// authorized V2.1 release, without rewriting V2 or the payment ledger.
const assert = require('node:assert/strict');
process.env.FEISHU_LEADS_TABLE_ID='leads';
process.env.FEISHU_PROJECTS_TABLE_ID='projects';
process.env.FEISHU_BASE_APP_TOKEN='test-app';
process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED='true';

const feishu=require('../src/services/feishu');
const payments=require('../src/services/payment-store');
const packages=require('../src/services/delivery-package-store');
const v21=require('../src/services/report-v21-bridge-operations');
const client='client_alpha', project='project_alpha';
const other='client_other', otherProject='project_other';
const leads=[
  {fields:{'客户编号':client,'项目编号':project,'品牌名称':'Alpha', '提交时间':'2026-10-17T10:00:00Z'}},
  {fields:{'客户编号':other,'项目编号':otherProject,'品牌名称':'Other','提交时间':'2026-10-18T10:00:00Z'}}
];
const projects=leads.map(x=>({fields:{'客户编号':x.fields['客户编号'],
  '项目编号':x.fields['项目编号'],'当前阶段':'DIAGNOSIS'}}));
feishu.getTenantAccessToken=async()=> 'sandbox-token';
feishu.listBitableRecords=async ({tableId})=>tableId==='leads'?leads:projects;
packages.findDeliveryPackage=async()=>null; // V2 remains unpublished.
payments.findPaymentByProject=async (projectId)=>({clientId:projectId===project?client:other,
  projectId,status:'paid',amountYuan:199,paidAt:'2026-10-18T10:00:00Z'});
let mode='ready';
let calls=[];
v21.getV21CustomerReport=async (c,p)=>{
  calls.push([c,p]);
  if(mode==='error')throw Error('temporary_v21_outage');
  if(mode==='revoked')return null;
  if(mode==='cross-client')return {clientId:other,projectId:p,
    version:'2.1',deliveryPackageId:'delivery_package_v21_'+ 'a'.repeat(24)};
  return {clientId:c,projectId:p,version:'2.1',
    deliveryPackageId:'delivery_package_v21_'+ 'a'.repeat(24),
    releasedAt:'2026-10-20T01:00:00Z'};
};
const {listCustomerProjects,projectV21VerifiedReport}=require('../src/services/customer-portal');
(async()=>{
  const owner=await listCustomerProjects({clientIds:[client]});
  assert.equal(owner.ok,true);
  assert.equal(owner.orders.length,1);
  const shown=owner.orders[0];
  assert.equal(shown.reportReady,true);
  assert.equal(shown.v21ReportReady,true);
  assert.equal(shown.version,'2.1');
  assert.equal(shown.status,'报告已完成');
  assert.equal(shown.completedAt,'2026-10-20T01:00:00Z');
  assert.equal(shown.reportLink,'');
  assert.equal(shown.paymentStatus,'paid');
  assert.equal(shown.canSupplement,false);
  assert(owner.notifications.some(x=>x.id.includes('delivery_package_v21_')));
  assert.deepEqual(calls,[[client,project]]);
  mode='revoked';
  const revoked=await listCustomerProjects({clientIds:[client]});
  assert.equal(revoked.orders[0].reportReady,false);
  assert.equal(revoked.orders[0].v21ReportReady,undefined);
  assert(!revoked.notifications.some(x=>x.type==='report_ready'));
  mode='cross-client';
  const foreign=await listCustomerProjects({clientIds:[client]});
  assert.equal(foreign.orders[0].reportReady,false);
  mode='error';
  const unavailable=await listCustomerProjects({clientIds:[client]});
  assert.equal(unavailable.ok,true);
  assert.equal(unavailable.orders[0].reportReady,false);
  process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED='false';
  calls=[];
  const disabled=await listCustomerProjects({clientIds:[client]});
  assert.equal(disabled.orders[0].reportReady,false);
  assert.equal(calls.length,0);
  assert.equal(projectV21VerifiedReport({clientId:client,projectId:project},
    {clientId:client,projectId:project,version:'2.0',deliveryPackageId:'bad'}).v21ReportReady,undefined);
  console.log('CUSTOMER_V21_VERIFIED_MINE_VISIBILITY_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});