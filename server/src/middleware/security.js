import crypto from 'node:crypto';
import { getConfig } from '../config.js';

export class AppError extends Error {
  constructor(status, code, message, details = undefined, extra = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.extra = extra;
    this.isOperational = true;
  }
}

export function asyncHandler(fn) {
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return 'unknown';
  const cleaned = rawIp.trim();
  if (cleaned.startsWith('::ffff:')) {
    return cleaned.slice(7);
  }
  return cleaned || 'unknown';
}

export function isHttpsRequest(req) {
  if (!req) return false;
  if (req.secure) return true;
  const xfProto = req.headers?.['x-forwarded-proto'];
  if (typeof xfProto === 'string' && xfProto.trim()) {
    const firstProto = xfProto.split(',')[0].trim().toLowerCase();
    return firstProto === 'https';
  }
  return false;
}

/**
 * Validates whether an Origin header is allowed via explicit CORS allowlist
 * or exact same-origin match against the incoming request Host/protocol.
 */
export function isOriginAllowed(origin, req, configOverrides = {}) {
  if (!origin || typeof origin !== 'string' || origin === 'null') {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const normalizedOrigin = parsed.origin;
  const cfg = getConfig(configOverrides);
  const allowlist = new Set(cfg.corsOrigins);

  if (allowlist.has(normalizedOrigin)) {
    return true;
  }

  // Same-origin fallback (critical for ephemeral ports & PaaS preview hostnames)
  const reqHost = typeof req?.get === 'function' ? req.get('host') : req?.headers?.host;
  if (reqHost && typeof reqHost === 'string') {
    const reqProto = isHttpsRequest(req) ? 'https:' : 'http:';
    if (parsed.host.toLowerCase() === reqHost.trim().toLowerCase() && parsed.protocol === reqProto) {
      return true;
    }
  }

  return false;
}

const SENSITIVE_KEY_RE =
  /(authorization|cookie|set-cookie|password|passwd|token|secret|apikey|api_key|api-key|stripe-signature|svv-authorization)/i;

const SENSITIVE_QUERY_PARAM_RE =
  /^(token|apikey|api_key|secret|password|passwd|authorization|cookie|key)$/i;

export function redactSensitive(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen));
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redactSensitive(val, seen);
    }
  }
  return out;
}

export function redactUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    let pathname = parsed.pathname;
    if (/^\/api\/share\/[^/]+/i.test(pathname)) {
      pathname = pathname.replace(/^(\/api\/share\/)[^/]+/i, '$1[REDACTED]');
    }
    const params = new URLSearchParams(parsed.search);
    let hasQuery = false;
    for (const [k] of params.entries()) {
      hasQuery = true;
      if (SENSITIVE_QUERY_PARAM_RE.test(k)) {
        params.set(k, '[REDACTED]');
      }
    }
    const queryStr = hasQuery ? `?${params.toString()}` : '';
    return `${pathname}${queryStr}`;
  } catch {
    return rawUrl.split('?')[0];
  }
}

function sanitizeRequestId(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9._-]{4,64}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function requestLoggerMiddleware(configOverrides = {}) {
  return function requestLogger(req, res, next) {
    const startNs = process.hrtime.bigint();
    const requestId = sanitizeRequestId(req.headers['x-request-id']) || crypto.randomBytes(6).toString('hex');
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const cfg = getConfig(configOverrides);
      if (cfg.logLevel === 'silent') return;
      if (cfg.isTest && process.env.LOG_REQUESTS !== '1') return;

      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const logLine = redactSensitive({
        level: 'info',
        ts: new Date().toISOString(),
        requestId,
        method: req.method,
        path: redactUrl(req.originalUrl || req.url),
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        ip: normalizeIp(req.ip || req.socket?.remoteAddress),
        userId: req.user?.id || null,
      });
      console.log(JSON.stringify(logLine));
    });

    next();
  };
}

export function securityHeadersMiddleware(configOverrides = {}) {
  const cspValue = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self' https://checkout.stripe.com",
  ].join('; ');

  return function securityHeaders(req, res, next) {
    const cfg = getConfig(configOverrides);

    res.setHeader('Content-Security-Policy', cspValue);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

    if (isHttpsRequest(req) || (cfg.isProduction && /^https:\/\//i.test(cfg.appUrl))) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  };
}

export function createCorsMiddleware(configOverrides = {}) {
  return function corsGuard(req, res, next) {
    res.vary('Origin');
    const origin = req.headers.origin;
    if (!origin) {
      return next();
    }

    if (isOriginAllowed(origin, req, configOverrides)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '600');

      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
      return next();
    }

    if (req.method === 'OPTIONS') {
      return res.status(403).json({
        error: 'Origine CORS non autorisée.',
        code: 'CORS_FORBIDDEN',
      });
    }

    return next();
  };
}

export function jsonErrorGuard(err, _req, res, next) {
  if (!err) return next();
  if (
    err.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && err.status === 400 && 'body' in err)
  ) {
    return res.status(400).json({
      error: 'Corps de requête JSON malformé.',
      code: 'INVALID_JSON',
    });
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'Corps de requête trop volumineux.',
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  return next(err);
}

export function apiNotFoundHandler(_req, res) {
  return res.status(404).json({
    error: 'Endpoint introuvable',
    code: 'NOT_FOUND',
  });
}

export function centralErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (
    err?.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && err?.status === 400 && 'body' in err)
  ) {
    return res.status(400).json({
      error: 'Corps de requête JSON malformé.',
      code: 'INVALID_JSON',
    });
  }

  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      error: 'Corps de requête trop volumineux.',
      code: 'PAYLOAD_TOO_LARGE',
    });
  }

  if (err instanceof AppError || err?.isOperational) {
    const payload = {
      error: err.message || 'Requête invalide.',
      code: err.code || 'ERROR',
    };
    if (err.details !== undefined) {
      payload.details = err.details;
    }
    if (err.extra && typeof err.extra === 'object') {
      for (const [k, v] of Object.entries(err.extra)) {
        if (k !== 'error' && k !== 'code' && v !== undefined) {
          payload[k] = v;
        }
      }
    }
    if (
      payload.creditsBalance === undefined &&
      err.code === 'INSUFFICIENT_CREDITS' &&
      err.details &&
      typeof err.details.creditsBalance === 'number'
    ) {
      payload.creditsBalance = err.details.creditsBalance;
    }
    return res.status(err.status || 400).json(payload);
  }

  const cfg = getConfig();
  if (cfg.logLevel !== 'silent') {
    console.error(
      JSON.stringify({
        level: 'error',
        ts: new Date().toISOString(),
        requestId: req?.requestId || null,
        method: req?.method || null,
        path: redactUrl(req?.originalUrl || req?.url || ''),
        errName: err?.name || 'Error',
        errCode: err?.code || null,
      })
    );
  }

  return res.status(500).json({
    error: 'Erreur interne du serveur.',
    code: 'INTERNAL_ERROR',
  });
}
