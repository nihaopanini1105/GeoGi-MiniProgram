const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { issueH5Ticket, consumeH5Ticket, readVerifiedH5Artifact } = require('../src/services/h5-reader-ticket');

const root = fs.mkdtempSync(path.join(os.tmpdir(),'geogi-h5-ticket-'));
const payload = Buffer.from('<!doctype html><html lang="zh-CN"><body>private report</body></html>');
const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
fs.writeFileSync(path.join(root, 'report.html'), payload);

const ticket = issueH5Ticket({clientId:'client-a',projectId:'project-a',sha256,fileName:'report.html'});
assert.match(ticket,/^[a-f0-9]{64}$/);
assert.strictEqual(consumeH5Ticket(ticket).clientId,'client-a');
assert.throws(()=>consumeH5Ticket(ticket),/H5_TICKET_INVALID/);
assert.deepStrictEqual(readVerifiedH5Artifact(root,'report.html',sha256),payload);
assert.throws(()=>readVerifiedH5Artifact(root,'../secret.html',sha256),/H5_ARTIFACT_INVALID/);
assert.throws(()=>readVerifiedH5Artifact(root,'report.html','a'.repeat(64)),/H5_ARTIFACT_INTEGRITY_FAILURE/);
const link=path.join(root,'linked.html');
fs.symlinkSync(path.join(root,'report.html'),link);
assert.throws(()=>readVerifiedH5Artifact(root,'linked.html',sha256),/H5_ARTIFACT_INVALID/);

const backend = fs.readFileSync(path.join(__dirname,'../src/server.js'),'utf8');
const page = fs.readFileSync(path.join(__dirname,'../../pages/report-detail/report-detail.js'),'utf8');
assert(backend.includes("app.post('/api/customer/reports/:projectId/h5-ticket', requireCustomerSession"));
assert(backend.includes("app.get('/api/customer/h5-reader/:ticket'"));
assert(backend.includes("report.artifactSha256 !== ticket.sha256"));
const { isProtectedReportUploadPath } = require('../src/services/private-report-upload-guard');
assert(backend.includes('isProtectedReportUploadPath(req.path)'));
assert.strictEqual(isProtectedReportUploadPath('/doc.html'),true);
assert.strictEqual(isProtectedReportUploadPath('/foo/../GeoGi-V21-0123456789abcdef.pdf'),true);
assert.strictEqual(isProtectedReportUploadPath('/ordinary-attachment.pdf'),false);
assert(page.includes("'/pages/h5-report/h5-report?src='"));
console.log('H5_READER_TICKET_SECURITY_PASS');
