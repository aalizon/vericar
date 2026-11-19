import crypto from 'node:crypto';
import { getConfig } from '../config.js';
import { withTransaction } from '../db/index.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUserLastLogin,
  updateUserProfile,
  updateUserPassword,
  promoteUserToAdmin,
  deleteUserAccountCascade,
  createSession,
  deleteSessionByTokenHash,
  deleteUserSessions,
  pruneExpiredSessions,
  listCreditLedgerByUser,
  listOrdersByUser,
  listAllUserReportsForExport,
  toPublicUser,
} from '../db/repositories.js';
import { AppError } from '../middleware/security.js';
import { hashSessionToken } from '../middleware/auth.js';

export const SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  saltBytes: 16,
  maxmem: 32 * 1024 * 1024,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const norm = normalizeEmail(email);
  return norm.length >= 5 && norm.length <= 254 && EMAIL_RE.test(norm);
}

export function hashPasswordSync(password) {
  const salt = crypto.randomBytes(SCRYPT_PARAMS.saltBytes);
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SCRYPT_PARAMS.saltBytes);
    crypto.scrypt(
      String(password),
      salt,
      SCRYPT_PARAMS.keylen,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: SCRYPT_PARAMS.maxmem,
      },
      (err, derived) => {
        if (err) return reject(err);
        resolve(
          `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${derived.toString('hex')}`
        );
      }
    );
  });
}

export function verifyPassword(password, storedHash) {
  return new Promise((resolve) => {
    if (typeof password !== 'string' || typeof storedHash !== 'string') {
      return resolve(false);
    }

    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return resolve(false);
    }

    const N = Number.parseInt(parts[1], 10);
    const r = Number.parseInt(parts[2], 10);
    const p = Number.parseInt(parts[3], 10);
    const saltHex = parts[4];
    const hashHex = parts[5];

    if (
      !Number.isInteger(N) ||
      !Number.isInteger(r) ||
      !Number.isInteger(p) ||
      N < 1024 ||
      N > 65536 ||
      r < 1 ||
      r > 16 ||
      p < 1 ||
      p > 4 ||
      !/^[0-9a-f]+$/i.test(saltHex) ||
      !/^[0-9a-f]+$/i.test(hashHex) ||
      hashHex.length % 2 !== 0
    ) {
      return resolve(false);
    }

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');

    crypto.scrypt(
      password,
      salt,
      expected.length,
      { N, r, p, maxmem: Math.max(SCRYPT_PARAMS.maxmem, 128 * N * r * 2) },
      (err, derived) => {
        if (err || !derived || derived.length !== expected.length) {
          return resolve(false);
        }
        try {
          resolve(crypto.timingSafeEqual(derived, expected));
        } catch {
          resolve(false);
        }
      }
    );
  });
}

// Constant-time shield so unknown-email login performs equivalent scrypt CPU work
const DUMMY_PASSWORD_HASH = hashPasswordSync('vericar-constant-time-shield-v1');

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sanitizeOptionalName(raw, fieldName) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `Le champ « ${fieldName} » doit être une chaîne de caractères.`, {
      field: fieldName,
    });
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 120) {
    throw new AppError(400, 'VALIDATION_ERROR', `Le champ « ${fieldName} » ne peut pas dépasser 120 caractères.`, {
      field: fieldName,
    });
  }
  return trimmed;
}

export async function registerUser(
  { email, password, fullName, companyName, acceptedTerms, ipAddress = null, userAgent = null },
  configOverrides = {}
) {
  const normEmail = normalizeEmail(email);
  if (!validateEmail(normEmail)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Veuillez saisir une adresse e-mail valide.', { field: 'email' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Le mot de passe doit contenir entre 8 et 128 caractères.',
      { field: 'password' }
    );
  }
  if (acceptedTerms !== true) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Vous devez accepter les conditions générales d’utilisation pour créer un compte.',
      { field: 'acceptedTerms' }
    );
  }

  const cleanFullName = sanitizeOptionalName(fullName, 'fullName') ?? null;
  const cleanCompanyName = sanitizeOptionalName(companyName, 'companyName') ?? null;

  // Compute scrypt hash outside SQLite transaction to avoid holding write lock
  const passwordHash = await hashPassword(password);
  const cfg = getConfig(configOverrides);
  const bonus = cfg.auth.signupBonusCredits;
  const role = cfg.auth.adminEmail && normEmail === normalizeEmail(cfg.auth.adminEmail) ? 'admin' : 'user';
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + cfg.session.maxAgeMs).toISOString();

  try {
    const user = withTransaction(() => {
      const existing = findUserByEmail(normEmail);
      if (existing) {
        throw new AppError(409, 'EMAIL_EXISTS', 'Un compte existe déjà avec cette adresse e-mail.');
      }

      const created = createUser({
        email: normEmail,
        passwordHash,
        fullName: cleanFullName,
        companyName: cleanCompanyName,
        role,
        initialCredits: bonus,
        acceptedTermsAt: nowIso,
        lastLoginAt: nowIso,
      });

      createSession({
        tokenHash,
        userId: created.id,
        ipAddress,
        userAgent,
        expiresAt,
      });

      return created;
    });

    return {
      user,
      rawToken,
      signupBonusCredits: bonus,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (/UNIQUE constraint failed/i.test(String(err?.message || ''))) {
      throw new AppError(409, 'EMAIL_EXISTS', 'Un compte existe déjà avec cette adresse e-mail.');
    }
    throw err;
  }
}

