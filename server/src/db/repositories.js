import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getDb, withTransaction } from './index.js';

const autoSaveStore = new AsyncLocalStorage();
let connectorMetricWriteCount = 0;

/**
 * Runs a function while suppressing auto-persistence inside legacy saveReport().
 * Safe across concurrent async HTTP requests via AsyncLocalStorage.
 */
export function runWithoutAutoSave(fn) {
  return autoSaveStore.run({ skipPersist: true }, fn);
}

export const suppressAutoSave = runWithoutAutoSave;

function escapeLikePattern(str) {
  return String(str || '').replace(/[\\%_]/g, '\\$&');
}

function safeJsonParse(raw, fallback = null) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ============================================================================
// Row Mappers (always return plain JS objects, never null-prototype sqlite rows)
// ============================================================================

export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? null,
    companyName: row.company_name ?? null,
    role: row.role || 'user',
    creditsBalance: Number(row.credits_balance ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

function toInternalUser(row) {
  if (!row) return null;
  return {
    ...toPublicUser(row),
    passwordHash: row.password_hash,
    acceptedTermsAt: row.accepted_terms_at ?? null,
  };
}

function toLedgerEntry(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: row.user_id,
    delta: Number(row.delta),
    balanceAfter: Number(row.balance_after),
    reason: row.reason,
    referenceId: row.reference_id ?? null,
    description: row.description ?? '',
    createdAt: row.created_at,
  };
}

function toOrderDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    userId: row.user_id,
    packId: row.pack_id,
    packName: row.pack_name,
    credits: Number(row.credits),
    amountCents: Number(row.amount_cents),
    currency: row.currency || 'EUR',
    provider: row.provider,
    providerSessionId: row.provider_session_id ?? null,
    status: row.status,
    acceptedWaiverAt: row.accepted_waiver_at ?? null,
    metadata: safeJsonParse(row.metadata_json, null),
    paidAt: row.paid_at ?? null,
    createdAt: row.created_at,
  };
}

function hydrateReportRow(row) {
  if (!row) return null;
  const parsed = safeJsonParse(row.report_json, null);
  if (!parsed || typeof parsed !== 'object') return null;

  return {
    ...parsed,
    id: row.id,
    createdAt: row.created_at,
    userId: row.user_id ?? null,
    normalizedKey: row.normalized_key ?? parsed.normalizedKey ?? null,
    creditCost: Number(row.credit_cost ?? parsed.creditCost ?? 0),
    isShared: Boolean(row.is_shared),
    shareToken: row.share_token ?? null,
    sharedAt: row.shared_at ?? null,
  };
}

function toReportSummary(row) {
  return {
    id: row.id,
    query: row.query,
    queryType: row.query_type,
    country: row.country,
    vin: row.vin ?? null,
    plate: row.plate ?? null,
    make: row.make ?? 'Inconnu',
    model: row.model ?? 'Modèle non spécifié',
    year: row.year !== null && row.year !== undefined ? Number(row.year) : null,
    trustScore: Number(row.trust_score),
    riskLevel: row.risk_level,
    dataOrigin: row.data_origin,
    creditCost: Number(row.credit_cost ?? 0),
    isShared: Boolean(row.is_shared),
    shareToken: row.share_token ?? null,
    sharedAt: row.shared_at ?? null,
    normalizedKey: row.normalized_key ?? null,
    summary: safeJsonParse(row.summary_json, {}),
    createdAt: row.created_at,
  };
}

// ============================================================================
// Users & Credits
// ============================================================================

