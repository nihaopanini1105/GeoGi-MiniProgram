const {
  BASE_PRICE_FEN,
  listChannels,
  upsertChannel,
  quoteChannelCode,
  listCommissionRecords,
  reconcileCommission,
  settleChannelPeriod
} = require('./channel-store');
const { listPaymentOrders } = require('./payment-store');

function yuan(fen) {
  return Number(fen || 0) / 100;
}

function percentFromBps(value) {
  return Number(value || 0) / 100;
}

function monthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 7);
}

function paymentCompleted(order) {
  return Boolean(order && ['paid', 'refund_processing', 'partially_refunded', 'refunded', 'free'].includes(String(order.status || '')));
}

async function quoteRedemptionCode(code) {
  const quote = await quoteChannelCode(code);
  return {
    ok: true,
    applied: quote.applied,
    redemptionCode: quote.promotionCode,
    channelId: quote.channelId,
    channelName: quote.channelName,
    discountType: quote.discountType,
    discountRateBps: quote.discountRateBps,
    discountPercent: quote.discountType === 'free' ? 100 : Math.max(0, 100 - percentFromBps(quote.discountRateBps)),
    listPriceFen: quote.listPriceFen,
    listPriceYuan: yuan(quote.listPriceFen),
    discountFen: quote.discountFen,
    discountYuan: yuan(quote.discountFen),
    payableFen: quote.payableFen,
    payableYuan: yuan(quote.payableFen),
    commissionRateBps: quote.commissionRateBps
  };
}

async function channelDashboardForPhone(phoneNumber) {
  const phone = String(phoneNumber || '').trim();
  if (!phone) return { ok: true, isChannel: false, channels: [], monthly: [] };
  const [channels, orders, commissions] = await Promise.all([
    listChannels(),
    listPaymentOrders(),
    listCommissionRecords()
  ]);
  const owned = channels.filter((channel) => Array.isArray(channel.ownerPhones) && channel.ownerPhones.includes(phone));
  if (!owned.length) return { ok: true, isChannel: false, channels: [], monthly: [] };

  const ownedIds = new Set(owned.map((channel) => channel.channelId));
  const channelOrders = orders.filter((order) => ownedIds.has(order.channelId));
  const channelCommissions = commissions.filter((item) => ownedIds.has(item.channelId));
  const currentPeriod = monthKey();

  const summaries = owned.map((channel) => {
    const rows = channelOrders.filter((order) => order.channelId === channel.channelId);
    const commissionRows = channelCommissions.filter((item) => item.channelId === channel.channelId);
    const grossFen = rows.reduce((sum, order) => sum + (paymentCompleted(order) ? Number(order.amountTotal || 0) : 0), 0);
    const pendingCommissionFen = commissionRows.reduce((sum, item) => sum + Number(item.dueFen || 0), 0);
    const paidCommissionFen = commissionRows.reduce((sum, item) => sum + Number(item.payoutFen || 0), 0);
    return {
      channelId: channel.channelId,
      name: channel.name,
      code: channel.code,
      active: channel.active,
      discountType: channel.discountType,
      discountRateBps: channel.discountRateBps,
      commissionRateBps: channel.commissionRateBps,
      startsAt: channel.startsAt,
      endsAt: channel.endsAt,
      promotedOrders: rows.length,
      paidOrders: rows.filter(paymentCompleted).length,
      completedReports: commissionRows.filter((item) => item.reportReleasedAt).length,
      grossPaidYuan: yuan(grossFen),
      pendingCommissionYuan: yuan(pendingCommissionFen),
      paidCommissionYuan: yuan(paidCommissionFen)
    };
  });

  const periods = [...new Set([
    currentPeriod,
    ...channelOrders.map((order) => String(order.createdAt || '').slice(0, 7)).filter(Boolean),
    ...channelCommissions.map((item) => item.period).filter(Boolean)
  ])].sort().reverse();

  const monthly = periods.map((period) => {
    const orderRows = channelOrders.filter((order) => String(order.createdAt || '').slice(0, 7) === period);
    const commissionRows = channelCommissions.filter((item) => item.period === period);
    const grossFen = orderRows.reduce((sum, order) => sum + (paymentCompleted(order) ? Number(order.amountTotal || 0) : 0), 0);
    const pendingFen = commissionRows.reduce((sum, item) => sum + Number(item.dueFen || 0), 0);
    const paidFen = commissionRows.reduce((sum, item) => sum + Number(item.payoutFen || 0), 0);
    return {
      period,
      promotedOrders: orderRows.length,
      paidOrders: orderRows.filter(paymentCompleted).length,
      completedReports: commissionRows.filter((item) => item.reportReleasedAt).length,
      grossPaidYuan: yuan(grossFen),
      pendingCommissionYuan: yuan(pendingFen),
      paidCommissionYuan: yuan(paidFen)
    };
  });

  const recentOrders = channelOrders
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 30)
    .map((order) => ({
      projectId: order.projectId,
      brandName: order.brandName,
      channelId: order.channelId,
      channelName: order.channelName,
      redemptionCode: order.promotionCode,
      listPriceYuan: yuan(order.listPriceFen || BASE_PRICE_FEN),
      paidAmountYuan: yuan(order.amountTotal || 0),
      status: order.status,
      createdAt: order.createdAt,
      paidAt: order.paidAt || ''
    }));

  return {
    ok: true,
    isChannel: true,
    currentPeriod,
    channels: summaries,
    monthly,
    recentOrders
  };
}

