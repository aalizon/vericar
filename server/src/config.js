import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const SERVER_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_DB_PATH = path.resolve(fileURLToPath(new URL('../data/vericar.db', import.meta.url)));

const SERVER_ENV_PATH = path.join(SERVER_ROOT, '.env');
const ROOT_ENV_PATH = path.join(REPO_ROOT, '.env');

let cachedAppVersion = null;
function readAppVersion() {
  if (cachedAppVersion) return cachedAppVersion;
  try {
    const pkgPath = path.join(SERVER_ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    cachedAppVersion = typeof pkg.version === 'string' && pkg.version ? pkg.version : '1.0.0';
  } catch {
    cachedAppVersion = '1.0.0';
  }
  return cachedAppVersion;
}

/**
 * Loads server/.env then root .env relative to this module (CWD-safe),
 * without overriding already-set process.env variables.
 */
export function loadEnvFiles() {
  if (process.env.VERICAR_SKIP_DOTENV === '1') return;
  if (fs.existsSync(SERVER_ENV_PATH)) {
    dotenv.config({ path: SERVER_ENV_PATH, override: false });
  }
  if (fs.existsSync(ROOT_ENV_PATH)) {
    dotenv.config({ path: ROOT_ENV_PATH, override: false });
  }
}

loadEnvFiles();

/**
 * Canonical frozen credit packs (Single Source of Truth per PROJECT.md).
 */
export const CREDIT_PACKS = Object.freeze([
  Object.freeze({
    id: 'pack_1',
    name: 'Pack Découverte',
    credits: 1,
    amountCents: 1490,
    unitPriceCents: 1490,
    pricePerCreditCents: 1490,
    currency: 'EUR',
    popular: false,
    savingsPercent: 0,
    tagline: 'Pour vérifier un véhicule précis avant votre visite',
    features: Object.freeze([
      '1 rapport complet Europe (9 sections)',
      'Pré-vérification gratuite illimitée',
      'Lien de partage vérifié & export PDF',
      'Crédits sans date d’expiration',
    ]),
  }),
  Object.freeze({
    id: 'pack_2',
    name: 'Pack Acheteur',
    credits: 2,
    amountCents: 2490,
    unitPriceCents: 1245,
    pricePerCreditCents: 1245,
    currency: 'EUR',
    popular: true,
    savingsPercent: 16,
    tagline: 'Le plus populaire pour comparer 2 annonces',
    features: Object.freeze([
      '2 rapports complets Europe (9 sections)',
      'Comparateur côte à côte inclus',
      'Lien de partage vérifié & export PDF',
      'Crédits sans date d’expiration',
    ]),
  }),
  Object.freeze({
    id: 'pack_3',
    name: 'Pack Comparateur',
    credits: 3,
    amountCents: 3290,
    unitPriceCents: 1097,
    pricePerCreditCents: 1097,
    currency: 'EUR',
    popular: false,
    savingsPercent: 26,
    tagline: 'Idéal pour sécuriser toute votre recherche',
    features: Object.freeze([
      '3 rapports complets Europe (9 sections)',
      'Comparateur & historique illimité',
      'Lien de partage vérifié & export PDF',
      'Crédits sans date d’expiration',
    ]),
  }),
  Object.freeze({
    id: 'pack_pro_10',
    name: 'Pack Pro / Marchand',
    credits: 10,
    amountCents: 7990,
    unitPriceCents: 799,
    pricePerCreditCents: 799,
    currency: 'EUR',
    popular: false,
    savingsPercent: 46,
    tagline: 'Tarif dégressif pour pros, mandataires et marchands VO',
    features: Object.freeze([
      '10 rapports complets Europe (9 sections)',
      'Factures TVA 20 % téléchargeables',
      'Partage client vérifié & export PDF',
      'Crédits sans date d’expiration',
    ]),
  }),
]);

export function getCreditPackById(packId) {
  if (typeof packId !== 'string') return null;
  return CREDIT_PACKS.find((p) => p.id === packId) || null;
}

function parsePositiveInt(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseNonNegativeInt(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function parseTrustProxy(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1;
  const s = String(raw).trim().toLowerCase();
  if (s === 'false' || s === '0') return false;
  if (s === 'true') return true;
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  return String(raw).trim();
}

function parseOptionalBoolean(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}

function normalizeOrigin(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*' || trimmed === 'null') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseCorsOrigins(raw, appUrl, port, isProduction) {
  const set = new Set();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizeOrigin(item);
      if (normalized) set.add(normalized);
    }
  } else if (typeof raw === 'string' && raw.trim()) {
    for (const part of raw.split(',')) {
      const normalized = normalizeOrigin(part);
      if (normalized) set.add(normalized);
    }
  }

  const appOrigin = normalizeOrigin(appUrl);
  if (appOrigin) set.add(appOrigin);

  if (!isProduction) {
    set.add('http://localhost:5173');
    set.add('http://127.0.0.1:5173');
    set.add(`http://localhost:${port}`);
    set.add(`http://127.0.0.1:${port}`);
  }

  return Array.from(set);
}

/**
 * Precedence: explicitPath > process.env.DB_PATH > process.env.DATA_DIR/vericar.db > DEFAULT_DB_PATH.
 */
export function resolveDbPath(explicitPath) {
  if (explicitPath !== undefined && explicitPath !== null && String(explicitPath).trim() !== '') {
    const clean = String(explicitPath).trim();
    if (clean === ':memory:') return ':memory:';
    return path.resolve(clean);
  }

  const envDbPath = typeof process.env.DB_PATH === 'string' ? process.env.DB_PATH.trim() : '';
  if (envDbPath) {
    if (envDbPath === ':memory:') return ':memory:';
    return path.isAbsolute(envDbPath) ? envDbPath : path.resolve(SERVER_ROOT, envDbPath);
  }

  const envDataDir = typeof process.env.DATA_DIR === 'string' ? process.env.DATA_DIR.trim() : '';
  if (envDataDir) {
    const resolvedDir = path.isAbsolute(envDataDir) ? envDataDir : path.resolve(SERVER_ROOT, envDataDir);
    return path.join(resolvedDir, 'vericar.db');
  }

  return DEFAULT_DB_PATH;
}

/**
 * Dynamically computes configuration from live process.env on every call
 * so runtime/test environment toggles take effect immediately.
 */
export function getConfig(overrides = {}) {
  const ov = overrides && typeof overrides === 'object' ? overrides : {};

  const nodeEnv = String(ov.nodeEnv ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase() || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';
  const port = parsePositiveInt(ov.port ?? process.env.PORT, 3001);

  const rawAppUrl = String(ov.appUrl ?? process.env.APP_URL ?? `http://localhost:${port}`).trim();
  const appUrl = rawAppUrl.replace(/\/+$/, '') || `http://localhost:${port}`;

  const trustProxy = ov.trustProxy !== undefined ? ov.trustProxy : parseTrustProxy(process.env.TRUST_PROXY);
  const corsOrigins = parseCorsOrigins(
    ov.corsOrigins ?? ov.corsOrigin ?? process.env.CORS_ORIGIN,
    appUrl,
    port,
    isProduction
  );

  const ttlDays = parsePositiveInt(ov.sessionTtlDays ?? process.env.SESSION_TTL_DAYS, 7);
  const ttlSeconds = ttlDays * 24 * 60 * 60;
  const cookieSecure = ov.cookieSecure !== undefined ? ov.cookieSecure : parseOptionalBoolean(process.env.COOKIE_SECURE);

  const signupBonusCredits = parseNonNegativeInt(
    ov.signupBonusCredits ?? process.env.SIGNUP_BONUS_CREDITS,
    1
  );

  const rawAdminEmail = String(ov.adminEmail ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const rawAdminPassword = String(ov.adminPassword ?? process.env.ADMIN_PASSWORD ?? '');
  const adminName = String(ov.adminName ?? process.env.ADMIN_NAME ?? 'Administrateur VériCar').trim() || 'Administrateur VériCar';

  const stripeSecretKey = String(ov.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY ?? '').trim();
  const stripeWebhookSecret = String(ov.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  const stripeConfigured = stripeSecretKey.length > 0;

  const rawAllowSandbox = ov.allowSandboxBilling ?? process.env.ALLOW_SANDBOX_BILLING ?? 'true';
  const allowSandboxFlag = !['false', '0', 'no'].includes(String(rawAllowSandbox).trim().toLowerCase());
  const sandboxEnabled = !stripeConfigured && allowSandboxFlag;
  const billingMode = stripeConfigured ? 'stripe' : sandboxEnabled ? 'sandbox' : 'unavailable';

  const rawMultiplier = Number(ov.rateLimitMaxMultiplier ?? process.env.RATE_LIMIT_MAX_MULTIPLIER ?? 1);
  const finiteMultiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
  const rateLimitMaxMultiplier = isProduction
    ? Math.min(5, Math.max(1, finiteMultiplier))
    : Math.min(100, Math.max(0.1, finiteMultiplier));

  const logLevel = String(
    ov.logLevel ?? process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info')
  ).trim().toLowerCase();

  const legal = {
    publisherName:
      String(ov.legalPublisherName ?? process.env.LEGAL_PUBLISHER_NAME ?? 'VériCar Europe SAS').trim() ||
      'VériCar Europe SAS',
    contactEmail:
      String(ov.legalContactEmail ?? process.env.LEGAL_CONTACT_EMAIL ?? 'contact@vericar-europe.eu').trim() ||
      'contact@vericar-europe.eu',
    hostProvider:
      String(ov.legalHostProvider ?? process.env.LEGAL_HOST_PROVIDER ?? 'Hébergement Cloud UE').trim() ||
      'Hébergement Cloud UE',
  };

  return {
    nodeEnv,
    isProduction,
    isProd: isProduction,
    isTest,
    port,
    appName: 'VériCar Europe',
    appVersion: readAppVersion(),
    appUrl,
    dbPath: resolveDbPath(ov.dbPath),
    trustProxy,
    corsOrigins,
    cookieSecure,
    rateLimitMaxMultiplier,
    logLevel,
    session: {
      cookieName: 'vericar_session',
      ttlDays,
      ttlSeconds,
      maxAgeMs: ttlSeconds * 1000,
    },
    auth: {
      signupBonusCredits,
      adminEmail: rawAdminEmail || null,
      adminPassword: rawAdminPassword || null,
      adminName,
    },
    billing: {
      currency: 'EUR',
      vatRate: 20,
      stripeSecretKey,
      stripeWebhookSecret,
      stripeConfigured,
      allowSandboxBilling: allowSandboxFlag,
      sandboxEnabled,
      billingMode,
    },
    legal,
    connectors: {
      ukMotConfigured: Boolean(process.env.UK_MOT_API_KEY),
      ukMotOauthConfigured: Boolean(
        process.env.UK_MOT_API_KEY && process.env.UK_MOT_CLIENT_ID && process.env.UK_MOT_CLIENT_SECRET
      ),
      noVegvesenConfigured: Boolean(process.env.NO_VEGVESEN_API_KEY),
      frSivConfigured: Boolean(process.env.FR_SIV_API_KEY && process.env.FR_SIV_API_URL),
      beCarpassConfigured: Boolean(process.env.BE_CARPASS_API_KEY),
      deDatConfigured: Boolean(process.env.DE_DAT_API_KEY),
    },
  };
}

export function getPublicConfig(overrides = {}) {
  const cfg = getConfig(overrides);
  return {
    appName: cfg.appName,
    billingMode: cfg.billing.billingMode,
    stripeConfigured: cfg.billing.stripeConfigured,
    signupBonusCredits: cfg.auth.signupBonusCredits,
    legal: { ...cfg.legal },
  };
}
