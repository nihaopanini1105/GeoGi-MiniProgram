'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const os=require('os');
const path=require('path');
const vm=require('node:vm');
const {
  issuePdfTicket,consumePdfTicket,readVerifiedPdfArtifact
}=require('../src/services/pdf-reader-ticket');

function assertPublicUploadBoundary(serverSource) {
  const start=serverSource.indexOf("app.use('/uploads', (req, res, next) => {");
  const end=serverSource.indexOf("app.use('/uploads', express.static",start);
  assert(start >= 0 && end > start, 'the upload guard must precede static serving');

  // Register the real middleware without importing the server or starting a listener.
  let guard;
  vm.runInNewContext(serverSource.slice(start,end),{
    path,
    app:{use(route, handler) {
      assert.strictEqual(route,'/uploads');
      guard=handler;
    }}
  },{filename:'server.js:/uploads'});
  assert.strictEqual(typeof guard,'function');

  const id='0123456789abcdef';
  const cases=[
    ['/GeoGi-V2-'+id+'.pdf',404],
    ['/GeoGi-V21-'+id+'.pdf',404],
    ['/nested/GeoGi-V21-'+id+'.PDF',404],
    ['/nested/../GeoGi-V2-'+id+'.pdf',404],
    ['/nested%2fGeoGi-V2-'+id+'.pdf',404],
    ['/GeoGi-V2-'+id+'%252Epdf',404],
    ['/artifact.htm',404],
    ['/ordinary-document.pdf','next'],
    ['/%bad',400]
  ];
  for (const [url, expected] of cases) {
    const outcomes=[];
    const response={
      status(code) { outcomes.push(code); return this; },
      json() { return this; }
    };
    guard({path:url,url},response,()=>outcomes.push('next'));
    assert.deepStrictEqual(outcomes,[expected],url);
  }
}

const root=fs.mkdtempSync(path.join(os.tmpdir(),'geogi-v2-pdf-ticket-'));
try {
  // Synthetic fixture only exercises private transport; NOT PDF rendering.
  const source=Buffer.concat([Buffer.from('%PDF-1.7\n','ascii'),Buffer.alloc(12500,32)]);
  const filename='GeoGi-V2-test.pdf';
  const file=path.join(root,filename);
  fs.writeFileSync(file,source);
  const sha=crypto.createHash('sha256').update(source).digest('hex');
  const ticket=issuePdfTicket({
    clientId:'GG-GEOGI-PILOT',projectId:'GG-P-GEOGI-PILOT',sha256:sha,fileName:filename
  });
  const claim=consumePdfTicket(ticket);
  assert.strictEqual(claim.clientId,'GG-GEOGI-PILOT');
  assert.deepStrictEqual(readVerifiedPdfArtifact(root,filename,sha),source);
  assert.throws(()=>consumePdfTicket(ticket),/PDF_TICKET_EXPIRED/);
  assert.throws(()=>readVerifiedPdfArtifact(root,filename,'f'.repeat(64)),/INTEGRITY/);
  assert.throws(()=>readVerifiedPdfArtifact(root,'../escape.pdf',sha),/INVALID/);
  assert.throws(()=>issuePdfTicket({
    clientId:'client',projectId:'project',sha256:'wrong',fileName:filename
  }),/SCOPE_INVALID/);
  const serverSource=fs.readFileSync(path.join(__dirname,'../src/server.js'),'utf8');
  assertPublicUploadBoundary(serverSource);
  assert(!serverSource.includes("name.endsWith('.pdf')"));
  assert(serverSource.includes("app.post('/api/customer/reports/:projectId/pdf-ticket', requireCustomerSession"));
  assert(serverSource.includes("app.get('/api/customer/pdf-reader/:ticket'"));
  assert(serverSource.includes("app.post('/internal/os/report-v2/verify-customer-access',requireOsBridge"));
  assert(serverSource.includes("app.post('/internal/os/report-v2/revoke',requireOsBridge"));
  assert(serverSource.includes("app.post('/internal/os/report-v2/verify-pilot-binding',requireOsBridge"));
  const bridge=fs.readFileSync(path.join(__dirname,'../src/services/report-v2-bridge-operations.js'),'utf8');
  assert(bridge.includes("listOsIntakes()"));
  assert(bridge.includes("GEOGI_V2_EXACT_PILOT_ENABLED"));
  assert(bridge.includes("x.project.clientId===expectedClient"));
  assert(bridge.includes("x.project.projectId===expectedProject"));
  console.log('V2 CUSTOMER PDF TICKET + SECURE PRIVATE ACCESS CONTRACT: OK');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