async function channelAdminDashboard() {
  const [channels, orders, commissions] = await Promise.all([
    listChannels(),
    listPaymentOrders(),
    listCommissionRecords()
  ]);
  const rows = channels.map((channel) => {
    const channelOrders = orders.filter((order) => order.channelId === channel.channelId);
    const channelCommissions = commissions.filter((item) => item.channelId === channel.channelId);
    const grossFen = channelOrders.reduce((sum, order) => sum + (paymentCompleted(order) ? Number(order.amountTotal || 0) : 0), 0);
    const refundedFen = channelOrders.reduce((sum, order) => sum + Number(order.refundedAmount || 0), 0);
    const pendingFen = channelCommissions.reduce((sum, item) => sum + Number(item.dueFen || 0), 0);
    const paidFen = channelCommissions.reduce((sum, item) => sum + Number(item.payoutFen || 0), 0);
    return {
      ...channel,
      discountPercent: channel.discountType === 'free' ? 100 : Math.max(0, 100 - percentFromBps(channel.discountRateBps)),
      commissionPercent: percentFromBps(channel.commissionRateBps),
      orderCount: channelOrders.length,
      paidOrderCount: channelOrders.filter(paymentCompleted).length,
      completedReportCount: channelCommissions.filter((item) => item.reportReleasedAt).length,
      grossPaidYuan: yuan(grossFen),
      refundedYuan: yuan(refundedFen),
      pendingCommissionYuan: yuan(pendingFen),
      paidCommissionYuan: yuan(paidFen)
    };
  });

  return {
    ok: true,
    channels: rows,
    orders: orders
      .filter((order) => order.channelId)
      .map((order) => ({
        ...order,
        listPriceYuan: yuan(order.listPriceFen || BASE_PRICE_FEN),
        amountYuan: yuan(order.amountTotal || 0),
        refundedYuan: yuan(order.refundedAmount || 0)
      })),
    commissions,
    monthly: buildAdminMonthly(rows, orders, commissions)
  };
}

function buildAdminMonthly(channels, orders, commissions) {
  const periods = [...new Set([
    ...orders.filter((order) => order.channelId).map((order) => String(order.createdAt || '').slice(0, 7)).filter(Boolean),
    ...commissions.map((item) => item.period).filter(Boolean)
  ])].sort().reverse();
  return periods.flatMap((period) => channels.map((channel) => {
    const orderRows = orders.filter((order) => order.channelId === channel.channelId && String(order.createdAt || '').slice(0, 7) === period);
    const commissionRows = commissions.filter((item) => item.channelId === channel.channelId && item.period === period);
    if (!orderRows.length && !commissionRows.length) return null;
    const grossFen = orderRows.reduce((sum, order) => sum + (paymentCompleted(order) ? Number(order.amountTotal || 0) : 0), 0);
    const pendingFen = commissionRows.reduce((sum, item) => sum + Number(item.dueFen || 0), 0);
    const paidFen = commissionRows.reduce((sum, item) => sum + Number(item.payoutFen || 0), 0);
    return {
      period,
      channelId: channel.channelId,
      channelName: channel.name,
      orderCount: orderRows.length,
      paidOrderCount: orderRows.filter(paymentCompleted).length,
      completedReportCount: commissionRows.filter((item) => item.reportReleasedAt).length,
      grossPaidYuan: yuan(grossFen),
      pendingCommissionYuan: yuan(pendingFen),
      paidCommissionYuan: yuan(paidFen)
    };
  }).filter(Boolean));
}

module.exports = {
  quoteRedemptionCode,
  channelDashboardForPhone,
  channelAdminDashboard,
  upsertChannel,
  reconcileCommission,
  settleChannelPeriod
};
