'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const net=require('net');
const {spawn}=require('child_process');
const {packageV2}=require('./report_v2_bridge_regression');
const {importDeliveryPackage}=require('../src/services/delivery-package-store');

async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-v2-http-'));
  const prev=process.env.GEOGI_DELIVERY_PACKAGE_ROOT;
  process.env.GEOGI_DELIVERY_PACKAGE_ROOT=root;
  const pkg=packageV2();
  await importDeliveryPackage(pkg);
  const port=await freePort();
  const env={...process.env,GEOGI_DELIVERY_PACKAGE_ROOT:root,
    GEOGI_OS_BRIDGE_TOKEN:'v2-http-test-only-secret',PORT:String(port),HOST:'127.0.0.1'};
  const server=spawn(process.execPath,['src/server.js'],{cwd:path.join(__dirname,'..'),env,stdio:'pipe'});
  let stderr='';
  server.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const base='http://127.0.0.1:'+port;
  const bearer={authorization:'Bearer '+env.GEOGI_OS_BRIDGE_TOKEN};
  const args={delivery_package_id:pkg.delivery_package_id,
    project_id:pkg.project_id,client_id:pkg.client_id,
    artifact_sha256:pkg.artifacts[0].sha256,reason:'http acceptance'};
  const json=async(url,options={})=>{
    const response=await fetch(base+url,{...options,signal:AbortSignal.timeout(5000)});
    return {status:response.status,body:await response.json()};
  };
  try {
    let ready=false;
    for(let i=0;i<65;i++) {
      if(server.exitCode!==null) throw Error('Bridge server exited: '+stderr);
      try {const response=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}} catch (_) {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready,'Bridge server not ready: '+stderr);
    const unauth=await json('/internal/os/report-v2/capabilities');
    assert.strictEqual(unauth.status,401);
    const cap=await json('/internal/os/report-v2/capabilities',{headers:bearer});
    assert.strictEqual(cap.status,200);
    assert.strictEqual(cap.body.result.release_authority,'geo_diagnostic_html_release_v2');
    const unauthorized=await json('/internal/os/report-v2/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});
    assert.strictEqual(unauthorized.status,401);
    const revoked=await json('/internal/os/report-v2/revoke',{method:'POST',
      headers:{...bearer,'content-type':'application/json'},body:JSON.stringify(args)});
    assert.strictEqual(revoked.status,200);
    assert.strictEqual(revoked.body.result.status,'revoked');
    const verify=await json('/internal/os/report-v2/verify-customer-access',{method:'POST',
      headers:{...bearer,'content-type':'application/json'},body:JSON.stringify(args)});
    assert.strictEqual(verify.status,200);
    assert.strictEqual(verify.body.result.accessible,false);
    assert.strictEqual(verify.body.result.delivery_package_id,pkg.delivery_package_id);
    const publicHtml=await fetch(base+'/uploads/'+pkg.artifacts[0].file_name);
    assert.strictEqual(publicHtml.status,404);
    console.log('Bridge HTTP authentication/capability/revoke/verification/public HTML denial passed');
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve=>server.once('exit',resolve));
    if(prev===undefined)delete process.env.GEOGI_DELIVERY_PACKAGE_ROOT;
    else process.env.GEOGI_DELIVERY_PACKAGE_ROOT=prev;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
