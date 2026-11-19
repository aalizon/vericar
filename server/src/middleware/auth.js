import crypto from 'node:crypto';
import { getConfig } from '../config.js';
import { findValidSessionWithUser } from '../db/repositories.js';
import { isHttpsRequest, isOriginAllowed } from './security.js';

export const SESSION_COOKIE_NAME = 'vericar_session';

export function parseCookies(cookieHeader) {
  const map = Object.create(null);
  if (!cookieHeader || typeof cookieHeader !== 'string') return map;

  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || Object.prototype.hasOwnProperty.call(map, name)) continue;
    const rawVal = part.slice(idx + 1).trim();
    try {
      map[name] = decodeURIComponent(rawVal);
    } catch {
      map[name] = rawVal;
    }
  }
  return map;
}

export function hashSessionToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

export function shouldUseSecureCookie(req, configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  if (cfg.cookieSecure === false) return false;
  if (cfg.cookieSecure === true) return true;
  return Boolean(cfg.isProduction || isHttpsRequest(req));
}

export function setSessionCookie(res, rawToken, req, configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  const secure = shouldUseSecureCookie(req, configOverrides);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${cfg.session.ttlSeconds}`,
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res, req, configOverrides = {}) {
  const secure = shouldUseSecureCookie(req, configOverrides);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function attachUser(req, _res, next) {
  req.user = null;
  req.sessionTokenHash = null;
  req.hasSessionCookie = false;

  try {
    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 256) {
      return next();
    }

    req.hasSessionCookie = true;
    const tokenHash = hashSessionToken(rawToken);
    const result = findValidSessionWithUser(tokenHash);
    if (result && result.user) {
      req.user = result.user;
      req.sessionTokenHash = tokenHash;
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentification requise.',
      code: 'AUTH_REQUIRED',
    });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentification requise.',
      code: 'AUTH_REQUIRED',
    });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Accès réservé aux administrateurs.',
      code: 'FORBIDDEN',
    });
  }
  return next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfOriginCheck(configOverrides = {}) {
  return function csrfGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    if (req.originalUrl && req.originalUrl.startsWith('/api/billing/stripe/webhook')) {
      return next();
    }

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!isOriginAllowed(origin, req, configOverrides)) {
        return res.status(403).json({
          error: 'Origine de requête non autorisée (protection CSRF).',
          code: 'CSRF_ORIGIN_MISMATCH',
        });
      }
      return next();
    }

    if (req.hasSessionCookie || req.user) {
      const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
      if (secFetchSite === 'cross-site') {
        return res.status(403).json({
          error: 'Origine de requête non autorisée (protection CSRF).',
          code: 'CSRF_ORIGIN_MISMATCH',
        });
      }

      const referer = req.headers.referer;
      if (referer !== undefined) {
        let refOrigin = null;
        try {
          refOrigin = new URL(String(referer)).origin;
        } catch {
          refOrigin = null;
        }
        if (!refOrigin || !isOriginAllowed(refOrigin, req, configOverrides)) {
          return res.status(403).json({
            error: 'Origine de requête non autorisée (protection CSRF).',
            code: 'CSRF_ORIGIN_MISMATCH',
          });
        }
      }
    }

    return next();
  };
}
