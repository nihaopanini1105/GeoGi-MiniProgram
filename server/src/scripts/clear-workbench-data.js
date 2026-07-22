require('dotenv').config();

const {
  getTenantAccessToken,
  listBitableRecords,
  deleteBitableRecord,
  deleteBitableRecords
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

    console.log(`${name}: 待删除 ${records.length} 条`);
    let deleted = 0;
    const chunks = chunk(records.map((record) => record.record_id), 500);

    for (const ids of chunks) {
      try {
        await deleteBitableRecords({
          tenantToken,
          appToken: process.env.FEISHU_BASE_APP_TOKEN,
          tableId,
          recordIds: ids
        });
      } catch (error) {
        console.log(`${name}: 批量删除失败，降级为逐条删除`);
        for (const id of ids) {
          try {
            await deleteBitableRecord({
              tenantToken,
              appToken: process.env.FEISHU_BASE_APP_TOKEN,
              tableId,
              recordId: id
            });
          } catch (singleError) {
            if (!String(singleError && singleError.message).includes('RecordIdNotFound')) {
              throw singleError;
            }
          }
        }
      }
      deleted += ids.length;
      console.log(`${name}: 已删除 ${deleted}/${records.length}`);
    }

    result.push({ table: name, status: '已清空', deleted });
  }

  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