export async function loginUser({ email, password, ipAddress = null, userAgent = null }, configOverrides = {}) {
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Adresse e-mail et mot de passe requis.');
  }

  const normEmail = normalizeEmail(email);
  const userRow = findUserByEmail(normEmail);

  const ok = await verifyPassword(password, userRow ? userRow.passwordHash : DUMMY_PASSWORD_HASH);
  if (!userRow || !ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe incorrect.');
  }

  const cfg = getConfig(configOverrides);
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + cfg.session.maxAgeMs).toISOString();

  const user = withTransaction(() => {
    updateUserLastLogin(userRow.id, nowIso);
    pruneExpiredSessions(nowIso, userRow.id);
    createSession({
      tokenHash,
      userId: userRow.id,
      ipAddress,
      userAgent,
      expiresAt,
    });
    return findUserById(userRow.id);
  });

  return {
    user,
    rawToken,
  };
}

export function logoutSession(tokenHash) {
  if (tokenHash) {
    deleteSessionByTokenHash(tokenHash);
  }
  return { ok: true };
}

export function updateProfile(userId, { fullName, companyName }) {
  if (fullName === undefined && companyName === undefined) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Aucun champ de profil à mettre à jour.');
  }

  const cleanFullName = sanitizeOptionalName(fullName, 'fullName');
  const cleanCompanyName = sanitizeOptionalName(companyName, 'companyName');

  const updated = updateUserProfile(userId, {
    fullName: cleanFullName,
    companyName: cleanCompanyName,
  });

  if (!updated) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
  }

  return { user: updated };
}

export async function changePassword(userId, currentSessionTokenHash, { currentPassword, newPassword }) {
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Le mot de passe actuel est requis.', {
      field: 'currentPassword',
    });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Le nouveau mot de passe doit contenir entre 8 et 128 caractères.',
      { field: 'newPassword' }
    );
  }

  const internalUser = findUserById(userId, { includePasswordHash: true });
  if (!internalUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
  }

  const matches = await verifyPassword(currentPassword, internalUser.passwordHash);
  if (!matches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Mot de passe actuel incorrect.');
  }

  const nextHash = await hashPassword(newPassword);

  withTransaction(() => {
    updateUserPassword(userId, nextHash);
    deleteUserSessions(userId, { exceptTokenHash: currentSessionTokenHash || null });
  });

  return { ok: true };
}

export function exportAccountData(userId) {
  const user = findUserById(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
  }

  const creditLedger = listCreditLedgerByUser(userId, 500);
  const orders = listOrdersByUser(userId, 200);
  const reports = listAllUserReportsForExport(userId);

  return {
    exportedAt: new Date().toISOString(),
    user,
    creditsBalance: user.creditsBalance,
    creditLedger,
    orders,
    reports,
  };
}

export async function deleteAccount(userId, { password, confirmation }) {
  if (confirmation !== 'SUPPRIMER') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Veuillez saisir exactement « SUPPRIMER » pour confirmer la suppression du compte.',
      { field: 'confirmation' }
    );
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Votre mot de passe est requis pour supprimer le compte.', {
      field: 'password',
    });
  }

  const internalUser = findUserById(userId, { includePasswordHash: true });
  if (!internalUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
  }

  const ok = await verifyPassword(password, internalUser.passwordHash);
  if (!ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Mot de passe incorrect.');
  }

  deleteUserAccountCascade(userId);
  return { ok: true, deleted: true };
}

/**
 * Synchronously ensures the configured ADMIN_EMAIL / ADMIN_PASSWORD user exists
 * with role = 'admin' (idempotent; runs inside synchronous createApp()).
 */
export function bootstrapAdminSync(configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  const adminEmail = cfg.auth.adminEmail;
  const adminPassword = cfg.auth.adminPassword;

  if (!adminEmail || !adminPassword) {
    return null;
  }
  if (!validateEmail(adminEmail) || adminPassword.length < 8) {
    return null;
  }

  return withTransaction(() => {
    const existing = findUserByEmail(adminEmail);
    if (existing) {
      if (existing.role !== 'admin') {
        return promoteUserToAdmin(existing.id);
      }
      return findUserById(existing.id);
    }

    const passwordHash = hashPasswordSync(adminPassword);
    return createUser({
      email: adminEmail,
      passwordHash,
      fullName: cfg.auth.adminName,
      role: 'admin',
      initialCredits: cfg.auth.signupBonusCredits,
      acceptedTermsAt: new Date().toISOString(),
    });
  });
}

export const bootstrapAdmin = bootstrapAdminSync;
export { toPublicUser };
