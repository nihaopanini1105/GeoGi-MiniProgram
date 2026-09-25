const {
  listMiniProgramUsers,
  findMiniProgramUserById,
  findMiniProgramUserByPhone,
  ensureHistoricalAuthorizedUser,
  updateMiniProgramUser,
  normalizePhone,
  isValidPhoneNumber
} = require('./miniprogram-user-store');
const {
  listChannels,
  listSources,
  upsertChannel
} = require('./channel-store');
const { listPaymentOrders } = require('./payment-store');

function paymentCompleted(order) {
  return Boolean(order && ['paid', 'free', 'refund_processing', 'partially_refunded', 'refunded'].includes(String(order.status || '')));
}

function yuan(fen) {
  return Number(fen || 0) / 100;
}

async function ensureHistoricalUsersFromOrders(orders) {
  const byPhone = new Map();
  for (const order of orders || []) {
    const phone = normalizePhone(order && order.phoneNumber);
    if (!phone || !isValidPhoneNumber(phone)) continue;
    const createdAt = String(order.createdAt || '');
    const current = byPhone.get(phone);
    if (!current || createdAt < current.createdAt) {
      byPhone.set(phone, { phoneNumber: phone, createdAt });
    }
  }
  for (const row of byPhone.values()) {
    await ensureHistoricalAuthorizedUser({
      phoneNumber: row.phoneNumber,
      authorizedAt: row.createdAt || new Date().toISOString()
    });
  }
}

function userBusinessView(user, channels, sources, orders) {
  const phone = normalizePhone(user.phoneNumber);
  const userChannels = (channels || []).filter((channel) => (
    Array.isArray(channel.ownerPhones) && channel.ownerPhones.some((item) => normalizePhone(item) === phone)
  ));
  const ownedSources = (sources || []).filter((source) => normalizePhone(source.ownerPhone) === phone);
  const userOrders = (orders || []).filter((order) => normalizePhone(order.phoneNumber) === phone);
  const clientIds = [...new Set(userOrders.map((order) => String(order.clientId || '').trim()).filter(Boolean))];
  const projectIds = [...new Set(userOrders.map((order) => String(order.projectId || '').trim()).filter(Boolean))];
  const brandNames = [...new Set(userOrders.map((order) => String(order.brandName || '').trim()).filter(Boolean))];
  const grossPaidFen = userOrders.reduce((sum, order) => sum + (paymentCompleted(order) ? Number(order.amountTotal || 0) : 0), 0);
  const refundedFen = userOrders.reduce((sum, order) => sum + Number(order.refundedAmount || 0), 0);
  const sortedOrders = userOrders.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return {
    ...user,
    channels: userChannels.map((channel) => ({
      channelId: channel.channelId,
      name: channel.name,
      active: Boolean(channel.active),
      discountType: channel.discountType,
      discountRateBps: Number(channel.discountRateBps || 0),
      commissionRateBps: Number(channel.commissionRateBps || 0)
    })),
    ownedSources: ownedSources.map((source) => ({
      sourceId: source.sourceId,
      name: source.name,
      sourceType: source.sourceType,
      channelId: source.channelId || '',
      active: Boolean(source.active)
    })),
    clientIds,
    projectIds,
    brandNames,
    customerCount: clientIds.length,
    orderCount: userOrders.length,
    paidOrderCount: userOrders.filter(paymentCompleted).length,
    reportCompletedCount: userOrders.filter((order) => Boolean(order.reportReleasedAt)).length,
    grossPaidYuan: yuan(grossPaidFen),
    refundedYuan: yuan(refundedFen),
    netPaidYuan: yuan(grossPaidFen - refundedFen),
    latestOrderAt: sortedOrders[0] && sortedOrders[0].createdAt || '',
    latestOrderStatus: sortedOrders[0] && sortedOrders[0].status || '',
    latestBrandName: sortedOrders[0] && sortedOrders[0].brandName || '',
    orders: sortedOrders.slice(0, 100).map((order) => ({
      outTradeNo: order.outTradeNo,
      clientId: order.clientId,
      projectId: order.projectId,
      brandName: order.brandName || '',
      productName: order.productName || '',
      listPriceYuan: yuan(order.listPriceFen || 19900),
      amountYuan: yuan(order.amountTotal || 0),
      refundedYuan: yuan(order.refundedAmount || 0),
      status: order.status,
      sourceId: order.sourceId || '',
      sourceName: order.sourceName || '',
      sourceType: order.sourceType || '',
      sourceOwnerName: order.sourceOwnerName || '',
      channelId: order.channelId || '',
      channelName: order.channelName || '',
      createdAt: order.createdAt || '',
      paidAt: order.paidAt || '',
      reportReleasedAt: order.reportReleasedAt || ''
    }))
  };
}

