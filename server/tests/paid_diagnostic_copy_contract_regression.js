const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function run() {
  const diagnosis = read('pages/diagnosis/diagnosis.wxml');
  const diagnosisJs = read('pages/diagnosis/diagnosis.js');
  const success = read('pages/submit-success/submit-success.wxml');
  const successJs = read('pages/submit-success/submit-success.js');
  const home = read('pages/index/index.wxml');
  const services = read('pages/services/services.wxml');
  const servicesJs = read('pages/services/services.js');
  const mine = read('pages/mine/mine.wxml');
  const report = read('pages/report-detail/report-detail.wxml');
  const privacy = read('pages/privacy/privacy.wxml');
  const appWxss = read('app.wxss');
  const contact = read('pages/contact/contact.wxml');
  const sample = read('pages/sample-report/sample-report.wxml');
  const sampleApi = read('server/src/services/sample-report.js');
  const config = read('server/src/services/config.js');
  const appConfig = read('app.json');
  const server = read('server/src/server.js');
  const intake = read('server/src/services/os-intake.js');
  const operationsBridge = read('server/src/services/os-operations-bridge.js');
  const paymentStore = read('server/src/services/payment-store.js');
  const wechatPay = read('server/src/services/wechat-pay.js');
  const deployScript = read('server/scripts/deploy-production-from-mac.sh');

  for (const [name, source] of Object.entries({ diagnosis, success, home, servicesJs, report, contact, sample, sampleApi, config })) {
    assert(source.includes('199'), name + ' must preserve the 199 yuan standard-price truth');
  }
  assert(diagnosis.includes('提交并支付'));
  assert(diagnosis.includes('标准价 199 元'));
  assert(diagnosis.includes('这份诊断报告会重点回答'));
  assert(diagnosis.includes('整个流程怎么完成？'));
  assert(diagnosis.includes('不获取你的头像或昵称'));
  assert(diagnosis.includes('如有兑换码，请在支付前填写'));
  assert(diagnosis.includes('兑换码已生效'));
  assert(diagnosisJs.includes("'/api/redeem-codes/quote'"));
  const diagnosisIntro = diagnosis.split('<block wx:else>')[0];
  assert(!diagnosisIntro.includes('兑换码'));
  assert(!diagnosisIntro.includes('渠道优惠'));
  assert(!diagnosis.includes('合作渠道优惠会自动应用'));
  assert(!diagnosis.includes('渠道优惠自动应用'));
  assert(diagnosisJs.includes('wx.requestPayment'));
  assert(diagnosisJs.includes("'/api/customer/projects/' + encodeURIComponent(submission.projectId) + '/payment'"));
  assert(diagnosisJs.includes("'/api/customer/projects/' + encodeURIComponent(submission.projectId) + '/payment/sync'"));
  assert(diagnosis.includes('30 分钟内有效'));
  assert(success.includes('标准价 199 元'));
  assert(success.includes('兑换码'));
  assert(success.includes('取消订单'));
  assert(successJs.includes('cancelOrder()'));
  assert(successJs.includes("'/payment/cancel'"));
  assert(paymentStore.includes('PAYMENT_ORDER_TTL_MINUTES = 30'));
  assert(paymentStore.includes('expiresAt'));
  assert(wechatPay.includes('time_expire: order.expiresAt'));
  assert(wechatPay.includes("'/close'"));
  assert(server.includes("/api/customer/projects/:projectId/payment/cancel"));
  assert(success.includes("closed ? '重新支付' : '立即支付'"));
  assert(home.includes('199元获取一次品牌 GEO诊断'));
  assert(home.includes('获取诊断报告'));
  assert(!home.includes('¥199 获取诊断报告'));
  assert(read('pages/index/index.js').includes("title: '品牌研究与问题诊断'"));
  assert(appWxss.includes('white-space: nowrap'));
  assert(appWxss.includes('word-break: keep-all'));
  assert(deployScript.includes('pages utils config app.js app.json app.wxss'));
  assert(deployScript.includes('"$REMOTE_TMP/config/api.js"'));
  assert(deployScript.includes('"$REMOTE_TMP/app.wxss"'));

  for (const [name, source] of Object.entries({
    home,
    diagnosis,
    success,
    mine,
    report,
    contact,
    sample,
    services
  })) {
    const buttons = source.match(/<button\b[\s\S]*?<\/button>/g) || [];
    for (const button of buttons) {
      assert(!/199|¥199/.test(button), name + ' CTA button must not repeat product price: ' + button);
    }
  }
  assert(servicesJs.includes('不包含在本次诊断报告中'));
  assert(servicesJs.includes('提交订单前如有兑换码可主动填写并验证'));
  assert(mine.includes('订单优惠与付款状态'));
  assert(report.includes('订单确认后开始处理'));
  assert(report.includes('兑换码优惠'));
  assert(privacy.includes('本次品牌 GEO 诊断'));
  assert(contact.includes('标准价 199 元'));
  assert(!contact.includes('渠道优惠'));
  assert(sample.includes('如持有兑换码，可在提交订单前填写并验证'));
  assert(sample.includes('开始填写资料'));
  assert(config.includes("priceYuan: 199"));
  assert(config.includes("paymentRequiredBeforeProcessing: true"));
  assert(appConfig.includes('pages/contact/contact'));
  assert(server.includes('/api/payments/wechat/notify'));
  assert(server.includes('/internal/os/payments/:outTradeNo/refund'));
  assert(intake.includes('createOrGetPaymentOrder'));
  assert(intake.includes("status: free ? '已优惠至免费' : '待付款'"));
  assert(intake.includes('paymentRequired: !free'));
  assert(intake.includes('payment: publicPaymentView(order)'));
  assert(operationsBridge.includes("PAID_DIAGNOSTIC_LAUNCH_CUTOFF = '2026-09-22T07:33:31Z'"));
  assert(operationsBridge.includes("freeRedeemCode ? 'redeem_code'"));
  assert(operationsBridge.includes("legacyEligible ? 'legacy_pre_payment' : 'payment_required'"));
  assert(operationsBridge.includes('paymentEligibleForProcessing: paid || freeRedeemCode || legacyEligible'));

  for (const forbidden of [
    '免费诊断', '免费报告', '初步诊断会', '提交后立即开始诊断',
    '渠道优惠自动应用', '合作渠道优惠会自动应用', '渠道专享优惠'
  ]) {
    assert(!diagnosis.includes(forbidden), 'diagnosis copy must not imply automatic channel benefits: ' + forbidden);
  }

  console.log('paid-diagnostic-copy-contract-regression-ok');
}

run();
