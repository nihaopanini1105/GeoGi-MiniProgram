'use strict';

require('dotenv').config();

const { evaluateReportRelease, publishReport } = require('../services/report-release-gate');

async function main() {
  const args = process.argv.slice(2);
  const projectId = args.find((arg) => /^GG-P-\d{6}-\d{6}$/.test(arg)) || '';
  const publish = args.includes('--publish');
  const confirmIndex = args.indexOf('--confirmed-by');
  const confirmedBy = confirmIndex >= 0 && args[confirmIndex + 1]
    ? args[confirmIndex + 1]
    : (process.env.DEFAULT_OWNER || 'GeoGi 负责人');

  if (!projectId) {
    throw new Error('请提供项目编号，例如：GG-P-202609-123456');
  }

  const result = publish
    ? await publishReport({ projectId, confirmedBy })
    : await evaluateReportRelease({ projectId });

  console.log(JSON.stringify(result, null, 2));
  if (publish && !result.published) process.exitCode = 1;
  if (!publish && !result.readyForH6) process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
