const assert = require('assert');

const {
  mapCustomerStatus,
  customerNextAction,
  buildPendingReport
} = require('../src/services/customer-portal');

function run() {
  assert.strictEqual(
    mapCustomerStatus({ projectStage: 'PAYMENT_PENDING', leadStatus: '待支付', paymentStatus: '待支付', paymentRequired: true }),
    '待支付'
  );
  assert.strictEqual(
    mapCustomerStatus({ projectStage: 'INTAKE', leadStatus: '已付款', paymentStatus: '已支付', paymentRequired: true }),
    '已付款'
  );
  assert.strictEqual(mapCustomerStatus({ projectStage: 'REFUNDED', leadStatus: '已退款' }), '已退款');
  assert.strictEqual(customerNextAction('待支付'), '完成 199 元微信支付后，GeoGi 将开始品牌 GEO 诊断。');

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
    order: {
      status: '效果复测中',
      nextAction: 'GeoGi OS 正在按同口径执行效果复测与结果评估。',
      updatedAt: '2026-09-11T10:00:00+08:00'
    }
  });
  assert.strictEqual(pending.status, '效果复测中');
  assert.strictEqual(pending.reportReady, false);
  assert.strictEqual(pending.reportLink, '');
  assert.strictEqual(pending.deliveryMode, 'artifact_only');
  assert.strictEqual(pending.productionAuthority, 'geogi_os');
  for (const forbidden of ['overallScore','scoreStatus','summary','conclusion','dimensions','platforms','keyFindings','recommendations','limitations','risks','scope','evidenceCount']) {
    assert(!Object.prototype.hasOwnProperty.call(pending, forbidden), `pending view must not expose local report field: ${forbidden}`);
  }

  console.log('customer-portal-status-regression-ok');
}

run();
