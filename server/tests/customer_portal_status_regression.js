const assert = require('assert');

const {
  mapCustomerStatus,
  customerNextAction,
  buildPendingReport
} = require('../src/services/customer-portal');

function fakeRecord(fields) {
  return { fields };
}

function run() {
  const stageExpectations = [
    ['ONBOARDING', '资料建档中'],
    ['DETECTION', '检测进行中'],
    ['DIAGNOSIS', '诊断分析中'],
    ['SOLUTION', '方案生成中'],
    ['IMPLEMENTATION', '优化实施中'],
    ['RETEST', '效果复测中'],
    ['REVIEW', '报告审核中'],
    ['MONITORING', '持续运营中'],
    ['BLOCKED', '资料待补充']
  ];
  for (const [stage, expected] of stageExpectations) {
    assert.strictEqual(mapCustomerStatus({ projectStage: stage, leadStatus: '' }), expected, stage);
    assert(customerNextAction(expected), `missing customer action for ${expected}`);
  }

  const pending = buildPendingReport({
    lead: fakeRecord({
      品牌名称: '测试品牌',
      一级行业: '旅行',
      细分业务: '酒店',
      提交时间: '2026-09-11T10:00:00+08:00'
    }),
    project: fakeRecord({ 品牌名称: '测试品牌' }),
    order: {
      status: '效果复测中',
      nextAction: 'GeoGi OS 正在按同口径执行效果复测与结果评估。',
      updatedAt: '2026-09-11T10:00:00+08:00'
    }
  });
  assert.strictEqual(pending.overallScore, null);
  assert.strictEqual(pending.evidenceCount, 0);
  assert.deepStrictEqual(pending.limitations, []);
  assert.deepStrictEqual(pending.risks, []);
  assert(pending.scoreStatus.includes('正式报告尚未发布'));
  assert.strictEqual(pending.status, '效果复测中');

  console.log('customer-portal-status-regression-ok');
}

run();
