const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geogi-miniprogram-users-'));
  process.env.GEOGI_MINIPROGRAM_USER_DATA_ROOT = path.join(root, 'users');
  process.env.GEOGI_CHANNEL_DATA_ROOT = path.join(root, 'channels');
  process.env.GEOGI_PAYMENT_DATA_ROOT = path.join(root, 'payments');

  const {
    recordPhoneAuthorization,
    listMiniProgramUsers,
    isValidPhoneNumber
  } = require('../src/services/miniprogram-user-store');
  const {
    miniProgramUserAdminDashboard,
    updateMiniProgramUserAdmin
  } = require('../src/services/miniprogram-user-service');
  const channelStore = require('../src/services/channel-store');
  const channelService = require('../src/services/channel-service');
  const { createOrGetPaymentOrder } = require('../src/services/payment-store');

  const first = await recordPhoneAuthorization({
    phoneNumber: '13800138000',
    purePhoneNumber: '13800138000',
    countryCode: '86',
    authorizedAt: '2026-09-25T01:00:00Z'
  });
  assert.strictEqual(first.verified, true);
  assert.strictEqual(first.authorizationCount, 1);

  const second = await recordPhoneAuthorization({
    phoneNumber: '13800138000',
    purePhoneNumber: '13800138000',
    countryCode: '86',
    authorizedAt: '2026-09-25T02:00:00Z'
  });
  assert.strictEqual(second.userId, first.userId);
  assert.strictEqual(second.authorizationCount, 2);
  assert.strictEqual(isValidPhoneNumber('13800138000'), true);
  assert.strictEqual(isValidPhoneNumber('小程序客户未绑定手机号'), false);
  await assert.rejects(
    () => recordPhoneAuthorization({ phoneNumber: '小程序客户未绑定手机号' }),
    /MINIPROGRAM_USER_PHONE_INVALID/
  );

  const channel = await channelStore.upsertChannel({
    name: '测试渠道',
    discountType: 'percent',
    discountRateBps: 9000,
    commissionRateBps: 1000,
    active: true,
    ownerPhones: []
  });

  await createOrGetPaymentOrder({
    clientId: 'GG-LEGACY-NOPHONE',
    projectId: 'GG-P-LEGACY-NOPHONE',
    submissionId: 'SUB-LEGACY-NOPHONE',
    brandName: '历史无手机号客户',
    phoneNumber: '小程序客户未绑定手机号',
    amountTotal: 19900
  });

  await createOrGetPaymentOrder({
    clientId: 'GG-USER-001',
    projectId: 'GG-P-USER-001',
    submissionId: 'SUB-USER-001',
    brandName: '用户管理测试品牌',
    phoneNumber: '13800138000',
    amountTotal: 19900
  });

  let dashboard = await miniProgramUserAdminDashboard();
  assert.strictEqual(dashboard.users.length, 1);
  assert.strictEqual(dashboard.users.some((row) => row.phoneNumber === '小程序客户未绑定手机号'), false);
  assert.strictEqual(dashboard.users[0].customerCount, 1);
  assert.strictEqual(dashboard.users[0].orderCount, 1);
  assert.deepStrictEqual(dashboard.users[0].clientIds, ['GG-USER-001']);

  const updated = await updateMiniProgramUserAdmin({
    userId: first.userId,
    displayName: '廖华锋',
    userType: 'staff',
    notes: '内部推广人员',
    channelIds: [channel.channelId]
  });
  assert.strictEqual(updated.displayName, '廖华锋');
  assert.strictEqual(updated.userType, 'staff');
  assert.strictEqual(updated.channels.length, 1);
  assert.strictEqual(updated.channels[0].channelId, channel.channelId);

  const source = await channelService.upsertSource({
    name: '廖华锋名片',
    sourceType: 'business_card',
    ownerPhone: '13800138000',
    ownerName: '不应覆盖已验证用户姓名',
    active: true
  });
  assert.strictEqual(source.ownerPhone, '13800138000');
  assert.strictEqual(source.ownerName, '廖华锋');

  await assert.rejects(
    () => channelService.upsertSource({
      name: '非法来源',
      sourceType: 'business_card',
      ownerPhone: '13999999999',
      active: true
    }),
    /MINIPROGRAM_VERIFIED_USER_REQUIRED/
  );

  await assert.rejects(
    () => channelService.upsertChannel({
      name: '非法负责人渠道',
      discountType: 'percent',
      discountRateBps: 10000,
      commissionRateBps: 0,
      active: true,
      ownerPhones: ['13999999999']
    }),
    /MINIPROGRAM_VERIFIED_USER_REQUIRED/
  );

  dashboard = await miniProgramUserAdminDashboard();
  const user = dashboard.users.find((row) => row.userId === first.userId);
  assert(user);
  assert.strictEqual(user.ownedSources.length, 1);
  assert.strictEqual(user.channels.length, 1);

  const users = await listMiniProgramUsers();
  assert.strictEqual(users.length, 1);

  const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert(serverSource.includes("app.get('/internal/os/miniprogram-users'"));
  assert(serverSource.includes("app.post('/internal/os/miniprogram-users/:userId'"));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('miniprogram-user-management-regression-ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
