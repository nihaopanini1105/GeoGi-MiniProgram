'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-payment-scope-'));
process.env.GEOGI_PAYMENT_DATA_ROOT=root;
process.env.GEOGI_OS_BRIDGE_TOKEN='test-local-only';
process.env.FEISHU_APP_ID='isolation-test-only';
process.env.FEISHU_APP_SECRET='isolation-test-only';
process.env.FEISHU_BASE_APP_TOKEN='isolation-test-only';
process.env.FEISHU_LEADS_TABLE_ID='leads';
process.env.FEISHU_PROJECTS_TABLE_ID='projects';
const feishu=require('../src/services/feishu');
const clients=['client_A','client_B'];const project='shared_project';
const leads=clients.map(c=>({fields:{'客户编号':c,'项目编号':project,
  '品牌名称':c,'提交时间':'2026-10-19T08:00:00Z'}}));
const projects=clients.map(c=>({fields:{'客户编号':c,'项目编号':project,
  '品牌名称':c,'当前阶段':c==='client_A'?'INTAKE':'DIAGNOSIS'}}));
feishu.getTenantAccessToken=async()=> 'sandbox-token';
feishu.listBitableRecords=async({tableId})=>tableId==='leads'?leads:projects;
let modified=[];
feishu.updateBitableRecord=async({tableId,recordId,fields})=>{
  modified.push({tableId,recordId,fields});return {};
};
const store=require('../src/services/payment-store');
const service=require('../src/services/payment-service');
const ops=require('../src/services/os-operations-bridge');
(async()=>{try {
  const b=await store.createOrGetPaymentOrder({clientId:'client_B',projectId:project,
    submissionId:'sim',brandName:'B',phoneNumber:'13812345678'});
  assert.equal(b.created,true);
  await assert.rejects(store.createOrGetPaymentOrder({clientId:'client_A',
    projectId:project,brandName:'A',phoneNumber:'13800000000'}),
    /PAYMENT_CLIENT_PROJECT_SCOPE_CONFLICT/);
  await assert.rejects(service.ensureOrder({clientId:'client_A',projectId:project,
    phoneNumber:'13800000000'}),/PAYMENT_CLIENT_PROJECT_SCOPE_CONFLICT/);
  const payment=await service.getCustomerPayment({clientId:'client_A',projectId:project});
  assert.equal(payment.ok,true);
  assert.equal(payment.payment,null);
  assert.equal(payment.paymentRequired,true);
  const sync=await service.syncCustomerPayment({clientId:'client_A',projectId:project});
  assert.equal(sync.ok,false);
  const cancel=await service.cancelCustomerPayment({clientId:'client_A',projectId:project});
  assert.equal(cancel.ok,false);
  // The operational queue must not admit another client's paid order.
  const current=await ops.listOsIntakes();
  assert.equal(current.length,2);
  const one=current.find(x=>x.clientId==='client_A');
  assert.equal(one.payment,null);
  assert.equal(one.paymentRequired,true);
  assert.equal(one.paymentAdmissionMode,'payment_required');
  assert.equal(one.project.clientId,'client_A');
  const two=current.find(x=>x.clientId==='client_B');
  assert.equal(two.project.clientId,'client_B');
  assert(two.payment && two.payment.clientId==='client_B');
  // A webhook-derived financial update may mutate only the exact tenant and
  // project, even when another Feishu row shares that project ID.
  // Test source rows are returned via module injected mock; explicitly mark
  // record IDs so the resulting mutation target can be checked.
  for (const [i,item] of leads.entries())item.record_id='lead_'+clients[i];
  for (const [i,item] of projects.entries())item.record_id='project_'+clients[i];
  assert.equal(await service.projectPaymentProjection({projectId:project,
    paymentStatus:'paid'}),false);
  assert.equal(modified.length,0);
  assert.equal(await service.projectPaymentProjection({clientId:'client_A',
    projectId:project,paymentStatus:'paid'}),true);
  assert.deepEqual(modified.map(x=>x.recordId),['lead_client_A','project_client_A']);
  modified=[];
  assert.equal(await service.projectPaymentProjection({clientId:'client_missing',
    projectId:project,paymentStatus:'paid'}),false);
  assert.equal(modified.length,0);
  // A different customer's refund never blocks a valid supplement request.
  const updated=await store.updatePaymentOrder(b.order.outTradeNo,{status:'refunded',
    refundedAmount:19900,refundableAmount:0});
  assert.equal(updated.status,'refunded');
  // Exact customer-portal checks are covered by a separate high-level test.
  // Duplicate Feishu records must not be arbitrarily selected by the
  // customer-facing payment, sync, cancellation or read paths.
  const orderCountBefore=(await store.listPaymentOrders()).length;
  const mutationCountBefore=modified.length;
  for(const scenario of ['leads','projects','both']){
    const extraLead={...leads[0],record_id:'duplicate_lead'};
    const extraProject={...projects[0],record_id:'duplicate_project'};
    if(scenario==='leads'||scenario==='both')leads.push(extraLead);
    if(scenario==='projects'||scenario==='both')projects.push(extraProject);
    try{
      const args={clientId:'client_A',projectId:project};
      await assert.rejects(service.ensureOrder({...args,phoneNumber:'13800000000'}),
        /PAYMENT_CRM_SCOPE_AMBIGUOUS/,scenario+':order');
      await assert.rejects(service.getCustomerPayment(args),
        /PAYMENT_CRM_SCOPE_AMBIGUOUS/,scenario+':read');
      await assert.rejects(service.syncCustomerPayment(args),
        /PAYMENT_CRM_SCOPE_AMBIGUOUS/,scenario+':sync');
      await assert.rejects(service.cancelCustomerPayment(args),
        /PAYMENT_CRM_SCOPE_AMBIGUOUS/,scenario+':cancel');
      assert.equal(await service.projectPaymentProjection({...args,paymentStatus:'paid'}),
        false,scenario+':projection');
      assert.equal((await store.listPaymentOrders()).length,orderCountBefore,
        scenario+':must not create order');
      assert.equal(modified.length,mutationCountBefore,scenario+':must not write CRM');
    }finally{
      if(scenario==='leads'||scenario==='both')leads.pop();
      if(scenario==='projects'||scenario==='both')projects.pop();
    }
  }
  const uniqueRead=await service.getCustomerPayment({clientId:'client_A',projectId:project});
  assert.equal(uniqueRead.ok,true);
  assert.equal(uniqueRead.payment,null);
  console.log('PAYMENT_AND_OS_EXACT_CLIENT_PROJECT_SCOPE=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});