import { getConfig } from '../config.js';
import { normalizeIp } from './security.js';

const registeredLimiters = new Set();

/**
 * Pure lazy-pruning in-memory rate limiter (zero setInterval timers, bounded store).
 * Supports bounded RATE_LIMIT_MAX_MULTIPLIER (no production bypass) and test overrides.
 */
export function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 120,
  maxStoreSize = 10_000,
  keyFn = null,
  skip = null,
  configOverrides = {},
  message = 'Trop de requêtes. Veuillez patienter avant de réessayer.',
} = {}) {
  const store = new Map();
  let lastPruneAt = Date.now();

  const limiter = function rateLimitMiddleware(req, res, next) {
    if (typeof skip === 'function' && skip(req)) {
      return next();
    }

    const cfg = getConfig(configOverrides);
    const effectiveMax = Math.max(1, Math.floor(max * cfg.rateLimitMaxMultiplier));
    const now = Date.now();

    if (now - lastPruneAt >= windowMs || store.size >= maxStoreSize) {
      for (const [k, entry] of store.entries()) {
        if (entry.resetAt <= now) {
          store.delete(k);
        }
      }
      lastPruneAt = now;

      while (store.size >= maxStoreSize) {
        const oldestKey = store.keys().next().value;
        if (oldestKey === undefined) break;
        store.delete(oldestKey);
      }
    }

    const rawKey =
      typeof keyFn === 'function'
        ? keyFn(req)
        : normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');
    const key = String(rawKey || 'unknown');

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, effectiveMax - entry.count);
    const resetEpochSec = Math.ceil(entry.resetAt / 1000);

    res.setHeader('X-RateLimit-Limit', String(effectiveMax));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetEpochSec));

    if (entry.count > effectiveMax) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: message,
        code: 'RATE_LIMITED',
      });
    }

    return next();
  };

  limiter.reset = () => {
    store.clear();
    lastPruneAt = Date.now();
  };

  registeredLimiters.add(limiter);
  return limiter;
}

export function createDefaultLimiters({ configOverrides = {}, rateLimitOverrides = {} } = {}) {
  const ov = rateLimitOverrides && typeof rateLimitOverrides === 'object' ? rateLimitOverrides : {};
  const tier = (name, defaultWindowMs, defaultMax, extra = {}) => {
    const custom = ov[name] && typeof ov[name] === 'object' ? ov[name] : {};
    return createRateLimiter({
      windowMs: custom.windowMs ?? defaultWindowMs,
      max: custom.max ?? defaultMax,
      configOverrides,
      ...extra,
    });
  };

  return {
    general: tier('general', 15 * 60 * 1000, 240, {
      skip: (req) => {
        const p = req.path || '';
        return (
          p === '/health' ||
          p === '/ready' ||
          p === '/billing/stripe/webhook' ||
          req.originalUrl?.startsWith('/api/billing/stripe/webhook')
        );
      },
    }),
    auth: tier('auth', 15 * 60 * 1000, 25),
    billing: tier('billing', 15 * 60 * 1000, 30),
    lookup: tier('lookup', 15 * 60 * 1000, 30),
    precheck: tier('precheck', 15 * 60 * 1000, 60),
    share: tier('share', 60 * 1000, 60),
    tools: tier('tools', 60 * 1000, 30),
  };
}

export function resetAllRateLimiters() {
  for (const limiter of registeredLimiters) {
    if (typeof limiter.reset === 'function') {
      limiter.reset();
    }
  }
}
