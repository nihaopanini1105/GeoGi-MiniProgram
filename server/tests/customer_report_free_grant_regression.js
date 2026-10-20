'use strict';
// A free status alone cannot authorize V2 reading, report-complete messaging,
// or zero-payment presentation without matching channel offer provenance.
const assert=require('node:assert/strict');
process.env.FEISHU_LEADS_TABLE_ID='leads';
process.env.FEISHU_PROJECTS_TABLE_ID='projects';
process.env.FEISHU_BASE_APP_TOKEN='test_app';
process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED='false';
const feishu=require('../src/services/feishu');
const payments=require('../src/services/payment-store');
const delivery=require('../src/services/delivery-package-store');
const clientId='client_A',projectId='project_A';
const lead={fields:{'客户编号':clientId,'项目编号':projectId,'品牌名称':'Synthetic', '提交时间':'2026-10-20T08:00:00Z'}};
const project={fields:{'客户编号':clientId,'项目编号':projectId,'当前阶段':'REVIEW'}};
let includeProject=true;
let payment={clientId,projectId,status:'free'};
feishu.getTenantAccessToken=async()=> 'test-only';
feishu.listBitableRecords=async({tableId})=>tableId==='leads'?[lead]:(includeProject?[project]:[]);
payments.findPaymentByProject=async()=>payment;
delivery.findDeliveryPackage=async()=>({client_id:clientId,project_id:projectId,
  delivery_package_id:'delivery_package_test',release_authority:'geo_diagnostic_html_release_v2',
  release_status:'released',released_at:'2026-10-20T12:00:00Z',report_reference:{report_version:2}});
delivery.projectDeliveryForCustomer=()=>({deliveryPackageId:'delivery_package_test',artifactType:'h5'});
const {isPaidForReport,getCustomerReport,listCustomerProjects,buildPendingReport,normalizeOrder}=require('../src/services/customer-portal');
(async()=>{
 assert.equal(isPaidForReport(payment),false);
 assert.equal(isPaidForReport({...payment,status:'refunded',channelId:'channel',sourceId:'source'}),false);
 let result=await getCustomerReport({clientId,projectId});
 assert.equal(result.ok,true);
 assert.equal(result.report.reportReady,false);
 assert.equal(result.report.paymentRequired,true);
 assert.equal(result.order.paymentRequired,true);
 let mine=await listCustomerProjects({clientId});
 assert.equal(mine.orders[0].reportReady,false);
 assert.equal(mine.orders[0].paymentRequired,true);
 assert.equal(mine.notifications.some(n=>n.type==='report_ready'),false);
 payment={...payment,channelId:'channel_A'};
 assert.equal((await getCustomerReport({clientId,projectId})).report.reportReady,false);
 payment={...payment,sourceId:'real_channel_source'};
 assert.equal(isPaidForReport(payment),true);
 result=await getCustomerReport({clientId,projectId});
 assert.equal(result.report.reportReady,true);
 assert.equal(result.order.paymentRequired,false);
 assert.equal((await listCustomerProjects({clientId})).orders[0].reportReady,true);
 includeProject=false;
 result=await getCustomerReport({clientId,projectId});
 assert.equal(result.report.reportReady,false);
 assert.equal((await listCustomerProjects({clientId})).orders[0].reportReady,false);
 // Keep historical raw payment audit separate from authorization.
 assert.equal(result.order.paymentStatus,'free');
 assert.equal(isPaidForReport({status:'paid'}),true);
 assert.equal(isPaidForReport({status:'partially_refunded'}),true);
 assert.equal(isPaidForReport({status:'refund_processing'}),false);
 console.log('CUSTOMER_FREE_ORDER_GRANT_AND_PROJECT_SCOPE=PASS');
})().catch(e=>{console.error(e);process.exitCode=1});