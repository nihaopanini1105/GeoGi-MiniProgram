const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.GEOGI_OPS_URL = 'https://ops.geogi.cn';
delete process.env.FEISHU_NOTIFY_WEBHOOK;
delete process.env.FEISHU_NOTIFY_RECEIVE_ID;

const notifications = require('../src/services/ops-notifications');

assert.strictEqual(notifications.notificationConfigured(), false);
process.env.FEISHU_NOTIFY_RECEIVE_ID = 'ou_test';
assert.strictEqual(notifications.notificationConfigured(), true);
delete process.env.FEISHU_NOTIFY_RECEIVE_ID;

const intake = notifications.buildIntakeSubmittedMessage({
  form: {
    brandName: 'GeoGi Test Brand',
    companyName: 'GeoGi Test Co',
    industry: '旅游',
    segment: '定制游',
    contactName: '测试客户',
    contactMethod: '13800138000',
    uploads: [{ name: 'brand.pdf' }]
  },
  clientId: 'GG-202609-0001',
  projectId: 'GG-P-202609-000001',
  payment: { outTradeNo: 'GG199TEST' },
  submittedAt: '2026-09-23T11:10:00+08:00'
});
assert.ok(intake.includes('新品牌资料提交'));
assert.ok(intake.includes('GeoGi Test Brand'));
assert.ok(intake.includes('GG199TEST'));
assert.ok(intake.includes('¥199.00'));
assert.ok(intake.includes('https://ops.geogi.cn'));

const paid = notifications.buildPaymentPaidMessage({
  brandName: 'GeoGi Test Brand',
  clientId: 'GG-202609-0001',
  projectId: 'GG-P-202609-000001',
  outTradeNo: 'GG199TEST',
  transactionId: '4200000000',
  amountTotal: 19900,
  currency: 'CNY',
  paidAt: '2026-09-23T11:15:00+08:00'
});
assert.ok(paid.includes('支付成功'));
assert.ok(paid.includes('¥199.00'));
assert.ok(paid.includes('待 OS 处理'));

const refundRequested = notifications.buildRefundRequestedMessage({
  order: {
    brandName: 'GeoGi Test Brand',
    clientId: 'GG-202609-0001',
    projectId: 'GG-P-202609-000001',
    outTradeNo: 'GG199TEST'
  },
  refund: {
    outRefundNo: 'RGG199TEST',
    amount: 9900,
    reason: '客户申请部分退款',
    operatorId: 'ops-user',
    requestedAt: '2026-09-23T11:20:00+08:00',
    status: 'processing'
  }
});
assert.ok(refundRequested.includes('退款已发起'));
assert.ok(refundRequested.includes('¥99.00'));
assert.ok(refundRequested.includes('客户申请部分退款'));

const refundResult = notifications.buildRefundResultMessage({
  order: {
    brandName: 'GeoGi Test Brand',
    clientId: 'GG-202609-0001',
    projectId: 'GG-P-202609-000001',
    outTradeNo: 'GG199TEST',
    amountTotal: 19900,
    refundedAmount: 19900,
    refundableAmount: 0
  },
  refund: {
    outRefundNo: 'RGG199TEST',
    providerRefundId: '5030000000',
    amount: 19900,
    reason: '客户退款',
    status: 'success',
    successAt: '2026-09-23T11:25:00+08:00'
  }
});
assert.ok(refundResult.includes('退款结果已确认'));
assert.ok(refundResult.includes('已全额退款'));

const intakeSource = fs.readFileSync(path.join(__dirname, '../src/services/os-intake.js'), 'utf8');
const paymentSource = fs.readFileSync(path.join(__dirname, '../src/services/payment-service.js'), 'utf8');
const wechatPaySource = fs.readFileSync(path.join(__dirname, '../src/services/wechat-pay.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');

assert.ok(intakeSource.includes('notifyIntakeSubmitted'));
assert.ok(paymentSource.includes('notifyPaymentPaid'));
assert.ok(wechatPaySource.includes('notifyPaymentPaid'));
assert.ok(wechatPaySource.includes('notifyRefundRequested'));
assert.ok(wechatPaySource.includes('notifyRefundResult'));
assert.ok(serverSource.includes('feishuNotification'));

console.log('feishu-ops-notifications-regression-ok');
