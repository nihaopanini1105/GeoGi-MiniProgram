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

const ticket = issueH5Ticket({
  clientId:'client-a',projectId:'project-a',deliveryPackageId:'delivery-package-v2-001',
  sha256,fileName:'report.html'
});
assert.throws(()=>issueH5Ticket({clientId:'client-a',projectId:'project-a',
  sha256,fileName:'report.html'}),/H5_TICKET_SCOPE_INVALID/);
const releaseSwap=issueH5Ticket({clientId:'client-a',projectId:'project-a',
  deliveryPackageId:'delivery-package-v2-002',sha256,fileName:'report.html'});
assert.strictEqual(consumeH5Ticket(releaseSwap).deliveryPackageId,'delivery-package-v2-002');
assert.match(ticket,/^[a-f0-9]{64}$/);
const consumed=consumeH5Ticket(ticket);
assert.strictEqual(consumed.clientId,'client-a');
assert.strictEqual(consumed.deliveryPackageId,'delivery-package-v2-001');
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
assert(backend.includes("report.deliveryPackageId !== ticket.deliveryPackageId"));
assert(backend.includes("deliveryPackageId: report.deliveryPackageId"));
assert(backend.includes("name.endsWith('.html')"));
assert(page.includes("'/pages/h5-report/h5-report?src='"));
console.log('H5_READER_TICKET_SECURITY_PASS');
