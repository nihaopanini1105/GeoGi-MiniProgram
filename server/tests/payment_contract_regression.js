const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.CUSTOMER_SESSION_SECRET = 'geogi-payment-test-secret';

const {
  DIAGNOSTIC_PRODUCT_CODE,
  DIAGNOSTIC_PRODUCT_NAME,
  DIAGNOSTIC_AMOUNT_FEN,
  DIAGNOSTIC_AMOUNT_YUAN,
  paymentConfiguration,
  paymentStats,
  paymentView
} = require('../src/services/wechat-pay');

function run() {
  assert.strictEqual(DIAGNOSTIC_PRODUCT_CODE, 'GEOGI_DIAGNOSTIC_REPORT_199');
  assert.strictEqual(DIAGNOSTIC_PRODUCT_NAME, 'GeoGi 品牌 GEO 诊断报告');
  assert.strictEqual(DIAGNOSTIC_AMOUNT_FEN, 19900);
  assert.strictEqual(DIAGNOSTIC_AMOUNT_YUAN, '199.00');

  const old = {
    WECHAT_PAY_MCH_ID: process.env.WECHAT_PAY_MCH_ID,
    WECHAT_PAY_CERT_SERIAL_NO: process.env.WECHAT_PAY_CERT_SERIAL_NO,
    WECHAT_PAY_API_V3_KEY: process.env.WECHAT_PAY_API_V3_KEY,
    WECHAT_PAY_PRIVATE_KEY_PATH: process.env.WECHAT_PAY_PRIVATE_KEY_PATH,
    WECHAT_PAY_PLATFORM_CERT_PATH: process.env.WECHAT_PAY_PLATFORM_CERT_PATH,
    WECHAT_PAY_PLATFORM_CERT_SERIAL_NO: process.env.WECHAT_PAY_PLATFORM_CERT_SERIAL_NO
  };
  delete process.env.WECHAT_PAY_MCH_ID;
  delete process.env.WECHAT_PAY_CERT_SERIAL_NO;
  delete process.env.WECHAT_PAY_API_V3_KEY;
  delete process.env.WECHAT_PAY_PRIVATE_KEY_PATH;
  delete process.env.WECHAT_PAY_PLATFORM_CERT_PATH;
  delete process.env.WECHAT_PAY_PLATFORM_CERT_SERIAL_NO;
  assert.strictEqual(paymentConfiguration().configured, false);

  const paid = paymentView({
    lead: {
      fields: {
        客户编号: 'GG-202609-0001',
        项目编号: 'GG-P-202609-000001',
        品牌名称: '测试品牌',
        支付要求: 'true',
        诊断产品代码: 'GEOGI_DIAGNOSTIC_REPORT_199',
        诊断产品: 'GeoGi 品牌 GEO 诊断报告',
        应付金额分: '19900',
        支付状态: '已支付',
        支付金额分: '19900',
        支付商户订单号: 'GGD123',
        微信支付单号: 'WX123',
        支付完成时间: '2026-09-22T10:00:00+08:00'
      }
    },
    project: { fields: { 当前阶段: 'INTAKE' } }
  });
  assert.strictEqual(paid.paymentStatus, 'PAID');
  assert.strictEqual(paid.amountFen, 19900);
  assert.strictEqual(paid.refundable, true);

  const stats = paymentStats([
    paid,
    { paymentStatus: 'PENDING', amountFen: 19900 },
    { paymentStatus: 'REFUND_PROCESSING', amountFen: 19900 },
    { paymentStatus: 'REFUNDED', amountFen: 19900, refundAmountFen: 19900 }
  ]);
  assert.deepStrictEqual(stats, {
    orderCount: 4,
    paidOrderCount: 1,
    pendingOrderCount: 1,
    refundProcessingCount: 1,
    refundedOrderCount: 1,
    paidAmountFen: 19900,
    refundedAmountFen: 19900
  });

  const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  const rawNotify = serverSource.indexOf("app.post('/api/payments/wechat/notify'");
  const jsonParser = serverSource.indexOf("app.use(express.json({ limit: '512kb' }))");
  assert(rawNotify >= 0 && jsonParser > rawNotify, 'payment callback must receive raw body before JSON parser');
  assert(serverSource.includes("app.post('/api/payments/create'"));
  assert(serverSource.includes("app.get('/internal/os/payments'"));
  assert(serverSource.includes("app.post('/internal/os/payments/:projectId/refund'"));

  const intakeSource = fs.readFileSync(path.join(__dirname, '../src/services/os-intake.js'), 'utf8');
  assert(intakeSource.includes("当前阶段: 'PAYMENT_PENDING'"));
  assert(intakeSource.includes("应付金额分: '19900'"));
  assert(intakeSource.includes("支付状态: '待支付'"));

  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  console.log('geogi-payment-contract-regression-ok');
}

run();
