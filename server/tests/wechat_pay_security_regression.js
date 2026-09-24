const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-wechat-pay-'));
const paymentRoot = path.join(root, 'payments');
const merchantKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const platformKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const merchantPrivatePath = path.join(root, 'merchant.pem');
const platformPublicPath = path.join(root, 'platform.pem');

fs.writeFileSync(
  merchantPrivatePath,
  merchantKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })
);
fs.writeFileSync(
  platformPublicPath,
  platformKeys.publicKey.export({ type: 'spki', format: 'pem' })
);

process.env.GEOGI_PAYMENT_DATA_ROOT = paymentRoot;
process.env.WECHAT_APP_ID = 'wx_geogi_test';
process.env.WECHAT_APP_SECRET = 'test-secret';
process.env.WECHATPAY_MCH_ID = '1900000001';
process.env.WECHATPAY_MERCHANT_SERIAL_NO = 'MERCHANT_SERIAL_TEST';
process.env.WECHATPAY_PRIVATE_KEY_PATH = merchantPrivatePath;
process.env.WECHATPAY_API_V3_KEY = '0123456789abcdef0123456789abcdef';
process.env.WECHATPAY_PLATFORM_PUBLIC_KEY_PATH = platformPublicPath;
process.env.WECHATPAY_PLATFORM_SERIAL_NO = 'PLATFORM_SERIAL_TEST';
process.env.WECHATPAY_NOTIFY_URL = 'https://api.geogi.cn/api/payments/wechat/notify';
process.env.WECHATPAY_REFUND_NOTIFY_URL = 'https://api.geogi.cn/api/payments/wechat/refund-notify';

const {
  createOrGetPaymentOrder,
  findPaymentByOutTradeNo,
  updatePaymentOrder
} = require('../src/services/payment-store');
const {
  configStatus,
  verifyWechatSignature,
  decryptNotificationResource,
  handlePaymentNotification,
  handleRefundNotification
} = require('../src/services/wechat-pay');

function encryptedResource(payload) {
  const key = Buffer.from(process.env.WECHATPAY_API_V3_KEY, 'utf8');
  const nonce = '0123456789ab';
  const associatedData = 'geogi-payment-notify';
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final()
  ]);
  const tagged = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: tagged.toString('base64'),
    nonce,
    associated_data: associatedData
  };
}

function signedEnvelope(payload) {
  const envelope = {
    id: 'notify-test',
    create_time: '2026-09-22T10:00:00+08:00',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: encryptedResource(payload),
    summary: '支付成功'
  };
  const rawBody = JSON.stringify(envelope);
  const timestamp = '1789999999';
  const nonce = 'signed-notify-nonce';
  const message = timestamp + '\n' + nonce + '\n' + rawBody + '\n';
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    platformKeys.privateKey
  ).toString('base64');
  return {
    rawBody,
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-serial': process.env.WECHATPAY_PLATFORM_SERIAL_NO,
      'wechatpay-signature': signature
    }
  };
}

