'use strict';
// TEST-ONLY isolated Node core HTTP adapter to exercise the actual MiniProgram
// V2.1 domain and artifact ingress functions. Not production Express routing.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {createV21Bridge}=require('../src/services/report-v21-bridge-operations');
const {admitOsArtifact}=require('../src/services/os-artifact-ingress');
const root=process.env.GEOGI_HTTP_TEST_ROOT;
if (!root) throw new Error('TEST_ROOT_REQUIRED');
const c='client_http_v21', p='project_http_v21', token='synthetic_loopback_bridge_only';
const lead={clientId:c,projectId:p,project:{clientId:c,projectId:p}};
let payment={clientId:c,projectId:p,status:'paid',paidAt:'2026-10-20T00:00:00Z'};
const bridge=createV21Bridge({findIntakes:async()=>[lead],findPayment:async()=>payment,
    uploadRoot:path.join(root,'uploads'), dataRoot:path.join(root,'private')});
const jsonOut=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
  try {
    const chunks=[];let bytes=0;
    for await (const b of req){ bytes+=b.length; if(bytes>25*1024*1024) throw Error('LIMIT');chunks.push(b);}
    const body=Buffer.concat(chunks);
    if(req.headers.authorization!=='Bearer '+token) return jsonOut(res,401,{ok:false,error:'BRIDGE_UNAUTHORIZED'});
    let input={};if(body.length&&req.headers['content-type']!=='application/octet-stream')input=JSON.parse(body.toString('utf8'));
    const route=req.method+' '+req.url;
    let output;
    switch(route){
    case 'GET /internal/os/report-v21/capabilities':output=bridge.capabilities();break;
    case 'POST /internal/os/report-v21/verify-customer-binding':output=await bridge.binding(input.client_id,input.project_id);break;
    case 'POST /internal/os/artifacts':output=admitOsArtifact({body,fileName:req.headers['x-geogi-artifact-filename'],expectedSha256:req.headers['x-geogi-artifact-sha256'],expectedSize:req.headers['x-geogi-artifact-size'],mimeType:req.headers['x-geogi-artifact-mime-type']});break;
    case 'POST /internal/os/delivery-packages':output=await bridge.publish(input);break;
    case 'POST /internal/os/report-v21/verify-customer-access':output=await bridge.accessible(input);break;
    case 'POST /internal/os/report-v21/revoke':output=await bridge.revoke(input);break;
    case 'POST /test-only/refund':payment={...payment,status:'refunded'};output={status:'refunded'};break;
    default:return jsonOut(res,404,{ok:false,error:'NOT_FOUND'});
    }
    return jsonOut(res,200,{ok:true,result:output});
  }catch(e){return jsonOut(res,409,{ok:false,error:e.code||'TEST_DOMAIN_ERROR'});}
});
server.listen(0,'127.0.0.1',()=>process.stdout.write('LOOPBACK_PORT='+server.address().port+'\n'));