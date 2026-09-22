const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-payments-'));
process.env.GEOGI_PAYMENT_DATA_ROOT = root;

const {
  PRODUCT_PRICE_FEN,
  PRODUCT_PRICE_YUAN,
  createOrGetPaymentOrder,
  findPaymentByProject,
  updatePaymentOrder,
  listPaymentOrders,
  publicPaymentView,
  paymentSummary
} = require('../src/services/payment-store');

async function main() {
  assert.strictEqual(PRODUCT_PRICE_FEN, 19900);
  assert.strictEqual(PRODUCT_PRICE_YUAN, 199);

  const first = await createOrGetPaymentOrder({
    clientId: 'GG-202609-0001',
    projectId: 'GG-P-202609-000001',
    submissionId: 'mp-test',
    brandName: '测试品牌',
    phoneNumber: '13800138000'
  });
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.order.amountTotal, 19900);
  assert.strictEqual(first.order.status, 'unpaid');

  const duplicate = await createOrGetPaymentOrder({
    clientId: 'GG-202609-0001',
    projectId: 'GG-P-202609-000001',
    submissionId: 'another',
    brandName: '不应创建第二单',
    phoneNumber: '13800138000'
  });
  assert.strictEqual(duplicate.created, false);
  assert.strictEqual(duplicate.order.outTradeNo, first.order.outTradeNo);

  const paid = await updatePaymentOrder(first.order.outTradeNo, {
    status: 'paid',
    transactionId: '4200000000000000001',
    paidAt: '2026-09-22T10:00:00+08:00'
  });
  assert.strictEqual(paid.status, 'paid');
  assert.strictEqual(paid.refundableAmount, 19900);

  const partial = await updatePaymentOrder(first.order.outTradeNo, {
    status: 'partially_refunded',
    refundedAmount: 9900,
    refundableAmount: 10000,
    refunds: [{
      refundId: 'refund_test',
      outRefundNo: 'RTEST',
      amount: 9900,
      status: 'success',
      requestedAt: '2026-09-22T11:00:00+08:00'
    }]
  });
  const view = publicPaymentView(partial);
  assert.strictEqual(view.amountYuan, 199);
  assert.strictEqual(view.refundedAmount, 9900);
  assert.strictEqual(view.refundableAmount, 10000);
  assert.strictEqual(view.refunds.length, 1);

  const found = await findPaymentByProject('GG-P-202609-000001');
  assert.strictEqual(found.outTradeNo, first.order.outTradeNo);

  const rows = await listPaymentOrders();
  const summary = paymentSummary(rows);
  assert.strictEqual(summary.orderCount, 1);
  assert.strictEqual(summary.partiallyRefundedCount, 1);
  assert.strictEqual(summary.grossPaidYuan, 199);
  assert.strictEqual(summary.refundedYuan, 99);
  assert.strictEqual(summary.netPaidYuan, 100);

  let rejected = false;
  try {
    await updatePaymentOrder(first.order.outTradeNo, { amountTotal: 1 });
  } catch (error) {
    rejected = /PAYMENT_AMOUNT_INVALID/.test(String(error && error.message));
  }
  assert.strictEqual(rejected, false, 'immutable amount must remain server-owned even when patch attempts to replace it');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('payment-store-regression-ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
