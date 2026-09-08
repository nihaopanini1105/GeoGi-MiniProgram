'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { buildOsIntakeHandoff } = require('../services/os-intake-export');

async function main() {
  const args = process.argv.slice(2);
  const projectId = args.find((arg) => /^GG-P-\d{6}-\d{6}$/.test(arg)) || '';
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 && args[outIndex + 1]
    ? path.resolve(args[outIndex + 1])
    : path.resolve(process.cwd(), `${projectId || 'geogi-project'}-os-intake-v2.json`);

  if (!projectId) throw new Error('请提供项目编号，例如：GG-P-202609-123456');

  const handoff = await buildOsIntakeHandoff({ projectId });
  fs.writeFileSync(outPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    projectId,
    outPath,
    handoffVersion: handoff.handoffVersion,
    containsDerivedIntelligence: handoff.authorityBoundary.containsDerivedIntelligence,
    downstreamAuthority: handoff.authorityBoundary.downstreamAuthority
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
