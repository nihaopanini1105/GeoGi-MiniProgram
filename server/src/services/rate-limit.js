const buckets = new Map();

function rateLimit({ windowMs = 60 * 1000, max = 60, keyPrefix = 'api' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${clientKey(req)}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
      res.status(429).json({
        ok: false,
        userMessage: '操作过于频繁，请稍后再试'
      });
      return;
    }

    next();
  };
}

function clientKey(req) {
  const forwarded = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return forwarded || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = {
  rateLimit
};
