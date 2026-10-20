'use strict';
// Prevent duplicate Feishu records from becoming professional-report grants.
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const base=path.resolve(__dirname,'../src/services');
const original={...process.env};
let leads=[],projects=[];
const loc=(name)=>require.resolve(path.join(base,name));
function stub(name,exports){const file=loc(name);require.cache[file]={id:file,filename:file,loaded:true,exports};}
process.env.GEOGI_OS_BRIDGE_TOKEN='synthetic-only';
process.env.FEISHU_APP_ID='synthetic';
process.env.FEISHU_APP_SECRET='synthetic';
process.env.FEISHU_BASE_APP_TOKEN='synthetic';
process.env.FEISHU_LEADS_TABLE_ID='leads';
process.env.FEISHU_PROJECTS_TABLE_ID='projects';
process.env.GEOGI_REPORT_V21_PUBLISH_ENABLED='true';
process.env.GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED='true';
process.env.GEOGI_V2_EXACT_PILOT_ENABLED='false';
stub('feishu',{getTenantAccessToken:async()=>'synthetic',listBitableRecords:async({tableId})=>tableId==='leads'?leads:projects,updateBitableRecord:async()=>{throw Error('No real writes')} });
stub('payment-store',{findPaymentByProject:async()=>({clientId:'client_A',projectId:'project_X',status:'paid',paidAt:'2026-10-20T00:00:00Z'}),publicPaymentView:(p)=>p,markProjectReportReleased:async()=>{throw Error('No real writes')} });
stub('delivery-package-store',{importDeliveryPackage:async()=>{throw Error('No real writes')}});
stub('channel-service',{reconcileCommission:async()=>{throw Error('No real writes')}});
const osBridge=require('../src/services/os-operations-bridge');
const {createV21Bridge}=require('../src/services/report-v21-bridge-operations');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-crm-unique-'));
const payment=async()=>({clientId:'client_A',projectId:'project_X',status:'paid',paidAt:'2026-10-20T00:00:00Z'});
const v21=createV21Bridge({findIntakes:osBridge.listOsIntakes,findPayment:payment,uploadRoot:path.join(root,'uploads'),dataRoot:path.join(root,'private')});
const lead=(client,project)=>({record_id:'lead-'+client,fields:{'客户编号':client,'项目编号':project,'提交时间':'2026-10-20T01:00:00Z'}});
const rec=(client,project,id)=>({record_id:id,fields:{'客户编号':client,'项目编号':project}});
async function check(expected,scenario){const list=await osBridge.listOsIntakes();const row=list.find(x=>x.clientId==='client_A'&&x.projectId==='project_X');assert.equal(Boolean(row.crmScopeUnique),expected,scenario+' CRM');assert.equal(Boolean(row.project),expected,scenario+' project');assert.equal(row.paymentEligibleForProcessing,expected,scenario+' OS admission');assert.equal((await v21.binding('client_A','project_X')).verified,expected,scenario+' V2.1 paid');}
(async()=>{try{
  leads=[lead('client_A','project_X')];projects=[rec('client_A','project_X','project1')];
  await check(true,'unique canonical CRM');
  // Duplicate project rows must not become valid via Map last-write-wins.
  projects=[rec('client_A','project_X','project1'),rec('client_A','project_X','project2')];
  await check(false,'duplicated CRM project');
  projects=[rec('client_A','project_X','project1')];
  leads=[lead('client_A','project_X'),{...lead('client_A','project_X'),record_id:'lead-duplicate'}];
  await check(false,'duplicated CRM lead');
  leads=[lead('client_A','project_X')];
  projects=[rec('client_A','project_X','project1'),rec('client_B','project_X','projectB')];
  await check(true,'different client uses same project ID');
  const other=(await osBridge.listOsIntakes()).find(x=>x.clientId==='client_A');
  assert.equal(other.paymentAdmissionMode,'paid');
  // Even a list supplied by a different CRM adapter cannot grant with
  // duplicate scoped records or explicit ambiguity indication.
  const fake=newBridgeRows=>createV21Bridge({findIntakes:async()=>newBridgeRows,findPayment:payment,uploadRoot:path.join(root,'uploads'),dataRoot:path.join(root,'private-'+Math.random().toString(16).slice(2))});
  const record={clientId:'client_A',projectId:'project_X',project:{clientId:'client_A',projectId:'project_X'}};
  assert.equal((await fake([record,record]).binding('client_A','project_X')).verified,false);
  assert.equal((await fake([{...record,crmScopeUnique:false}]).binding('client_A','project_X')).verified,false);
  assert.equal((await fake([record]).binding('client_A','project_X')).verified,true);
  // Pilot bypass must also reject ambiguous CRM ownership.
  process.env.GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED='false';
  process.env.GEOGI_V2_EXACT_PILOT_ENABLED='true';
  process.env.GEOGI_V2_PILOT_CONSUMER_CLIENT_ID='client_A';
  process.env.GEOGI_V2_PILOT_CONSUMER_PROJECT_ID='project_X';
  assert.equal(await fake([record,record]).binding('client_A','project_X').then(v=>v.verified),false);
  const denied=await fake([record,record]).currentReport('client_A','project_X');
  assert.equal(denied,null);
  console.log('V21_CRM_CANONICAL_SCOPE_UNIQUENESS=PASS (multiple Feishu and provider cases)');
}finally{fs.rmSync(root,{recursive:true,force:true});process.env=original;}})().catch(e=>{console.error(e);process.exitCode=1});