async function miniProgramUserAdminDashboard() {
  const orders = await listPaymentOrders();
  await ensureHistoricalUsersFromOrders(orders);
  const [users, channels, sources] = await Promise.all([
    listMiniProgramUsers(),
    listChannels(),
    listSources()
  ]);
  return {
    ok: true,
    users: users.map((user) => userBusinessView(user, channels, sources, orders))
      .sort((a, b) => String(b.lastAuthorizedAt || b.latestOrderAt || '').localeCompare(String(a.lastAuthorizedAt || a.latestOrderAt || ''))),
    channels: channels.map((channel) => ({
      channelId: channel.channelId,
      name: channel.name,
      active: Boolean(channel.active)
    })),
    sourceOptions: sources.map((source) => ({
      sourceId: source.sourceId,
      name: source.name,
      sourceType: source.sourceType,
      ownerPhone: source.ownerPhone || '',
      ownerName: source.ownerName || '',
      channelId: source.channelId || '',
      active: Boolean(source.active)
    }))
  };
}

async function verifiedUserOptions() {
  const orders = await listPaymentOrders();
  await ensureHistoricalUsersFromOrders(orders);
  const users = await listMiniProgramUsers();
  return users
    .filter((user) => user.verified === true)
    .map((user) => ({
      userId: user.userId,
      phoneNumber: user.phoneNumber,
      displayName: user.displayName || '',
      userType: user.userType || 'customer',
      lastAuthorizedAt: user.lastAuthorizedAt || '',
      verified: true
    }))
    .sort((a, b) => String(a.displayName || a.phoneNumber).localeCompare(String(b.displayName || b.phoneNumber), 'zh-CN'));
}

async function requireVerifiedPhone(phoneNumber) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) return null;
  const user = await findMiniProgramUserByPhone(phone);
  if (!user || user.verified !== true) {
    const error = new Error('MINIPROGRAM_VERIFIED_USER_REQUIRED');
    error.code = 'MINIPROGRAM_VERIFIED_USER_REQUIRED';
    throw error;
  }
  return user;
}

async function updateMiniProgramUserAdmin(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('MINIPROGRAM_USER_ID_REQUIRED');
  const existing = await findMiniProgramUserById(userId);
  if (!existing || existing.verified !== true) throw new Error('MINIPROGRAM_USER_NOT_FOUND');

  const updated = await updateMiniProgramUser({
    userId,
    displayName: input.displayName,
    userType: input.userType,
    notes: input.notes
  });

  if (input.channelIds !== undefined) {
    const requested = [...new Set((Array.isArray(input.channelIds) ? input.channelIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean))];
    const channels = await listChannels();
    const knownIds = new Set(channels.map((channel) => channel.channelId));
    if (requested.some((channelId) => !knownIds.has(channelId))) {
      throw new Error('MINIPROGRAM_USER_CHANNEL_NOT_FOUND');
    }
    const selected = new Set(requested);
    const phone = normalizePhone(updated.phoneNumber);
    for (const channel of channels) {
      const currentOwners = Array.isArray(channel.ownerPhones) ? channel.ownerPhones.map(normalizePhone).filter(Boolean) : [];
      const withoutUser = currentOwners.filter((ownerPhone) => ownerPhone !== phone);
      const nextOwners = selected.has(channel.channelId)
        ? [...new Set([...withoutUser, phone])]
        : withoutUser;
      const same = nextOwners.length === currentOwners.length && nextOwners.every((value, index) => value === currentOwners[index]);
      if (same) continue;
      await upsertChannel({
        channelId: channel.channelId,
        name: channel.name,
        discountType: channel.discountType,
        discountRateBps: channel.discountRateBps,
        commissionRateBps: channel.commissionRateBps,
        active: channel.active,
        startsAt: channel.startsAt,
        endsAt: channel.endsAt,
        ownerPhones: nextOwners,
        notes: channel.notes
      });
    }
  }

  const dashboard = await miniProgramUserAdminDashboard();
  return dashboard.users.find((user) => user.userId === userId) || updated;
}

module.exports = {
  miniProgramUserAdminDashboard,
  verifiedUserOptions,
  requireVerifiedPhone,
  updateMiniProgramUserAdmin
};
