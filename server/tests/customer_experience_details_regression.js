const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const { sanitizeForm } = require('../src/services/os-intake');
const {
  canCustomerSupplement,
  buildCustomerResultNotifications
} = require('../src/services/customer-portal');

function run() {
  const diagnosisJs = read('pages/diagnosis/diagnosis.js');
  const diagnosis = read('pages/diagnosis/diagnosis.wxml');
  const appConfig = read('app.json');
  const home = read('pages/index/index.wxml');
  const mine = read('pages/mine/mine.wxml');
  const report = read('pages/report-detail/report-detail.wxml');

  assert(diagnosisJs.includes("'金融与保险'"));
  assert(diagnosisJs.includes("'保险公司'"));
  assert(diagnosisJs.includes("'保险经纪/代理'"));
  assert(diagnosisJs.includes("'汽车与出行'"));
  assert(diagnosisJs.includes("'制造与工业'"));
  assert(diagnosisJs.includes("'专业服务'"));

  assert(!diagnosisJs.includes('最多填写 3 个竞品'));
  assert(!diagnosis.includes('选填 · 最多3个'));
  assert(diagnosis.includes('选填 · 可填写多个'));
  assert(diagnosis.includes('maxlength="-1"'));

  const longCompetitors = Array.from({ length: 80 }, (_, index) => '竞品' + index).join('、');
  const sanitized = sanitizeForm({ competitors: longCompetitors });
  assert.strictEqual(sanitized.competitors, longCompetitors);

  assert(appConfig.includes('"text": "我的"'));
  assert(!appConfig.includes('"text": "报告"'));
  assert(home.includes('199元获取一次品牌 GEO诊断'));
  assert(mine.includes('结果提醒'));
  assert(mine.includes('退款结果、诊断报告完成等重要状态会在这里更新'));
  assert(report.includes('wx:if="{{order.canSupplement}}"'));

  assert.strictEqual(canCustomerSupplement({ status: 'paid' }, false), true);
  assert.strictEqual(canCustomerSupplement({ status: 'refund_processing' }, false), false);
  assert.strictEqual(canCustomerSupplement({ status: 'refunded' }, false), false);
  assert.strictEqual(canCustomerSupplement({ status: 'paid' }, true), false);

  const reportNotifications = buildCustomerResultNotifications({
    clientId: 'GG-1',
    projectId: 'GG-P-1',
    brandName: '测试品牌',
    reportReady: true,
    deliveryPackageId: 'delivery-1',
    completedAt: '2026-09-24T08:00:00+08:00',
    paymentStatus: 'paid',
    payment: { status: 'paid', refunds: [] }
  });
  assert(reportNotifications.some((item) => item.type === 'report_ready'));

  const refundNotifications = buildCustomerResultNotifications({
    clientId: 'GG-1',
    projectId: 'GG-P-2',
    brandName: '测试品牌',
    reportReady: false,
    paymentStatus: 'refunded',
    payment: {
      status: 'refunded',
      updatedAt: '2026-09-24T08:10:00+08:00',
      refunds: [{
        refundId: 'refund-1',
        outRefundNo: 'R1',
        status: 'success',
        successAt: '2026-09-24T08:10:00+08:00'
      }]
    }
  });
  assert(refundNotifications.some((item) => item.type === 'refund_completed'));

  console.log('customer-experience-details-regression-ok');
}

run();
