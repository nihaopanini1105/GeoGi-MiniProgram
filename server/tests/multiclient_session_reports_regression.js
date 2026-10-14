'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

process.env.FEISHU_LEADS_TABLE_ID='leads';
process.env.FEISHU_PROJECTS_TABLE_ID='projects';
process.env.FEISHU_BASE_APP_TOKEN='test-app';

const source=require('../src/services/feishu');
const delivery=require('../src/services/delivery-package-store');
const payments=require('../src/services/payment-store');
source.getTenantAccessToken=async()=> 'test-readonly-token';

const owned=[
  ['GG-202609-0001','GG-P-202609-709405','2026-09-03T12:00:00+08:00'],
  ['GG-202609-0003','GG-P-202609-830529','2026-09-07T12:00:00+08:00'],
  ['GG-202609-0004','GG-P-202609-977636','2026-09-09T12:00:00+08:00']
];
const leads=owned.map(([client,project,time])=>({fields:{
  '客户编号':client,'项目编号':project,'品牌名称':'GeoGi',
  '联系方式':'13800000001','提交时间':time,'当前状态':'诊断分析中'
}}));
leads.push({fields:{
  '客户编号':'GG-202609-0002',
  '项目编号':'GG-P-OTHER',
  '品牌名称':'GeoGi','联系方式':'13800000002',
  '提交时间':'2026-09-10T12:00:00+08:00'
}});
const projects=leads.map(record=>({fields:{
  '客户编号':record.fields['客户编号'],
  '项目编号':record.fields['项目编号'],
  '品牌名称':record.fields['品牌名称'],'当前阶段':'DIAGNOSIS'
}}));
source.listBitableRecords=async ({tableId})=>{
  if(tableId==='leads')return leads;
  if(tableId==='projects')return projects;
  throw Error('wrong_fake_table');
};
delivery.findDeliveryPackage=async()=>null;
payments.findPaymentByProject=async()=>null;

const {listOwnedClientIds,resolveOwnedClientId}=require('../src/services/customer-session');
const {listCustomerProjects}=require('../src/services/customer-portal');

(async()=>{
  const list=await listOwnedClientIds('13800000001');
  assert.deepStrictEqual(list,[
    'GG-202609-0004','GG-202609-0003','GG-202609-0001'
  ]);
  assert.strictEqual(await resolveOwnedClientId({phoneNumber:'13800000001'}),
    'GG-202609-0004');
  assert.strictEqual(await resolveOwnedClientId({
    phoneNumber:'13800000001',requestedClientId:'GG-202609-0001'
  }),'GG-202609-0001');
  assert.strictEqual(await resolveOwnedClientId({
    phoneNumber:'13800000001',requestedClientId:'GG-202609-0002'
  }),'');
  assert.deepStrictEqual(await listOwnedClientIds('13800000003'),[]);
  const result=await listCustomerProjects({clientIds:list});
  assert(result.ok);
  assert.strictEqual(result.clientId,'GG-202609-0004');
  assert.strictEqual(result.orders.length,3);
  assert.deepStrictEqual(
    new Set(result.orders.map(x=>x.projectId)),
    new Set(owned.map(x=>x[1]))
  );
  assert(!result.orders.some(x=>x.clientId==='GG-202609-0002'));
  assert(result.orders.every(x=>x.reportReady===false));
  // A query parameter may narrow down owned records, never broaden them.
  const scoped=await listCustomerProjects({clientIds:[list[2]]});
  assert.deepStrictEqual(scoped.orders.map(x=>x.clientId),['GG-202609-0001']);

  const route=fs.readFileSync(path.join(__dirname,'../src/server.js'),'utf8');
  assert(route.includes("const owned = await listOwnedClientIds(req.customerSession.phoneNumber)"));
  assert(route.includes("owned.includes(requested) ? [requested] : []"));
  assert(route.includes("listCustomerProjects({ clientIds })"));
  console.log('MULTIPLE OWNED GEOGI SUBMISSIONS AND REPORTS: OK');
})().catch(e=>{console.error(e);process.exitCode=1});
