'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {
  issuePdfTicket,consumePdfTicket,readVerifiedPdfArtifact
}=require('../src/services/pdf-reader-ticket');

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
  assert(serverSource.includes("name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.pdf')"));
  assert(serverSource.includes("app.post('/api/customer/reports/:projectId/pdf-ticket', requireCustomerSession"));
  assert(serverSource.includes("app.get('/api/customer/pdf-reader/:ticket'"));
  assert(serverSource.includes("app.post('/internal/os/report-v2/verify-customer-access',requireOsBridge"));
  assert(serverSource.includes("app.post('/internal/os/report-v2/revoke',requireOsBridge"));
  console.log('V2 CUSTOMER PDF TICKET + SECURE PRIVATE ACCESS CONTRACT: OK');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
