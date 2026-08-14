const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'customer-portal.js'),
  'utf8'
);

const required = [
  "const PUBLISHED_REPORT_STATUS = '已发布';",
  "const CONFIRMED_REVIEW_STATUS = '已确认';",
  'function isPublishedReport({ reportStatus, reviewStatus, reportLink })',
  'reportStatus === PUBLISHED_REPORT_STATUS',
  'reviewStatus === CONFIRMED_REVIEW_STATUS',
  '&& Boolean(reportLink)',
  'if (!order.reportReady)',
  'report: buildPendingReport({ lead, project, report, order })',
  "reportLink: reportReady ? rawReportLink : ''"
];

const forbidden = [
  "reportReady: Boolean(reportStatus && !reportStatus.includes('待补充'))"
];

let failed = false;
for (const item of required) {
  const ok = source.includes(item);
  console.log(`REQUIRED ${item}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}

for (const item of forbidden) {
  const ok = !source.includes(item);
  console.log(`FORBIDDEN ${item}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log('CUSTOMER REPORT GATING: OK');
