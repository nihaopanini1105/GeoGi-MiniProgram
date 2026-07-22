require('dotenv').config();

const { runWorkflowCommand } = require('../services/workflow-command');

async function main() {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    throw new Error('请输入工作流指令，例如：开始品牌信息补齐和问题生成 项目编号 GG-P-202607-123456');
  }

  const result = await runWorkflowCommand({ text });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
