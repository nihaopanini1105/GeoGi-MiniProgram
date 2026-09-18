const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'customer-portal.js'),
  'utf8'
);

const required = [
  'findDeliveryPackage',
  'projectDeliveryForCustomer',
  "reportReady: false",
  "deliveryMode: 'artifact_only'",
  "productionAuthority: 'geogi_os_m09'",
  "GeoGi OS 正在基于受治理证据形成诊断结论",
  "报告已由 GeoGi OS 正式发布"
];

const forbidden = [
  'buildDimensions(',
  'buildConclusion(',
  'buildPlatforms(',
  'keyFindings',
  'recommendations',
  'overallScore',
  'scoreStatus',
  'evidenceCount',
  'FEISHU_ANALYSIS_TABLE_ID',
  'FEISHU_TEST_RECORDS_TABLE_ID',
  'FEISHU_REPORTS_TABLE_ID'
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

assert(!source.includes('display_summary'));
if (failed) process.exit(1);
console.log('CUSTOMER PORTAL DISPLAY-ONLY GATING: OK');
