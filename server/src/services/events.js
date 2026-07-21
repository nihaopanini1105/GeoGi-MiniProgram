function trackEvent(input) {
  const event = String(input.event || '').trim();
  if (!event) {
    return {
      ok: false,
      userMessage: '事件名不能为空'
    };
  }

  console.log('[analytics]', JSON.stringify({
    event,
    params: input.params || {},
    occurredAt: input.occurredAt || new Date().toISOString(),
    source: input.source || 'wechat_miniprogram'
  }));

  return { ok: true };
}

module.exports = {
  trackEvent
};
