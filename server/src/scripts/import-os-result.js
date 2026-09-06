'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { runWorkflowCommand } = require('../services/workflow-command');

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    throw new Error('请提供 GeoGi OS Result Adapter JSON 文件路径');
  }

  const inputPath = path.resolve(inputArg);
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (payload.adapterType !== 'geogi_customer_delivery_v1_result_adapter') {
    throw new Error('不是受支持的 GeoGi Customer Delivery V1 Result Adapter 文件');
  }

  const projectId = String(payload.projectId || '').trim();
  const aiConversations = Array.isArray(payload.aiConversations) ? payload.aiConversations : [];
  if (!/^GG-P-\d{6}-\d{6}$/.test(projectId)) {
    throw new Error(`结果文件缺少有效项目编号：${projectId || '(empty)'}`);
  }
  if (!aiConversations.length) {
    throw new Error('结果文件没有可用于报告生成的 OS AI conversations');
  }

  const result = await runWorkflowCommand({
    action: 'generate_report',
    projectId,
    aiConversations
  });

  console.log(JSON.stringify({
    ...result,
    sourceAdapterType: payload.adapterType,
    sourceTaskId: payload.sourceTaskId,
    importedConversationCount: aiConversations.length,
    excludedRunCount: payload.summary && payload.summary.excludedRunCount,
    shareLinkRereadRequired: false
  }, null, 2));

  if (!result || !result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
