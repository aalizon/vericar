import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_DB_PATH, SERVER_ROOT, resolveDbPath } from '../config.js';
import { runMigrations } from './migrations.js';

export { DEFAULT_DB_PATH, SERVER_ROOT, resolveDbPath };

let dbInstance = null;
let currentDbPath = null;
let savepointCounter = 0;

/**
 * Initializes (or returns) the SQLite DatabaseSync singleton with WAL, FK=ON,
 * busy_timeout=5000, synchronous=NORMAL, and runs all pending schema migrations.
 * Preserves an already-open DB (such as :memory: in tests) when called without args.
 */
export function initDb(dbPath) {
  if (dbInstance) {
    if (dbPath === undefined) {
      return dbInstance;
    }
    const requestedPath = resolveDbPath(dbPath);
    if (requestedPath === currentDbPath) {
      return dbInstance;
    }
    closeDb();
  }

  const targetPath = resolveDbPath(dbPath);

  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
    `);

    dbInstance = db;
    currentDbPath = targetPath;
    savepointCounter = 0;

    runMigrations(db, withTransaction);
    return db;
  } catch (err) {
    try {
      db.close();
    } catch {
      // Ignore close error
    }
    dbInstance = null;
    currentDbPath = null;
    savepointCounter = 0;
    throw err;
  }
}

export function getDb() {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

export function getCurrentDbPath() {
  return currentDbPath;
}

/**
 * Executes a synchronous callback inside an atomic BEGIN IMMEDIATE transaction,
 * automatically supporting nested SAVEPOINTs when already inside a transaction.
 */
export function withTransaction(fn, dbArg = null) {
  if (typeof fn !== 'function') {
    throw new TypeError('withTransaction expects a callback function');
  }

  const db = dbArg || getDb();
  const isNested = Boolean(db.isTransaction);

  if (!isNested) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(db);
      if (result && typeof result.then === 'function') {
        throw new TypeError('withTransaction callback must be synchronous (DatabaseSync)');
      }
      db.exec('COMMIT');
      return result;
    } catch (err) {
      if (db.isTransaction) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Ignore rollback error
        }
      }
      throw err;
    }
  }

  const spName = `sp_${++savepointCounter}`;
  db.exec(`SAVEPOINT ${spName}`);
  try {
    const result = fn(db);
    if (result && typeof result.then === 'function') {
      throw new TypeError('withTransaction callback must be synchronous (DatabaseSync)');
    }
    db.exec(`RELEASE SAVEPOINT ${spName}`);
    return result;
  } catch (err) {
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${spName}`);
      db.exec(`RELEASE SAVEPOINT ${spName}`);
    } catch {
      // Ignore savepoint rollback error
    }
    throw err;
  }
}

export function closeDb() {
  if (!dbInstance) return;
  try {
    if (dbInstance.isTransaction) {
      try {
        dbInstance.exec('ROLLBACK');
      } catch {
        // Ignore rollback error during close
      }
    }
    dbInstance.close();
  } finally {
    dbInstance = null;
    currentDbPath = null;
    savepointCounter = 0;
  }
}

export function resetDbForTests(dbPath = ':memory:') {
  closeDb();
  return initDb(dbPath);
}

export function checkDbHealth() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 AS ok').get();
    if (row && Number(row.ok) === 1) {
      return { ok: true };
    }
    return { ok: false, error: 'Database health query returned unexpected result' };
  } catch (err) {
    return { ok: false, error: err?.message || 'Database unavailable' };
  }
}
