const fs = require('fs');
const https = require('https');
const path = require('path');
const {
  BASE_PRICE_FEN,
  listChannels,
  listSources,
  ensureDefaultOfficialSources,
  upsertChannel,
  upsertSource,
  resolveSourceToken,
  recordSourceVisit,
  listSourceVisits,
  listCommissionRecords,
  reconcileCommission,
  settleChannelPeriod
} = require('./channel-store');
const { listPaymentOrders } = require('./payment-store');

function yuan(fen) { return Number(fen || 0) / 100; }
function percentFromBps(value) { return Number(value || 0) / 100; }

function monthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 7);
}

function paymentCompleted(order) {
  return Boolean(order && ['paid', 'refund_processing', 'partially_refunded', 'refunded', 'free'].includes(String(order.status || '')));
}

function sourceTypeLabel(value) {
  return {
    website: '官网',
    official_account: '公众号',
    business_card: '名片',
    channel: '渠道分享'
  }[String(value || '')] || String(value || '');
}

async function resolveAttribution(token, visitorId = '') {
  const attribution = await resolveSourceToken(token);
  if (attribution.sourceId) {
    await recordSourceVisit({ attribution, visitorId });
  }
  return {
    ok: true,
    applied: attribution.applied,
    sourceId: attribution.sourceId,
    sourceToken: attribution.sourceToken,
    sourceName: attribution.sourceName,
    sourceType: attribution.sourceType,
    sourceTypeLabel: sourceTypeLabel(attribution.sourceType),
    sourceActive: attribution.sourceActive,
    channelId: attribution.channelId,
    channelName: attribution.channelName,
    channelBenefitActive: attribution.channelBenefitActive,
    listPriceFen: attribution.listPriceFen,
    listPriceYuan: yuan(attribution.listPriceFen),
    discountFen: attribution.discountFen,
    discountYuan: yuan(attribution.discountFen),
    payableFen: attribution.payableFen,
    payableYuan: yuan(attribution.payableFen),
    discountType: attribution.discountType,
    discountRateBps: attribution.discountRateBps
  };
}

async function channelDashboardForPhone(phoneNumber) {
  const phone = String(phoneNumber || '').trim();
  if (!phone) return { ok: true, isChannel: false, channels: [], monthly: [], recentOrders: [] };
  const [channels, sources, visits, orders, commissions] = await Promise.all([
    listChannels(),
    listSources(),
    listSourceVisits(),
    listPaymentOrders(),
    listCommissionRecords()
  ]);
  const owned = channels.filter((channel) => Array.isArray(channel.ownerPhones) && channel.ownerPhones.includes(phone));
  if (!owned.length) return { ok: true, isChannel: false, channels: [], monthly: [], recentOrders: [] };

  const ownedIds = new Set(owned.map((channel) => channel.channelId));
  const channelOrders = orders.filter((order) => ownedIds.has(order.channelId));
  const channelCommissions = commissions.filter((item) => ownedIds.has(item.channelId));
  const currentPeriod = monthKey();

  const summaries = owned.map((channel) => {
    const rows = channelOrders.filter((order) => order.channelId === channel.channelId);
    const commissionRows = channelCommissions.filter((item) => item.channelId === channel.channelId);
    const shareSource = sources.find((source) => source.channelId === channel.channelId && source.sourceType === 'channel' && source.notes === 'auto_channel_share')
      || sources.find((source) => source.channelId === channel.channelId && source.sourceType === 'channel')
      || null;
    const channelSourceIds = new Set(sources.filter((source) => source.channelId === channel.channelId).map((source) => source.sourceId));
    const channelVisits = visits.filter((visit) => channelSourceIds.has(visit.sourceId));
    const grossFen = rows.reduce((sum, order) => sum + (paymentCompleted(order) ? Number(order.amountTotal || 0) : 0), 0);
    const pendingCommissionFen = commissionRows.reduce((sum, item) => sum + Number(item.dueFen || 0), 0);
    const paidCommissionFen = commissionRows.reduce((sum, item) => sum + Number(item.payoutFen || 0), 0);
    return {
      channelId: channel.channelId,
      name: channel.name,
      active: channel.active,
      discountType: channel.discountType,
      discountRateBps: channel.discountRateBps,
      commissionRateBps: channel.commissionRateBps,
      startsAt: channel.startsAt,
      endsAt: channel.endsAt,
      shareSourceToken: shareSource && shareSource.token || '',
      sharePath: shareSource ? '/pages/index/index?src=' + encodeURIComponent(shareSource.token) : '/pages/index/index',
      visits: channelVisits.length,
      uniqueVisitors: new Set(channelVisits.map((item) => item.visitorId).filter(Boolean)).size,
      promotedOrders: rows.length,
      paidOrders: rows.filter(paymentCompleted).length,
      completedReports: rows.filter((order) => order.reportReleasedAt).length,
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
      completedReports: orderRows.filter((order) => order.reportReleasedAt).length,
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
      sourceName: order.sourceName || '',
      sourceType: order.sourceType || '',
      listPriceYuan: yuan(order.listPriceFen || BASE_PRICE_FEN),
      paidAmountYuan: yuan(order.amountTotal || 0),
      status: order.status,
      createdAt: order.createdAt,
      paidAt: order.paidAt || '',
      reportReleasedAt: order.reportReleasedAt || ''
    }));

  return { ok: true, isChannel: true, currentPeriod, channels: summaries, monthly, recentOrders };
}