export function createUser({
  id = null,
  email,
  passwordHash,
  fullName = null,
  companyName = null,
  role = 'user',
  initialCredits = 0,
  acceptedTermsAt = null,
  lastLoginAt = null,
}) {
  return withTransaction((db) => {
    const now = new Date().toISOString();
    const userId = id || `USR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const normEmail = String(email || '').trim().toLowerCase();
    const safeCredits = Math.max(0, Number.isInteger(initialCredits) ? initialCredits : 0);

    db.prepare(`
      INSERT INTO users (
        id, email, password_hash, full_name, company_name, role,
        credits_balance, accepted_terms_at, created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      normEmail,
      passwordHash,
      fullName || null,
      companyName || null,
      role === 'admin' ? 'admin' : 'user',
      safeCredits,
      acceptedTermsAt,
      now,
      now,
      lastLoginAt
    );

    if (safeCredits > 0) {
      db.prepare(`
        INSERT INTO credit_ledger (user_id, delta, balance_after, reason, reference_id, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        safeCredits,
        safeCredits,
        'signup_bonus',
        userId,
        'Crédit de bienvenue offert à l’inscription',
        now
      );
    }

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return toPublicUser(created);
  });
}

export function findUserByEmail(email) {
  const db = getDb();
  const normEmail = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normEmail);
  return toInternalUser(row);
}

export function findUserById(id, { includePasswordHash = false } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return includePasswordHash ? toInternalUser(row) : toPublicUser(row);
}

export function getUserCreditsBalance(userId) {
  const db = getDb();
  const row = db.prepare('SELECT credits_balance FROM users WHERE id = ?').get(userId);
  return row ? Number(row.credits_balance) : 0;
}

export function updateUserLastLogin(userId, nowIso = new Date().toISOString()) {
  const db = getDb();
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, userId);
}

export function updateUserProfile(userId, { fullName, companyName }) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existing) return null;

  const nextFullName = fullName !== undefined ? fullName : existing.full_name;
  const nextCompanyName = companyName !== undefined ? companyName : existing.company_name;

  db.prepare('UPDATE users SET full_name = ?, company_name = ?, updated_at = ? WHERE id = ?').run(
    nextFullName,
    nextCompanyName,
    now,
    userId
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toPublicUser(updated);
}

export function updateUserPassword(userId, newPasswordHash) {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(newPasswordHash, now, userId);
  return res.changes > 0;
}

export function promoteUserToAdmin(userId) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(now, userId);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toPublicUser(row);
}

export function insertCreditLedgerEntry({
  userId,
  delta,
  balanceAfter,
  reason,
  referenceId = null,
  description = '',
  createdAt = new Date().toISOString(),
}) {
  const db = getDb();
  const res = db
    .prepare(`
      INSERT INTO credit_ledger (user_id, delta, balance_after, reason, reference_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(userId, delta, balanceAfter, reason, referenceId, description, createdAt);

  const row = db.prepare('SELECT * FROM credit_ledger WHERE id = ?').get(res.lastInsertRowid);
  return toLedgerEntry(row);
}

export function adjustUserCreditsAtomic(userId, { delta, reason, referenceId = null, description = '' }) {
  if (!Number.isInteger(delta) || delta === 0) {
    const err = new Error('Le delta de crédits doit être un entier non nul.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  return withTransaction((db) => {
    const now = new Date().toISOString();

    if (delta < 0) {
      const updateRes = db
        .prepare(
          'UPDATE users SET credits_balance = credits_balance + ?, updated_at = ? WHERE id = ? AND credits_balance + ? >= 0'
        )
        .run(delta, now, userId, delta);

      if (updateRes.changes !== 1) {
        const existing = db.prepare('SELECT id, credits_balance FROM users WHERE id = ?').get(userId);
        if (!existing) {
          const err = new Error('Utilisateur introuvable.');
          err.code = 'USER_NOT_FOUND';
          throw err;
        }
        const err = new Error('Solde de crédits insuffisant.');
        err.code = 'INSUFFICIENT_CREDITS';
        err.creditsBalance = Number(existing.credits_balance);
        throw err;
      }
    } else {
      const updateRes = db
        .prepare('UPDATE users SET credits_balance = credits_balance + ?, updated_at = ? WHERE id = ?')
        .run(delta, now, userId);

      if (updateRes.changes !== 1) {
        const err = new Error('Utilisateur introuvable.');
        err.code = 'USER_NOT_FOUND';
        throw err;
      }
    }

    const updatedRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const balanceAfter = Number(updatedRow.credits_balance);

    const ledgerEntry = insertCreditLedgerEntry({
      userId,
      delta,
      balanceAfter,
      reason,
      referenceId,
      description,
      createdAt: now,
    });

    return {
      ok: true,
      user: toPublicUser(updatedRow),
      creditsBalance: balanceAfter,
      ledgerEntry,
    };
  });
}

export function listCreditLedgerByUser(userId, limit = 100) {
  const db = getDb();
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = db
    .prepare('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, safeLimit);
  return rows.map(toLedgerEntry);
}

export function deleteUserAccountCascade(userId) {
  return withTransaction((db) => {
    db.prepare('DELETE FROM reports WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM credit_ledger WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    const res = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return res.changes > 0;
  });
}

export function listUsersForAdmin({ limit = 50, offset = 0, search = '' } = {}) {
  const db = getDb();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const cleanSearch = String(search || '').trim().slice(0, 100).toLowerCase();

  let whereSql = '';
  const params = [];
  if (cleanSearch) {
    const pattern = `%${escapeLikePattern(cleanSearch)}%`;
    whereSql =
      "WHERE LOWER(u.email) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(u.full_name, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(u.company_name, '')) LIKE ? ESCAPE '\\'";
    params.push(pattern, pattern, pattern);
  }

  const totalRow = db.prepare(`SELECT COUNT(*) AS cnt FROM users u ${whereSql}`).get(...params);

  const rows = db
    .prepare(`
      SELECT u.id, u.email, u.full_name, u.company_name, u.role, u.credits_balance,
             u.created_at, u.updated_at, u.last_login_at,
             (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) AS reports_count,
             (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS orders_count
      FROM users u
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, safeLimit, safeOffset);

  return {
    total: Number(totalRow?.cnt ?? 0),
    users: rows.map((row) => ({
      ...toPublicUser(row),
      reportsCount: Number(row.reports_count ?? 0),
      ordersCount: Number(row.orders_count ?? 0),
    })),
  };
}

export function listRecentUsersForAdmin(limit = 20) {
  const db = getDb();
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const rows = db
    .prepare(`
      SELECT id, email, full_name, company_name, role, credits_balance, created_at, updated_at, last_login_at
      FROM users
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(safeLimit);
  return rows.map(toPublicUser);
}

// ============================================================================
// Sessions
// ============================================================================

export function createSession({ tokenHash, userId, ipAddress = null, userAgent = null, expiresAt }) {
  const db = getDb();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, ip_address, user_agent, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tokenHash, userId, ipAddress || null, userAgent ? String(userAgent).slice(0, 300) : null, expiresAt, createdAt);

  return {
    tokenHash,
    userId,
    expiresAt,
    createdAt,
  };
}

export function findValidSessionWithUser(tokenHash, nowIso = new Date().toISOString()) {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT
        s.token_hash AS s_token_hash,
        s.user_id AS s_user_id,
        s.expires_at AS s_expires_at,
        s.created_at AS s_created_at,
        u.id, u.email, u.full_name, u.company_name, u.role,
        u.credits_balance, u.created_at, u.updated_at, u.last_login_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `)
    .get(tokenHash);

  if (!row) return null;

  if (row.s_expires_at <= nowIso) {
    try {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    } catch {
      // Ignore lazy cleanup error
    }
    return null;
  }

  return {
    session: {
      tokenHash: row.s_token_hash,
      userId: row.s_user_id,
      expiresAt: row.s_expires_at,
      createdAt: row.s_created_at,
    },
    user: toPublicUser(row),
  };
}

export function deleteSessionByTokenHash(tokenHash) {
  const db = getDb();
  const res = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  return res.changes > 0;
}

export function deleteUserSessions(userId, { exceptTokenHash = null } = {}) {
  const db = getDb();
  if (exceptTokenHash) {
    const res = db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
      .run(userId, exceptTokenHash);
    return res.changes;
  }
  const res = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return res.changes;
}

export function pruneExpiredSessions(nowIso = new Date().toISOString(), userId = null) {
  const db = getDb();
  if (userId) {
    const res = db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').run(userId, nowIso);
    return res.changes;
  }
  const res = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  return res.changes;
}

// ============================================================================
// Orders & Invoices
// ============================================================================

export function nextInvoiceNumber(date = new Date(), dbArg = null) {
  const db = dbArg || getDb();
  const year = date.getUTCFullYear();
  const row = db
    .prepare(`
      INSERT INTO invoice_sequences (year, last_seq)
      VALUES (?, 1)
      ON CONFLICT(year) DO UPDATE SET last_seq = last_seq + 1
      RETURNING last_seq
    `)
    .get(year);

  const seq = Number(row?.last_seq ?? 1);
  return `VC-${year}-${String(seq).padStart(6, '0')}`;
}

export function createOrder({ userId, pack, provider, acceptedWaiverAt = null, metadata = null }) {
  return withTransaction((db) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const orderId = `ORD-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const invoiceNumber = nextInvoiceNumber(now, db);

    db.prepare(`
      INSERT INTO orders (
        id, invoice_number, user_id, pack_id, pack_name, credits, amount_cents,
        currency, provider, status, accepted_waiver_at, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      orderId,
      invoiceNumber,
      userId,
      pack.id,
      pack.name,
      pack.credits,
      pack.amountCents,
      pack.currency || 'EUR',
      provider,
      acceptedWaiverAt,
      metadata ? JSON.stringify(metadata) : null,
      nowIso
    );

    const created = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return toOrderDto(created);
  });
}

export function attachStripeSessionToOrder(orderId, providerSessionId, metadataPatch = null) {
  return withTransaction((db) => {
    const existing = db.prepare('SELECT metadata_json FROM orders WHERE id = ?').get(orderId);
    if (!existing) return null;

    let nextMeta = safeJsonParse(existing.metadata_json, null);
    if (metadataPatch && typeof metadataPatch === 'object') {
      nextMeta = { ...(nextMeta || {}), ...metadataPatch };
    }

    db.prepare('UPDATE orders SET provider_session_id = ?, metadata_json = ? WHERE id = ?').run(
      providerSessionId,
      nextMeta ? JSON.stringify(nextMeta) : null,
      orderId
    );

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return toOrderDto(updated);
  });
}

export function markOrderFailed(orderId, metadataPatch = null) {
  return withTransaction((db) => {
    const existing = db.prepare('SELECT status, metadata_json FROM orders WHERE id = ?').get(orderId);
    if (!existing || existing.status !== 'pending') return false;

    let nextMeta = safeJsonParse(existing.metadata_json, null);
    if (metadataPatch && typeof metadataPatch === 'object') {
      nextMeta = { ...(nextMeta || {}), ...metadataPatch };
    }

    const res = db
      .prepare("UPDATE orders SET status = 'failed', metadata_json = ? WHERE id = ? AND status = 'pending'")
      .run(nextMeta ? JSON.stringify(nextMeta) : null, orderId);
    return res.changes > 0;
  });
}

export function getOrderById(orderId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  return toOrderDto(row);
}

export function getOrderByProviderSessionId(providerSessionId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM orders WHERE provider_session_id = ?').get(providerSessionId);
  return toOrderDto(row);
}

export function listOrdersByUser(userId, limit = 50) {
  const db = getDb();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, safeLimit);
  return rows.map(toOrderDto);
}

export function fulfillOrderAtomic({
  orderId = null,
  providerSessionId = null,
  expectedProvider = null,
  expectedUserId = null,
  expectedAmountCents = null,
  metadataPatch = null,
}) {
  return withTransaction((db) => {
    let row = null;
    if (orderId) {
      row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    }
    if (!row && providerSessionId) {
      row = db.prepare('SELECT * FROM orders WHERE provider_session_id = ?').get(providerSessionId);
    }
    if (!row) {
      return { found: false };
    }

    if (expectedUserId && row.user_id !== expectedUserId) {
      return { found: false };
    }

    if (expectedProvider && row.provider !== expectedProvider) {
      const err = new Error('Fournisseur de paiement incompatible avec cette commande.');
      err.code = expectedProvider === 'sandbox' ? 'SANDBOX_DISABLED' : 'PROVIDER_MISMATCH';
      throw err;
    }

    if (expectedAmountCents !== null && expectedAmountCents !== undefined) {
      if (Number(expectedAmountCents) !== Number(row.amount_cents)) {
        const err = new Error('Montant payé incohérent avec la commande.');
        err.code = 'AMOUNT_MISMATCH';
        throw err;
      }
    }

    if (row.status === 'paid') {
      const balance = getUserCreditsBalance(row.user_id);
      return {
        found: true,
        alreadyPaid: true,
        order: toOrderDto(row),
        creditsBalance: balance,
      };
    }

    if (row.status !== 'pending') {
      const err = new Error('Cette commande ne peut plus être validée.');
      err.code = 'ORDER_NOT_PAYABLE';
      throw err;
    }

    const nowIso = new Date().toISOString();
    let nextMeta = safeJsonParse(row.metadata_json, null);
    if (metadataPatch && typeof metadataPatch === 'object') {
      nextMeta = { ...(nextMeta || {}), ...metadataPatch };
    }

    const updateRes = db
      .prepare(`
        UPDATE orders
        SET status = 'paid',
            paid_at = ?,
            provider_session_id = COALESCE(provider_session_id, ?),
            metadata_json = ?
        WHERE id = ? AND status = 'pending'
      `)
      .run(nowIso, providerSessionId || null, nextMeta ? JSON.stringify(nextMeta) : null, row.id);

    if (updateRes.changes !== 1) {
      const refreshed = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id);
      const balance = getUserCreditsBalance(row.user_id);
      return {
        found: true,
        alreadyPaid: refreshed?.status === 'paid',
        order: toOrderDto(refreshed),
        creditsBalance: balance,
      };
    }

    const creditResult = adjustUserCreditsAtomic(row.user_id, {
      delta: Number(row.credits),
      reason: 'purchase',
      referenceId: row.id,
      description: `Achat ${row.pack_name} (${row.invoice_number})`,
    });

    const paidRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id);
    return {
      found: true,
      alreadyPaid: false,
      order: toOrderDto(paidRow),
      creditsBalance: creditResult.creditsBalance,
      ledgerEntry: creditResult.ledgerEntry,
    };
  });
}

export function listRecentOrdersForAdmin(limit = 20) {
  const db = getDb();
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const rows = db
    .prepare(`
      SELECT o.*, u.email AS user_email
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      ORDER BY o.created_at DESC
      LIMIT ?
    `)
    .all(safeLimit);

  return rows.map((row) => ({
    ...toOrderDto(row),
    userEmail: row.user_email ?? null,
  }));
}

// ============================================================================
// Reports & Sharing
// ============================================================================

function buildReportSummaryPayload(report) {
  return {
    verdict: report.summary?.verdict || '',
    alertsCount: report.alerts?.length || 0,
    criticalCount: report.alerts?.filter((a) => a.severity === 'critical').length || 0,
    countriesVisited: report.countriesVisited || [],
    odometerStatus: report.mileage?.status || 'unknown',
    latestMileageKm: report.mileage?.latestKm ?? null,
    damagesCount: report.damages?.records?.length || 0,
    openRecallsCount: report.recalls?.filter((r) => r.status === 'open').length || 0,
  };
}

/**
 * Directly inserts a report row into SQLite (ignores AsyncLocalStorage suppression).
 */
export function insertReport(report, options = {}) {
  const db = getDb();
  const id = report.id || `VR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const createdAt = report.createdAt || new Date().toISOString();

  const userId = options.userId !== undefined ? options.userId : report.userId ?? null;
  const normalizedKey = options.normalizedKey !== undefined ? options.normalizedKey : report.normalizedKey ?? null;
  const creditCost = Number(options.creditCost !== undefined ? options.creditCost : report.creditCost ?? 0);
  const isShared = Boolean(options.isShared !== undefined ? options.isShared : report.isShared ?? false);
  const shareToken = options.shareToken !== undefined ? options.shareToken : report.shareToken ?? null;
  const sharedAt = options.sharedAt !== undefined ? options.sharedAt : report.sharedAt ?? null;

  const enrichedReport = {
    ...report,
    id,
    createdAt,
    userId,
    normalizedKey,
    creditCost,
    isShared,
    shareToken,
    sharedAt,
  };

  const summary = buildReportSummaryPayload(enrichedReport);

  db.prepare(`
    INSERT INTO reports (
      id, query, query_type, country, vin, plate, make, model, year,
      trust_score, risk_level, data_origin, summary_json, report_json, created_at,
      user_id, normalized_key, share_token, is_shared, shared_at, credit_cost
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    enrichedReport.query,
    enrichedReport.queryType,
    enrichedReport.country,
    enrichedReport.vehicle?.vin || null,
    enrichedReport.vehicle?.plate || null,
    enrichedReport.vehicle?.make || 'Inconnu',
    enrichedReport.vehicle?.model || 'Modèle non spécifié',
    enrichedReport.vehicle?.year || null,
    enrichedReport.trustScore,
    enrichedReport.riskLevel,
    enrichedReport.dataOrigin,
    JSON.stringify(summary),
    JSON.stringify(enrichedReport),
    createdAt,
    userId,
    normalizedKey,
    shareToken,
    isShared ? 1 : 0,
    sharedAt,
    creditCost
  );

  return enrichedReport;
}

/**
 * Backward-compatible saveReport() called by untouched reportAggregator.js and vericar.test.js.
 * Defers SQLite write when running inside runWithoutAutoSave() unless options.forcePersist === true.
 */
export function saveReport(report, options = {}) {
  const id = report.id || `VR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const createdAt = report.createdAt || new Date().toISOString();
  const enrichedReport = { ...report, id, createdAt };

  const store = autoSaveStore.getStore();
  if (store?.skipPersist && !options.forcePersist) {
    return enrichedReport;
  }

  return insertReport(enrichedReport, options);
}

export function getReportById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  return hydrateReportRow(row);
}

export function getReportByIdForUser(id, userId, { isAdmin = false } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!row) return null;
  if (!isAdmin && row.user_id !== userId) return null;
  return hydrateReportRow(row);
}

export function findUserReportByNormalizedKey(userId, normalizedKey) {
  if (!userId || !normalizedKey) return null;
  const db = getDb();
  const row = db
    .prepare(`
      SELECT *
      FROM reports
      WHERE user_id = ? AND normalized_key = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `)
    .get(userId, normalizedKey);
  return hydrateReportRow(row);
}

export function listReports(limit = 30) {
  const db = getDb();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 30));
  const rows = db
    .prepare(`
      SELECT id, query, query_type, country, vin, plate, make, model, year,
             trust_score, risk_level, data_origin, summary_json, created_at,
             credit_cost, is_shared, share_token, shared_at, normalized_key
      FROM reports
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(safeLimit);

  return rows.map(toReportSummary);
}

export function listReportsByUser(userId, { q = '', limit = 30 } = {}) {
  const db = getDb();
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const cleanQ = String(q || '').trim().slice(0, 80).toLowerCase();

  let whereSql = 'WHERE user_id = ?';
  const params = [userId];

  if (cleanQ) {
    const pattern = `%${escapeLikePattern(cleanQ)}%`;
    whereSql += ` AND (
      LOWER(query) LIKE ? ESCAPE '\\' OR
      LOWER(COALESCE(vin, '')) LIKE ? ESCAPE '\\' OR
      LOWER(COALESCE(plate, '')) LIKE ? ESCAPE '\\' OR
      LOWER(COALESCE(make, '')) LIKE ? ESCAPE '\\' OR
      LOWER(COALESCE(model, '')) LIKE ? ESCAPE '\\' OR
      LOWER(country) LIKE ? ESCAPE '\\' OR
      LOWER(id) LIKE ? ESCAPE '\\'
    )`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const rows = db
    .prepare(`
      SELECT id, query, query_type, country, vin, plate, make, model, year,
             trust_score, risk_level, data_origin, summary_json, created_at,
             credit_cost, is_shared, share_token, shared_at, normalized_key
      FROM reports
      ${whereSql}
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `)
    .all(...params, safeLimit);

  return rows.map(toReportSummary);
}

export function listAllUserReportsForExport(userId) {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(userId);
  return rows.map(hydrateReportRow).filter(Boolean);
}

export function deleteReport(id) {
  const db = getDb();
  const result = db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteReportForUser(id, userId, { isAdmin = false } = {}) {
  const db = getDb();
  if (isAdmin) {
    const res = db.prepare('DELETE FROM reports WHERE id = ?').run(id);
    return res.changes > 0;
  }
  const res = db.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}

export function enableReportShare(id, userId, { isAdmin = false, regenerate = false } = {}) {
  return withTransaction((db) => {
    const row = db.prepare('SELECT id, user_id, is_shared, share_token, shared_at FROM reports WHERE id = ?').get(id);
    if (!row) return null;
    if (!isAdmin && row.user_id !== userId) return null;

    if (!regenerate && Number(row.is_shared) === 1 && row.share_token) {
      return {
        shareToken: row.share_token,
        sharePath: `/r/${row.share_token}`,
        isShared: true,
        sharedAt: row.shared_at,
      };
    }

    const shareToken = crypto.randomBytes(24).toString('base64url');
    const sharedAt = new Date().toISOString();

    db.prepare('UPDATE reports SET is_shared = 1, share_token = ?, shared_at = ? WHERE id = ?').run(
      shareToken,
      sharedAt,
      id
    );

    return {
      shareToken,
      sharePath: `/r/${shareToken}`,
      isShared: true,
      sharedAt,
    };
  });
}

export function revokeReportShare(id, userId, { isAdmin = false } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT id, user_id FROM reports WHERE id = ?').get(id);
  if (!row) return false;
  if (!isAdmin && row.user_id !== userId) return false;

  db.prepare('UPDATE reports SET is_shared = 0, share_token = NULL, shared_at = NULL WHERE id = ?').run(id);
  return true;
}

export function getSharedReportByToken(shareToken) {
  if (!shareToken || typeof shareToken !== 'string') return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM reports WHERE share_token = ? AND is_shared = 1')
    .get(shareToken);

  if (!row) return null;

  const hydrated = hydrateReportRow(row);
  if (!hydrated) return null;

  const publicReport = { ...hydrated };
  delete publicReport.userId;
  delete publicReport.user_id;
  delete publicReport.shareToken;
  delete publicReport.creditCost;
  delete publicReport.alreadyUnlocked;
  delete publicReport.ephemeral;
  delete publicReport.normalizedKey;

  return {
    report: publicReport,
    sharedAt: row.shared_at,
  };
}

export function listRecentReportsForAdmin(limit = 20) {
  const db = getDb();
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const rows = db
    .prepare(`
      SELECT r.id, r.user_id, r.query, r.country, r.make, r.model, r.year,
             r.trust_score, r.risk_level, r.data_origin, r.credit_cost,
             r.is_shared, r.created_at, u.email AS owner_email
      FROM reports r
      LEFT JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC
      LIMIT ?
    `)
    .all(safeLimit);

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id ?? null,
    ownerEmail: row.owner_email ?? null,
    query: row.query,
    country: row.country,
    make: row.make,
    model: row.model,
    year: row.year !== null && row.year !== undefined ? Number(row.year) : null,
    trustScore: Number(row.trust_score),
    riskLevel: row.risk_level,
    dataOrigin: row.data_origin,
    creditCost: Number(row.credit_cost ?? 0),
    isShared: Boolean(row.is_shared),
    createdAt: row.created_at,
  }));
}

// ============================================================================
// Connector Telemetry & Retention Pruning
// ============================================================================

export function pruneConnectorMetrics({ maxRows = 5000, maxAgeDays = 30 } = {}) {
  const db = getDb();
  const cutoffIso = new Date(Date.now() - Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000).toISOString();
  const resAge = db.prepare('DELETE FROM connector_metrics WHERE checked_at < ?').run(cutoffIso);
  const resCount = db
    .prepare(`
      DELETE FROM connector_metrics
      WHERE id NOT IN (
        SELECT id FROM connector_metrics ORDER BY id DESC LIMIT ?
      )
    `)
    .run(Math.max(100, Number(maxRows) || 5000));
  return Number(resAge.changes || 0) + Number(resCount.changes || 0);
}

export function recordConnectorMetric(connector, status, latencyMs, detail = '') {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO connector_metrics (connector, status, latency_ms, detail, checked_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      String(connector || 'unknown'),
      String(status || 'unknown'),
      Math.max(0, Math.round(Number(latencyMs) || 0)),
      String(detail || '').slice(0, 240),
      new Date().toISOString()
    );

    connectorMetricWriteCount += 1;
    if (connectorMetricWriteCount % 100 === 0) {
      try {
        pruneConnectorMetrics({ maxRows: 5000, maxAgeDays: 30 });
      } catch {
        // Non-critical retention pruning
      }
    }
  } catch {
    // Telemetry is non-critical
  }
}

export function getConnectorTelemetry() {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT connector, status, latency_ms AS latencyMs, detail, checked_at AS checkedAt
      FROM connector_metrics
      WHERE id IN (
        SELECT MAX(id) FROM connector_metrics GROUP BY connector
      )
      ORDER BY connector ASC
    `)
    .all();

  return rows.map((row) => ({
    connector: row.connector,
    status: row.status,
    latencyMs: Number(row.latencyMs ?? 0),
    detail: row.detail ?? '',
    checkedAt: row.checkedAt,
  }));
}

export function getConnectorStats24h() {
  const db = getDb();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const aggRows = db
    .prepare(`
      SELECT
        connector,
        COUNT(*) AS total_calls,
        SUM(CASE WHEN status IN ('online', 'partial') THEN 1 ELSE 0 END) AS online_count,
        SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) AS degraded_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
        ROUND(AVG(latency_ms)) AS avg_latency_ms
      FROM connector_metrics
      WHERE checked_at >= ?
      GROUP BY connector
      ORDER BY connector ASC
    `)
    .all(sinceIso);

  const latestRows = getConnectorTelemetry();
  const latestByConnector = new Map(latestRows.map((r) => [r.connector, r]));

  return aggRows.map((row) => {
    const totalCalls = Number(row.total_calls ?? 0);
    const onlineCount = Number(row.online_count ?? 0);
    const latest = latestByConnector.get(row.connector);
    return {
      connector: row.connector,
      totalCalls,
      onlineCount,
      degradedCount: Number(row.degraded_count ?? 0),
      errorCount: Number(row.error_count ?? 0),
      successRatePct: totalCalls > 0 ? Math.round((onlineCount / totalCalls) * 100) : 0,
      avgLatencyMs: Number(row.avg_latency_ms ?? 0),
      lastStatus: latest?.status ?? null,
      lastCheckedAt: latest?.checkedAt ?? null,
      lastDetail: latest?.detail ?? '',
    };
  });
}

// ============================================================================
// Admin Overview KPIs
// ============================================================================

export function getAdminOverviewKpis() {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const userStats = db
    .prepare(`
      SELECT
        COUNT(*) AS users_total,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_users,
        COALESCE(SUM(credits_balance), 0) AS credits_circulating
      FROM users
    `)
    .get();

  const sessionStats = db
    .prepare('SELECT COUNT(*) AS active_sessions FROM sessions WHERE expires_at > ?')
    .get(nowIso);

  const reportStats = db
    .prepare(`
      SELECT
        COUNT(*) AS reports_total,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS reports_24h,
        SUM(CASE WHEN credit_cost > 0 THEN 1 ELSE 0 END) AS reports_unlocked_paid,
        SUM(CASE WHEN data_origin = 'demo_enriched' THEN 1 ELSE 0 END) AS reports_demo
      FROM reports
    `)
    .get(since24hIso);

  const originRows = db
    .prepare('SELECT data_origin, COUNT(*) AS cnt FROM reports GROUP BY data_origin')
    .all();
  const reportsByOrigin = {};
  for (const row of originRows) {
    reportsByOrigin[row.data_origin] = Number(row.cnt);
  }

  const countryRows = db
    .prepare('SELECT country, COUNT(*) AS cnt FROM reports GROUP BY country')
    .all();
  const reportsByCountry = {};
  for (const row of countryRows) {
    reportsByCountry[row.country] = Number(row.cnt);
  }

  const ledgerStats = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS credits_issued,
        COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS credits_consumed
      FROM credit_ledger
    `)
    .get();

  const orderStats = db
    .prepare(`
      SELECT
        COUNT(*) AS orders_total,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS orders_paid_total,
        SUM(CASE WHEN status = 'paid' AND provider = 'stripe' THEN 1 ELSE 0 END) AS orders_live_paid,
        SUM(CASE WHEN status = 'paid' AND provider = 'sandbox' THEN 1 ELSE 0 END) AS orders_sandbox_paid,
        COALESCE(SUM(CASE WHEN status = 'paid' AND provider = 'stripe' THEN amount_cents ELSE 0 END), 0) AS revenue_live_cents,
        COALESCE(SUM(CASE WHEN status = 'paid' AND provider = 'sandbox' THEN amount_cents ELSE 0 END), 0) AS revenue_sandbox_cents
      FROM orders
    `)
    .get();

  const cacheStats = db
    .prepare(`
      SELECT
        COUNT(*) AS total_entries,
        SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS active_entries
      FROM api_cache
    `)
    .get(nowIso);

  return {
    usersTotal: Number(userStats?.users_total ?? 0),
    adminUsers: Number(userStats?.admin_users ?? 0),
    activeSessions: Number(sessionStats?.active_sessions ?? 0),
    reportsTotal: Number(reportStats?.reports_total ?? 0),
    reportsLast24h: Number(reportStats?.reports_24h ?? 0),
    reportsUnlockedPaid: Number(reportStats?.reports_unlocked_paid ?? 0),
    reportsDemo: Number(reportStats?.reports_demo ?? 0),
    reportsByOrigin,
    reportsByCountry,
    creditsCirculating: Number(userStats?.credits_circulating ?? 0),
    creditsIssued: Number(ledgerStats?.credits_issued ?? 0),
    creditsConsumed: Number(ledgerStats?.credits_consumed ?? 0),
    ordersTotal: Number(orderStats?.orders_total ?? 0),
    ordersPaidTotal: Number(orderStats?.orders_paid_total ?? 0),
    ordersLivePaid: Number(orderStats?.orders_live_paid ?? 0),
    ordersSandboxPaid: Number(orderStats?.orders_sandbox_paid ?? 0),
    revenueLiveCents: Number(orderStats?.revenue_live_cents ?? 0),
    revenueSandboxCents: Number(orderStats?.revenue_sandbox_cents ?? 0),
    apiCacheEntries: Number(cacheStats?.total_entries ?? 0),
    activeCacheEntries: Number(cacheStats?.active_entries ?? 0),
  };
}

// ============================================================================
// API Cache Table Primitives
// ============================================================================

export function getCacheEntry(cacheKey) {
  const db = getDb();
  const row = db
    .prepare('SELECT cache_key, provider, payload_json, fetched_at, expires_at FROM api_cache WHERE cache_key = ?')
    .get(cacheKey);
  if (!row) return null;
  return {
    cacheKey: row.cache_key,
    provider: row.provider,
    payloadJson: row.payload_json,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
  };
}

export function upsertCacheEntry({ cacheKey, provider, payloadJson, fetchedAt, expiresAt }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO api_cache (cache_key, provider, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      provider = excluded.provider,
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `).run(cacheKey, provider, payloadJson, fetchedAt, expiresAt);
}

export function deleteCacheEntry(cacheKey) {
  const db = getDb();
  const res = db.prepare('DELETE FROM api_cache WHERE cache_key = ?').run(cacheKey);
  return res.changes > 0;
}

export function deleteCacheByProvider(provider) {
  const db = getDb();
  const res = db.prepare('DELETE FROM api_cache WHERE provider = ?').run(provider);
  return Number(res.changes ?? 0);
}

export function pruneExpiredCacheEntries(cutoffIso) {
  const db = getDb();
  const res = db.prepare('DELETE FROM api_cache WHERE expires_at <= ?').run(cutoffIso);
  return Number(res.changes ?? 0);
}

export function getCacheStatsRows(nowIso = new Date().toISOString()) {
  const db = getDb();
  const totals = db
    .prepare(`
      SELECT
        COUNT(*) AS total_entries,
        SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS active_entries,
        SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END) AS expired_entries
      FROM api_cache
    `)
    .get(nowIso, nowIso);

  const byProviderRows = db
    .prepare(`
      SELECT
        provider,
        COUNT(*) AS total_entries,
        SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS active_entries
      FROM api_cache
      GROUP BY provider
      ORDER BY provider ASC
    `)
    .all(nowIso);

  return {
    totalEntries: Number(totals?.total_entries ?? 0),
    activeEntries: Number(totals?.active_entries ?? 0),
    expiredEntries: Number(totals?.expired_entries ?? 0),
    byProvider: byProviderRows.map((row) => ({
      provider: row.provider,
      totalEntries: Number(row.total_entries ?? 0),
      activeEntries: Number(row.active_entries ?? 0),
    })),
  };
}
