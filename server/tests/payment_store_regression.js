const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-payments-'));
process.env.GEOGI_PAYMENT_DATA_ROOT = root;

const {
  PRODUCT_PRICE_FEN,
  PRODUCT_PRICE_YUAN,
  PAYMENT_ORDER_TTL_MINUTES,
  isPaymentOrderExpired,
  createOrGetPaymentOrder,
  findPaymentByProject,
  updatePaymentOrder,
  listPaymentOrders,
  publicPaymentView,
  paymentSummary
} = require('../src/services/payment-store');
const {
  paymentProjectionState,
  paymentProjectionDecision,
  listPaymentsForOs
} = require('../src/services/payment-service');

async function main() {
  assert.strictEqual(PRODUCT_PRICE_FEN, 19900);
  assert.strictEqual(PRODUCT_PRICE_YUAN, 199);
  assert.strictEqual(PAYMENT_ORDER_TTL_MINUTES, 30);

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
  assert.strictEqual(isPaymentOrderExpired(first.order), false);
  const validityMs = Date.parse(first.order.expiresAt) - Date.parse(first.order.createdAt);
  assert(validityMs >= (30 * 60 * 1000) - 1000 && validityMs <= (30 * 60 * 1000) + 1000);
  assert.strictEqual(publicPaymentView(first.order).canCancel, true);
  assert.strictEqual(publicPaymentView(first.order).refundableAmount, 0);

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
    paidAt: '2026-09-22T10:00:00+08:00',
    refundableAmount: PRODUCT_PRICE_FEN
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
  assert.strictEqual(view.submissionId, 'mp-test');
  assert.strictEqual(view.customerContactMasked, '138****8000');
  assert.strictEqual(view.refundedAmount, 9900);
  assert.strictEqual(view.refundableAmount, 10000);
  assert.strictEqual(view.refunds.length, 1);

  const found = await findPaymentByProject('GG-P-202609-000001');
  assert.strictEqual(found.outTradeNo, first.order.outTradeNo);

  const rows = await listPaymentOrders();
  const summary = paymentSummary(rows);
  assert.strictEqual(summary.orderCount, 1);
  assert.strictEqual(summary.partiallyRefundedCount, 1);
  assert.strictEqual(summary.paidEverCount, 1);
  assert.strictEqual(summary.paymentConversionRate, 1);
  assert.strictEqual(summary.grossPaidYuan, 199);
  assert.strictEqual(summary.refundedYuan, 99);
  assert.strictEqual(summary.netPaidYuan, 100);

  const cancelCandidate = await createOrGetPaymentOrder({
    clientId: 'GG-202609-0002',
    projectId: 'GG-P-202609-000002',
    submissionId: 'mp-cancel-test',
    brandName: '取消订单测试品牌',
    phoneNumber: '13800138001'
  });
  const cancelled = await updatePaymentOrder(cancelCandidate.order.outTradeNo, {
    status: 'closed',
    closedAt: new Date().toISOString(),
    closedReason: 'customer_cancelled'
  });
  assert.strictEqual(publicPaymentView(cancelled).canCancel, false);
  const reopened = await createOrGetPaymentOrder({
    clientId: 'GG-202609-0002',
    projectId: 'GG-P-202609-000002',
    submissionId: 'mp-cancel-test',
    brandName: '取消订单测试品牌',
    phoneNumber: '13800138001'
  });
  assert.strictEqual(reopened.created, true);
  assert.notStrictEqual(reopened.order.outTradeNo, cancelCandidate.order.outTradeNo);
  assert.strictEqual(reopened.order.status, 'unpaid');

  const expiryCandidate = await createOrGetPaymentOrder({
    clientId: 'GG-202609-0003',
    projectId: 'GG-P-202609-000003',
    submissionId: 'mp-expiry-test',
    brandName: '过期订单测试品牌',
    phoneNumber: '13800138002'
  });
  await updatePaymentOrder(expiryCandidate.order.outTradeNo, {
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
  });
  const osPayments = await listPaymentsForOs();
  const expiredView = osPayments.items.find((item) => item.outTradeNo === expiryCandidate.order.outTradeNo);
  assert(expiredView);
  assert.strictEqual(expiredView.status, 'closed');
  assert.strictEqual(expiredView.closedReason, 'expired');
  assert.strictEqual(expiredView.refundableAmount, 0);
  assert(osPayments.summary.closedCount >= 1);

  const closedProjection = paymentProjectionState('closed');
  assert.strictEqual(closedProjection.currentStatus, '支付订单已关闭');
  assert.strictEqual(closedProjection.projectStage, 'PAYMENT_PENDING');
  assert.strictEqual(closedProjection.serviceEligible, false);

  const refundingProjection = paymentProjectionState('refund_processing');
  assert.strictEqual(refundingProjection.currentStatus, '退款处理中');
  assert.strictEqual(refundingProjection.projectStage, 'REFUND_PROCESSING');
  assert.strictEqual(refundingProjection.serviceEligible, false);
  const partialProjection = paymentProjectionState('partially_refunded');
  assert.strictEqual(partialProjection.currentStatus, '部分退款');
  assert.strictEqual(partialProjection.projectStage, 'INTAKE');
  assert.strictEqual(partialProjection.serviceEligible, true);

  const initialPaidDecision = paymentProjectionDecision('PAYMENT_PENDING', 'paid');
  assert.strictEqual(initialPaidDecision.mutateBusinessProjection, true);
  assert.strictEqual(initialPaidDecision.projectStage, 'INTAKE');
  const activeWorkflowDecision = paymentProjectionDecision('DIAGNOSIS', 'paid');
  assert.strictEqual(activeWorkflowDecision.mutateBusinessProjection, false);
  assert.strictEqual(activeWorkflowDecision.projectStage, 'DIAGNOSIS');
  const activeRefundDecision = paymentProjectionDecision('REVIEW', 'refund_processing');
  assert.strictEqual(activeRefundDecision.mutateBusinessProjection, false);
  assert.strictEqual(activeRefundDecision.projectStage, 'REVIEW');

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
