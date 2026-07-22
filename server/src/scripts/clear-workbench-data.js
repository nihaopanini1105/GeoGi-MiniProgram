require('dotenv').config();

const {
  getTenantAccessToken,
  listBitableRecords,
  deleteBitableRecord
} = require('../services/feishu');

const tables = [
  ['客户与品牌', 'FEISHU_LEADS_TABLE_ID'],
  ['诊断项目', 'FEISHU_PROJECTS_TABLE_ID'],
  ['品牌基础档案', 'FEISHU_BRAND_PROFILE_TABLE_ID'],
  ['全网信源', 'FEISHU_SOURCES_TABLE_ID'],
  ['品牌关键词', 'FEISHU_KEYWORDS_TABLE_ID'],
  ['行业热门问题', 'FEISHU_QUESTIONS_TABLE_ID'],
  ['AI 检测问题', 'FEISHU_AI_QUESTION_TABLE_ID'],
  ['平台测试记录', 'FEISHU_TEST_RECORDS_TABLE_ID'],
  ['回答分析结果', 'FEISHU_ANALYSIS_TABLE_ID'],
  ['报告管理', 'FEISHU_REPORTS_TABLE_ID']
];

async function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('清空诊断工作台需要加 --confirm');
  }

  const tenantToken = await getTenantAccessToken();
  const result = [];

  for (const [name, envKey] of tables) {
    const tableId = process.env[envKey];
    if (!tableId) {
      result.push({ table: name, status: '未配置表ID', deleted: 0 });
      continue;
    }

    const records = await listBitableRecords({
      tenantToken,
      appToken: process.env.FEISHU_BASE_APP_TOKEN,
      tableId,
      pageSize: 100
    });

    let deleted = 0;
    for (const record of records) {
      await deleteBitableRecord({
        tenantToken,
        appToken: process.env.FEISHU_BASE_APP_TOKEN,
        tableId,
        recordId: record.record_id
      });
      deleted += 1;
    }

    result.push({ table: name, status: '已清空', deleted });
  }

  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
