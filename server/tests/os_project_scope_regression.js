'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createOrGetPaymentOrder, markProjectReportReleased, findPaymentByProject } = require('../src/services/payment-store');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-project-scope-'));
process.env.GEOGI_PAYMENT_DATA_ROOT=path.join(temp,'payment');
let leads=[],projects=[],writes=[];
const oldLoad=Module._load;
Module._load=function(request,parent,isMain) {
  if (request==='./feishu' && parent && parent.filename.endsWith('/services/os-operations-bridge.js')) return {
    getTenantAccessToken:async()=> 'local-test-only',
    listBitableRecords:async({tableId})=>tableId==='leads'?leads:projects,
    updateBitableRecord:async(entry)=>{writes.push(entry);return {ok:true};}
  };
  return oldLoad.apply(this,arguments);
};
const { updateOsProjectStage }=require('../src/services/os-operations-bridge');
Module._load=oldLoad;
const row=(client,project,id)=>({record_id:id,fields:{客户编号:client,项目编号:project,当前阶段:'INTAKE'}});
(async()=>{
 try{
  process.env.FEISHU_LEADS_TABLE_ID='leads';
  process.env.FEISHU_PROJECTS_TABLE_ID='projects';
  process.env.FEISHU_BASE_APP_TOKEN='test_base';
  leads=[row('A','SAME','L-A'),row('B','SAME','L-B')];
  projects=[row('A','SAME','P-A'),row('B','SAME','P-B')];
  await assert.rejects(updateOsProjectStage({projectId:'SAME',stage:'RELEASED',clientId:'A'}),
    e=>e.code==='OS_BRIDGE_PROJECT_SCOPE_AMBIGUOUS');
  assert.equal(writes.length,0);
  leads=[row('A','SINGLE','L-A')];
  projects=[row('B','SINGLE','P-B')];
  await assert.rejects(updateOsProjectStage({projectId:'SINGLE',stage:'RELEASED'}),
    e=>e.code==='OS_BRIDGE_PROJECT_SCOPE_MISMATCH');
  assert.equal(writes.length,0);
  projects=[row('A','SINGLE','P-A')];
  await assert.rejects(updateOsProjectStage({clientId:'B',projectId:'SINGLE',stage:'RELEASED'}),
    e=>e.code==='OS_BRIDGE_PROJECT_SCOPE_MISMATCH');
  assert.equal(writes.length,0);
  const ok=await updateOsProjectStage({clientId:'A',projectId:'SINGLE',stage:'RELEASED'});
  assert.equal(ok.stage,'RELEASED');
  assert.deepEqual(writes.map(v=>v.recordId),['L-A','P-A']);
  writes=[];
  await updateOsProjectStage({projectId:'SINGLE',stage:'REVIEW'});
  assert.deepEqual(writes.map(v=>v.recordId),['L-A','P-A']);

  const created=await createOrGetPaymentOrder({clientId:'A',projectId:'SINGLE',submissionId:'SYNTH',
    brandName:'TEST',phoneNumber:'13800138000',amountTotal:19900});
  await assert.rejects(markProjectReportReleased('SINGLE','2026-10-20T12:00:00Z'),
    e=>e.code==='PAYMENT_REPORT_RELEASE_SCOPE_REQUIRED');
  await assert.rejects(markProjectReportReleased('SINGLE','2026-10-20T12:00:00Z','B'),
    e=>e.code==='PAYMENT_REPORT_RELEASE_SCOPE_MISMATCH');
  assert.equal((await findPaymentByProject('SINGLE')).reportReleasedAt,'');
  const marked=await markProjectReportReleased('SINGLE','2026-10-20T12:00:00Z','A');
  assert.equal(marked.reportReleasedAt,'2026-10-20T12:00:00Z');
  console.log('OS_PROJECT_STAGE_AND_PAYMENT_RELEASE_SCOPE=PASS');
 } finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});