function sourceMetrics(source, visits, orders) {
  const sourceVisits = visits.filter((item) => item.sourceId === source.sourceId);
  const sourceOrders = orders.filter((item) => item.sourceId === source.sourceId);
  return {
    visits: sourceVisits.length,
    uniqueVisitors: new Set(sourceVisits.map((item) => item.visitorId).filter(Boolean)).size,
    submittedOrders: sourceOrders.length,
    paidOrders: sourceOrders.filter(paymentCompleted).length,
    completedReports: sourceOrders.filter((item) => item.reportReleasedAt).length,
    grossPaidYuan: yuan(sourceOrders.reduce((sum, item) => sum + (paymentCompleted(item) ? Number(item.amountTotal || 0) : 0), 0))
  };
}

async function channelAdminDashboard() {
  await ensureDefaultOfficialSources();
  const [channels, sources, visits, orders, commissions] = await Promise.all([
    listChannels(),
    listSources(),
    listSourceVisits(),
    listPaymentOrders(),
    listCommissionRecords()
  ]);
  const sourceRows = sources.map((source) => ({
    ...source,
    sourceTypeLabel: sourceTypeLabel(source.sourceType),
    channelName: (channels.find((channel) => channel.channelId === source.channelId) || {}).name || '',
    miniProgramPath: '/pages/index/index?src=' + encodeURIComponent(source.token),
    codeUrl: fs.existsSync(path.join(sourceCodeRoot(), source.sourceId.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.png'))
      ? String(process.env.GEOGI_PUBLIC_BASE_URL || 'https://api.geogi.cn').replace(/\/+$/, '') + '/source-codes/' + encodeURIComponent(source.sourceId.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.png')
      : '',
    ...sourceMetrics(source, visits, orders)
  }));
  const channelRows = channels.map((channel) => {
    const channelOrders = orders.filter((order) => order.channelId === channel.channelId);
    const channelCommissions = commissions.filter((item) => item.channelId === channel.channelId);
    const channelSources = sourceRows.filter((source) => source.channelId === channel.channelId);
    const grossFen = channelOrders.reduce((sum, order) => sum + (paymentCompleted(order) ? Number(order.amountTotal || 0) : 0), 0);
    const refundedFen = channelOrders.reduce((sum, order) => sum + Number(order.refundedAmount || 0), 0);
    const pendingFen = channelCommissions.reduce((sum, item) => sum + Number(item.dueFen || 0), 0);
    const paidFen = channelCommissions.reduce((sum, item) => sum + Number(item.payoutFen || 0), 0);
    return {
      ...channel,
      discountPercent: channel.discountType === 'free' ? 100 : Math.max(0, 100 - percentFromBps(channel.discountRateBps)),
      commissionPercent: percentFromBps(channel.commissionRateBps),
      visits: channelSources.reduce((sum, source) => sum + Number(source.visits || 0), 0),
      orderCount: channelOrders.length,
      paidOrderCount: channelOrders.filter(paymentCompleted).length,
      completedReportCount: channelOrders.filter((order) => order.reportReleasedAt).length,
      grossPaidYuan: yuan(grossFen),
      refundedYuan: yuan(refundedFen),
      pendingCommissionYuan: yuan(pendingFen),
      paidCommissionYuan: yuan(paidFen)
    };
  });

  return {
    ok: true,
    channels: channelRows,
    sources: sourceRows,
    orders: orders
      .filter((order) => order.sourceId || order.channelId)
      .map((order) => ({
        ...order,
        listPriceYuan: yuan(order.listPriceFen || BASE_PRICE_FEN),
        amountYuan: yuan(order.amountTotal || 0),
        refundedYuan: yuan(order.refundedAmount || 0)
      })),
    commissions,
    monthly: buildAdminMonthly(channelRows, orders, commissions)
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
      completedReportCount: orderRows.filter((order) => order.reportReleasedAt).length,
      grossPaidYuan: yuan(grossFen),
      pendingCommissionYuan: yuan(pendingFen),
      paidCommissionYuan: yuan(paidFen)
    };
  }).filter(Boolean));
}

