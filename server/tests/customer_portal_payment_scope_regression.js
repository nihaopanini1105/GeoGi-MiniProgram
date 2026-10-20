'use strict';
// Same project_id may appear under different canonical customers. Do not
// grant cross-customer report access using a project-only payment lookup.
const assert=require('node:assert/strict');
process.env.FEISHU_LEADS_TABLE_ID='leads';
process.env.FEISHU_PROJECTS_TABLE_ID='projects';
process.env.FEISHU_BASE_APP_TOKEN='test_app';
process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED='false';
const feishu=require('../src/services/feishu');
const payments=require('../src/services/payment-store');
const delivery=require('../src/services/delivery-package-store');
const projectId='shared_project', a='client_A', b='client_B';
const leads=[a,b].map(client=>({fields:{'客户编号':client,'项目编号':projectId,
  '品牌名称':client,'提交时间':'2026-10-20T08:00:00Z'}}));
const projects=[a,b].map(client=>({fields:{'客户编号':client,'项目编号':projectId,
  '品牌名称':client,'当前阶段':client===a?'INTAKE':'DIAGNOSIS'}}));
feishu.getTenantAccessToken=async()=> 'test-only';
feishu.listBitableRecords=async({tableId})=> tableId==='leads'?leads:projects;
delivery.findDeliveryPackage=async({clientId})=>clientId===a?{
  client_id:a,project_id:projectId,delivery_package_id:'delivery_package_test',
  release_authority:'geo_diagnostic_html_release_v2',release_status:'released',
  released_at:'2026-10-20T12:00:00Z',report_reference:{report_version:2}
}:null;
delivery.projectDeliveryForCustomer=()=>({reportReady:true,artifactType:'h5'});
let pay={clientId:b,projectId,status:'paid',paidAt:'2026-10-20T09:00:00Z',amountYuan:199};
payments.findPaymentByProject=async()=>pay;
const {listCustomerProjects,getCustomerReport}=require('../src/services/customer-portal');
(async()=>{
  const mine=await listCustomerProjects({clientIds:[a,b]});
  assert.equal(mine.ok,true);
  assert.equal(mine.orders.length,2);
  const accountA=mine.orders.find(x=>x.clientId===a);
  const accountB=mine.orders.find(x=>x.clientId===b);
  assert.equal(accountA.projectId,projectId);
  assert.equal(accountB.projectId,projectId);
  assert.equal(accountA.brandName,a);
  assert.equal(accountB.brandName,b);
  assert.equal(accountA.paymentStatus,'unpaid');
  assert.equal(accountA.reportReady,false);
  assert.equal(accountB.paymentStatus,'paid');
  assert.equal(accountB.reportReady,false);
  const unauthorized=await getCustomerReport({clientId:a,projectId});
  assert.equal(unauthorized.ok,true);
  assert.equal(unauthorized.report.reportReady,false);
  assert.equal(unauthorized.order.paymentStatus,'unpaid');
  // Even with a matching client, a payment for a different project is invalid.
  pay={clientId:a,projectId:'another_project',status:'paid',amountYuan:199};
  const wrongProject=await getCustomerReport({clientId:a,projectId});
  assert.equal(wrongProject.report.reportReady,false);
  assert.equal(wrongProject.order.paymentStatus,'unpaid');
  // An actual exact-scoped payment can authorize an existing V2 report.
  pay={clientId:a,projectId,status:'paid',paidAt:'2026-10-20T09:00:00Z',amountYuan:199};
  const proper=await getCustomerReport({clientId:a,projectId});
  assert.equal(proper.report.reportReady,true);
  assert.equal(proper.order.paymentStatus,'paid');
  console.log('CUSTOMER_PORTAL_EXACT_CLIENT_PROJECT_PAYMENT_SCOPE=PASS');
})().catch(e=>{console.error(e);process.exitCode=1});