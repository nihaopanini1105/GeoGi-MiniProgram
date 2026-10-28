'use strict';
// TEST ONLY. Runs the actual production Express routes against synthetic CRM,
// payment and signed release approval records in a private disposable directory.
// No Feishu, WeChat, A01 or production connection is made.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=process.env.GEOGI_R03_HTTP_TEST_ROOT;
if(!root || !path.isAbsolute(root))throw Error('PRIVATE_TEST_ROOT_REQUIRED');
const configFile=path.join(root,'fixture.json');
const config=()=>JSON.parse(fs.readFileSync(configFile,'utf8'));
const initial=config();
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const key=crypto.randomBytes(48);
const keyPath=path.join(root,'grant.key'),grantPath=path.join(root,'grants.json');
fs.writeFileSync(keyPath,key,{mode:0o600});
const grant={...initial.grant};
grant.signature=crypto.createHmac('sha256',key).update(JSON.stringify(canonical(grant))).digest('hex');
fs.writeFileSync(grantPath,JSON.stringify({contract:'r03-release-grants/1',grants:[grant]}),{mode:0o600});
Object.assign(process.env,{
  GEOGI_R03_REPORT_PUBLISH_ENABLED:'true',GEOGI_REPORT_V21_PUBLISH_ENABLED:'true',
  GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED:'true',
  GEOGI_R03_RELEASE_GRANTS_FILE:grantPath,GEOGI_R03_RELEASE_GRANT_KEY_FILE:keyPath,
  GEOGI_REPORT_R03_PRIVATE_ROOT:path.join(root,'private-r03'),
  GEOGI_REPORT_V21_PRIVATE_ROOT:path.join(root,'private-v21'),
  UPLOAD_DIR:path.join(root,'uploads'),PUBLIC_UPLOAD_BASE_URL:'https://artifacts.synthetic.invalid',
  GEOGI_OS_BRIDGE_TOKEN:'synthetic-r03-loopback-bridge-only',
  CUSTOMER_SESSION_SECRET:'synthetic-r03-session-secret-loopback-only',
  FEISHU_LEADS_TABLE_ID:'synthetic-leads',FEISHU_PROJECTS_TABLE_ID:'synthetic-projects',
  FEISHU_BASE_APP_TOKEN:'synthetic-never-connected'
});
const crm=require('../src/services/os-operations-bridge');
crm.listOsIntakes=async()=>{
  const cfg=config();return cfg.duplicate_crm ? [lead(),lead()] : [lead()];
};
function lead(){return {clientId:initial.client_id,projectId:initial.project_id,
  project:{clientId:initial.client_id,projectId:initial.project_id}};}
require('../src/services/payment-store').findPaymentByProject=async project=>({
  clientId:initial.client_id,projectId:project,status:config().payment_status||'paid',
  paidAt:'2026-10-28T00:00:00Z',transactionId:'synthetic-not-real-payment'
});
const feishu=require('../src/services/feishu');
feishu.getTenantAccessToken=async()=> 'synthetic-no-network';
feishu.listBitableRecords=async({tableId})=>tableId==='synthetic-leads' ? [
  {fields:{'客户编号':initial.client_id,'项目编号':initial.project_id,'联系方式':'13800000001'}},
  {fields:{'客户编号':'client_other_r03','项目编号':'project_other_r03','联系方式':'13800000002'}}
] : [{fields:{'客户编号':initial.client_id,'项目编号':initial.project_id}}];
const session=require('../src/services/customer-session');
const app=require('../src/server');
const server=app.listen(0,'127.0.0.1',()=>{
  process.stdout.write(JSON.stringify({port:server.address().port,synthetic_only:true,
    client_token:session.createCustomerToken('13800000001').customerToken,
    other_token:session.createCustomerToken('13800000002').customerToken,
    bridge_token:process.env.GEOGI_OS_BRIDGE_TOKEN})+'\n');
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
