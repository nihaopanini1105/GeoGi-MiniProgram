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
  const homeJs = read('pages/index/index.js');
  const contactJs = read('pages/contact/contact.js');
  const mineJs = read('pages/mine/mine.js');
  const appConfig = read('app.json');
  const home = read('pages/index/index.wxml');
  const mine = read('pages/mine/mine.wxml');
  const mineConfig = read('pages/mine/mine.json');
  const report = read('pages/report-detail/report-detail.wxml');
  const appJs = read('app.js');
  const attributionJs = read('utils/attribution.js');
  const success = read('pages/submit-success/submit-success.wxml');

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
  assert(mineConfig.includes('"navigationBarTitleText": "我的"'));
  assert(!mine.includes('<strong>'));
  assert(!mine.includes('</strong>'));
  assert(mine.includes('MY GEOGI'));
  assert(mine.includes('结果提醒'));
  assert(mine.includes('退款结果、诊断报告完成等重要状态会在这里更新'));
  assert(report.includes('wx:if="{{order.canSupplement}}"'));
  assert(appJs.includes('captureAttribution'));
  assert(attributionJs.includes("ATTRIBUTION_KEY = 'geogi_source_attribution'"));
  assert(attributionJs.includes('/api/attribution/resolve'));
  assert(attributionJs.includes('tokenFromScene'));
  assert(diagnosis.includes('兑换码'));
  assert(diagnosis.includes('如有兑换码，请在支付前填写'));
  assert(diagnosis.includes('兑换码已生效'));
  const diagnosisIntro = diagnosis.split('<block wx:else>')[0];
  assert(!diagnosisIntro.includes('兑换码'));
  assert(!diagnosisIntro.includes('渠道优惠'));
  assert(!diagnosis.includes('渠道专享优惠'));
  assert(!diagnosis.includes('渠道优惠自动应用'));
  assert(mine.includes('分享专属入口'));
  assert(mine.includes('我的推广与返佣'));
  assert(mine.includes('推广兑换码'));

  assert(!diagnosis.includes('wx:if="{{!phoneAuthorized}}"'), 'diagnosis first screen must not be blocked by phone authorization');
  assert(!diagnosisIntro.includes('open-type="getPhoneNumber"'));
  assert(!diagnosisIntro.includes('授权手机号并继续'));
  assert(diagnosisIntro.includes('提交前授权手机号'));
  assert(diagnosis.includes('GeoGi 仅用于识别本次订单和后续服务，不获取你的头像或昵称'));
  assert(diagnosis.includes('step == 3 && !phoneAuthorized'));
  assert(diagnosis.includes('授权手机号并继续'));
  assert(!diagnosis.includes('<strong>'));
  assert(!diagnosisJs.includes("this.startForm({ forceNew: true });"));
  for (const source of [homeJs, contactJs, mineJs]) {
    assert(!source.includes("wx.setStorageSync('geogi_start_new_diagnosis', true)"));
  }
  const clientSources = [diagnosisJs, diagnosis, homeJs, contactJs, mineJs, appJs, attributionJs].join('\n');
  assert(!clientSources.includes('getUserProfile'));
  assert(!clientSources.includes('chooseAvatar'));
  assert(!/nickname/i.test(clientSources), 'client must not request nickname authorization');

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