function sourceCodeRoot() {
  if (process.env.GEOGI_SOURCE_CODE_ROOT) return process.env.GEOGI_SOURCE_CODE_ROOT;
  if (process.env.GEOGI_PAYMENT_DATA_ROOT) {
    return path.join(path.dirname(process.env.GEOGI_PAYMENT_DATA_ROOT), 'source-codes');
  }
  return path.join(__dirname, '../../data/source-codes');
}

function requestJson({ method, hostname, requestPath, body }) {
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname,
      path: requestPath,
      headers: bodyText ? {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(bodyText)
      } : {},
      timeout: 15000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let parsed = {};
        try { parsed = JSON.parse(buffer.toString('utf8')); } catch (_error) {}
        if (res.statusCode < 200 || res.statusCode >= 300 || (parsed && parsed.errcode)) {
          reject(new Error('WECHAT_SOURCE_CODE_REQUEST_FAILED:' + String(parsed.errmsg || parsed.errcode || res.statusCode)));
          return;
        }
        resolve({ buffer, parsed, contentType: String(res.headers['content-type'] || '') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('WECHAT_SOURCE_CODE_TIMEOUT')));
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

async function wechatAccessToken() {
  const appid = String(process.env.WECHAT_APP_ID || process.env.WECHAT_MINI_PROGRAM_APPID || '').trim();
  const secret = String(process.env.WECHAT_APP_SECRET || process.env.WECHAT_MINI_PROGRAM_SECRET || '').trim();
  if (!appid || !secret) throw new Error('WECHAT_SOURCE_CODE_NOT_CONFIGURED');
  const result = await requestJson({
    method: 'GET',
    hostname: 'api.weixin.qq.com',
    requestPath: '/cgi-bin/token?grant_type=client_credential&appid=' + encodeURIComponent(appid) + '&secret=' + encodeURIComponent(secret)
  });
  if (!result.parsed.access_token) throw new Error('WECHAT_SOURCE_CODE_TOKEN_FAILED');
  return result.parsed.access_token;
}

async function generateSourceMiniProgramCode(sourceId) {
  const sources = await listSources();
  const source = sources.find((item) => item.sourceId === String(sourceId || '').trim());
  if (!source) throw new Error('SOURCE_NOT_FOUND');
  const token = await wechatAccessToken();
  const result = await requestJson({
    method: 'POST',
    hostname: 'api.weixin.qq.com',
    requestPath: '/wxa/getwxacodeunlimit?access_token=' + encodeURIComponent(token),
    body: {
      scene: source.token,
      page: 'pages/index/index',
      check_path: false,
      env_version: 'release',
      width: 430
    }
  });
  if (result.contentType.includes('application/json')) {
    throw new Error('WECHAT_SOURCE_CODE_GENERATION_FAILED');
  }
  const root = sourceCodeRoot();
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const fileName = source.sourceId.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.png';
  await fs.promises.writeFile(path.join(root, fileName), result.buffer, { mode: 0o600 });
  const base = String(process.env.GEOGI_PUBLIC_BASE_URL || 'https://api.geogi.cn').replace(/\/+$/, '');
  return {
    ok: true,
    sourceId: source.sourceId,
    sourceToken: source.token,
    sourceName: source.name,
    sourceType: source.sourceType,
    miniProgramPath: '/pages/index/index?src=' + encodeURIComponent(source.token),
    miniProgramScene: source.token,
    codeUrl: base + '/source-codes/' + encodeURIComponent(fileName)
  };
}

module.exports = {
  resolveAttribution,
  channelDashboardForPhone,
  channelAdminDashboard,
  upsertChannel,
  upsertSource,
  reconcileCommission,
  settleChannelPeriod,
  generateSourceMiniProgramCode,
  sourceCodeRoot,
  sourceTypeLabel
};
