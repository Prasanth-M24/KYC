const crypto = require('crypto');

const counters = new Map();

function requestSecurityHeaders(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self)');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function simpleRateLimit({ windowMs, maxRequests }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = counters.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    counters.set(key, bucket);

    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please retry shortly.' });
    }

    next();
  };
}

module.exports = {
  requestSecurityHeaders,
  simpleRateLimit,
};