async function main() {
  const status = configStatus();
  assert.strictEqual(status.configured, true);
  assert.deepStrictEqual(status.missing, []);

  const created = await createOrGetPaymentOrder({
    clientId: 'GG-202609-0099',
    projectId: 'GG-P-202609-009999',
    submissionId: 'mp-security',
    brandName: '支付安全测试品牌',
    phoneNumber: '13800138000'
  });

  const payload = {
    mchid: process.env.WECHATPAY_MCH_ID,
    appid: process.env.WECHAT_APP_ID,
    out_trade_no: created.order.outTradeNo,
    transaction_id: '4200000000000099999',
    trade_state: 'SUCCESS',
    success_time: '2026-09-22T10:01:00+08:00',
    amount: { total: 19900, payer_total: 19900, currency: 'CNY', payer_currency: 'CNY' }
  };
  const signed = signedEnvelope(payload);
  assert.strictEqual(verifyWechatSignature(signed.headers, signed.rawBody), true);
  assert.deepStrictEqual(
    decryptNotificationResource(JSON.parse(signed.rawBody).resource),
    payload
  );

  const paid = await handlePaymentNotification(signed.headers, signed.rawBody);
  assert.strictEqual(paid.status, 'paid');
  assert.strictEqual(paid.transactionId, payload.transaction_id);
  assert.strictEqual(paid.refundableAmount, 19900);
  assert.strictEqual((await findPaymentByOutTradeNo(created.order.outTradeNo)).status, 'paid');

  const discounted = await createOrGetPaymentOrder({
    clientId: 'GG-202609-0100',
    projectId: 'GG-P-202609-010000',
    submissionId: 'mp-discount-security',
    brandName: '折扣支付安全测试品牌',
    phoneNumber: '13800138001',
    amountTotal: 15920,
    promotionCode: 'A80',
    channelId: 'channel_a',
    channelName: 'A 渠道',
    discountType: 'percent',
    discountRateBps: 8000,
    commissionRateBps: 1000
  });
  const discountedPayload = {
    ...payload,
    out_trade_no: discounted.order.outTradeNo,
    transaction_id: '4200000000000100000',
    amount: { total: 15920, payer_total: 15920, currency: 'CNY', payer_currency: 'CNY' }
  };
  const discountedSigned = signedEnvelope(discountedPayload);
  const discountedPaid = await handlePaymentNotification(discountedSigned.headers, discountedSigned.rawBody);
  assert.strictEqual(discountedPaid.status, 'paid');
  assert.strictEqual(discountedPaid.refundableAmount, 15920);

  const refundNo = 'RA80SECURITY';
  const refunding = await updatePaymentOrder(discounted.order.outTradeNo, {
    status: 'refund_processing',
    refundableAmount: 15920,
    refunds: [{
      refundId: 'refund-a80',
      outRefundNo: refundNo,
      providerRefundId: '',
      amount: 15920,
      status: 'processing',
      reason: '渠道折扣订单退款',
      requestedAt: '2026-09-22T10:10:00+08:00',
      successAt: '',
      operatorId: 'test'
    }]
  });
  assert.strictEqual(refunding.amountTotal, 15920);
  const refundPayload = {
    mchid: process.env.WECHATPAY_MCH_ID,
    out_trade_no: discounted.order.outTradeNo,
    out_refund_no: refundNo,
    refund_id: '5000000000000100000',
    refund_status: 'SUCCESS',
    success_time: '2026-09-22T10:15:00+08:00',
    amount: { total: 15920, refund: 15920, payer_total: 15920, payer_refund: 15920, currency: 'CNY' }
  };
  const signedRefund = signedEnvelope(refundPayload);
  const discountedRefunded = await handleRefundNotification(signedRefund.headers, signedRefund.rawBody);
  assert.strictEqual(discountedRefunded.status, 'refunded');
  assert.strictEqual(discountedRefunded.refundedAmount, 15920);
  assert.strictEqual(discountedRefunded.refundableAmount, 0);

  const wrongAmount = signedEnvelope({
    ...payload,
    transaction_id: '4200000000000099998',
    amount: { ...payload.amount, total: 1 }
  });
  await assert.rejects(
    () => handlePaymentNotification(wrongAmount.headers, wrongAmount.rawBody),
    /WECHAT_PAY_NOTIFY_AMOUNT_MISMATCH/
  );

  const wrongMerchant = signedEnvelope({ ...payload, mchid: '1900000002' });
  await assert.rejects(
    () => handlePaymentNotification(wrongMerchant.headers, wrongMerchant.rawBody),
    /WECHAT_PAY_NOTIFY_MERCHANT_SCOPE_MISMATCH/
  );

  const tamperedHeaders = { ...signed.headers, 'wechatpay-signature': Buffer.from('bad').toString('base64') };
  assert.strictEqual(verifyWechatSignature(tamperedHeaders, signed.rawBody), false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('wechat-pay-security-regression-ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
