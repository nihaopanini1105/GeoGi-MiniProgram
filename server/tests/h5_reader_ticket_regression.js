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
const clockNow = Date.now;
const expiring = issueH5Ticket({clientId:'client-a',projectId:'project-a',sha256,fileName:'report.html',deliveryPackageId:'package-a'});
try { Date.now = () => clockNow() + 61000; assert.throws(() => consumeH5Ticket(expiring), /H5_TICKET_INVALID/); }
finally { Date.now = clockNow; }
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
assert(backend.includes("name.endsWith('.html')"));
assert(page.includes("'/pages/h5-report/h5-report?src='"));
console.log('H5_READER_TICKET_SECURITY_PASS');

// Execute the actual reader route against changing current delivery state.
// Identical bytes in a newer package must not revive an older ticket.
const vm = require('vm');
const start = backend.indexOf("app.get('/api/customer/h5-reader/:ticket'");
const end = backend.indexOf("app.post('/api/customer/projects/", start);
let handler;
let currentReport;
vm.runInNewContext(backend.slice(start, end), {
  app: { get: (_route, callback) => { handler = callback; } },
  consumeH5Ticket,
  getCustomerReport: async () => ({ ok: true, report: currentReport }),
  readVerifiedH5Artifact,
  getUploadRoot: () => root
});
(async () => {
  const valid = { reportReady: true, artifactType: 'h5', artifactMimeType: 'text/html',
    artifactSha256: sha256, artifactFileName: 'report.html', deliveryPackageId: 'package-a' };
  for (const [report, expectedStatus] of [
    [valid, 200],
    [{ ...valid, deliveryPackageId: 'package-b' }, 404],
    [{ ...valid, reportReady: false }, 404],
    [{ ...valid, artifactSha256: 'b'.repeat(64) }, 404]
  ]) {
    currentReport = report;
    const token = issueH5Ticket({ clientId: 'client-a', projectId: 'project-a', sha256,
      fileName: 'report.html', deliveryPackageId: 'package-a' });
    const response = { setHeader() {}, status(code) { this.code = code; return this; },
      type() { return this; }, send(body) { this.body = body; return this; } };
    await handler({ params: { ticket: token } }, response);
    assert.strictEqual(response.code, expectedStatus);
    if (expectedStatus === 200) assert.deepStrictEqual(response.body, payload);
    assert.throws(() => consumeH5Ticket(token), /H5_TICKET_INVALID/);
  }
  console.log('H5_READER_CURRENT_PACKAGE_AND_ACCESS_RECHECK_PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
