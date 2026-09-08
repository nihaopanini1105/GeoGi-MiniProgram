'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.join(ROOT, 'server');

const forbiddenPaths = [
  'src/services/diagnosis.js',
  'src/services/diagnosis-engine.js',
  'src/services/workflow-command.js',
  'src/services/report-pdf.js',
  'src/services/report-release-gate.js',
  'src/services/ai-share-extractor.js',
  'src/scripts/import-os-result.js',
  'src/scripts/render-report-pdf.py',
  'src/scripts/report-release.js',
  'src/scripts/run-workflow-command.js',
  'src/scripts/setup-diagnosis-workbench.js'
];

const forbiddenServerTokens = [
  "require('./services/diagnosis')",
  "require('./services/diagnosis-engine')",
  "require('./services/workflow-command')",
  "require('./services/report-pdf')",
  "require('./services/report-release-gate')",
  '/api/feishu/command',
  '/api/feishu/events'
];

function fail(code, detail = '') {
  console.error(`${code}${detail ? `:${detail}` : ''}`);
  process.exit(1);
}

for (const relative of forbiddenPaths) {
  if (fs.existsSync(path.join(SERVER, relative))) fail('FORBIDDEN_MINIPROGRAM_AUTHORITY_FILE', relative);
}

const serverText = fs.readFileSync(path.join(SERVER, 'src/server.js'), 'utf8');
for (const token of forbiddenServerTokens) {
  if (serverText.includes(token)) fail('FORBIDDEN_MINIPROGRAM_SERVER_AUTHORITY', token);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8'));
const scripts = packageJson.scripts || {};
for (const key of Object.keys(scripts)) {
  if (/workflow:command|os:import-result|report:qa|report:publish/i.test(key)) {
    fail('FORBIDDEN_MINIPROGRAM_SCRIPT', key);
  }
}

const portalText = fs.readFileSync(path.join(SERVER, 'src/services/customer-portal.js'), 'utf8');
for (const token of ['FEISHU_ANALYSIS_TABLE_ID', 'FEISHU_TEST_RECORDS_TABLE_ID', 'buildDimensions(', 'buildPlatforms(', 'sourceScore(']) {
  if (portalText.includes(token)) fail('CUSTOMER_PORTAL_RECOMPUTES_OS_INTELLIGENCE', token);
}

const intakeText = fs.readFileSync(path.join(SERVER, 'src/services/customer-intake.js'), 'utf8');
for (const token of ['generate_assets', 'generate_report', 'buildAnalysisRecord', 'buildReportFields']) {
  if (intakeText.includes(token)) fail('CUSTOMER_INTAKE_RECOMPUTES_OS_INTELLIGENCE', token);
}

console.log('MINIPROGRAM_AUTHORITY_BOUNDARY_OK=True');
