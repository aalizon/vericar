export const MIGRATIONS = [
  {
    version: 1,
    name: '001_legacy_core_tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL,
          query_type TEXT NOT NULL,
          country TEXT NOT NULL,
          vin TEXT,
          plate TEXT,
          make TEXT,
          model TEXT,
          year INTEGER,
          trust_score INTEGER NOT NULL,
          risk_level TEXT NOT NULL,
          data_origin TEXT NOT NULL,
          summary_json TEXT NOT NULL,
          report_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reports_query ON reports(query);

        CREATE TABLE IF NOT EXISTS connector_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          connector TEXT NOT NULL,
          status TEXT NOT NULL,
          latency_ms INTEGER NOT NULL,
          detail TEXT,
          checked_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_connector_metrics_connector_id
          ON connector_metrics(connector, id DESC);
        CREATE INDEX IF NOT EXISTS idx_connector_metrics_checked_at
          ON connector_metrics(checked_at);
      `);
    },
  },
  {
    version: 2,
    name: '002_saas_users_sessions_billing_cache',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name TEXT,
          company_name TEXT,
          role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
          credits_balance INTEGER NOT NULL DEFAULT 0 CHECK (credits_balance >= 0),
          accepted_terms_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_login_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ip_address TEXT,
          user_agent TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS invoice_sequences (
          year INTEGER PRIMARY KEY,
          last_seq INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          invoice_number TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pack_id TEXT NOT NULL,
          pack_name TEXT NOT NULL,
          credits INTEGER NOT NULL CHECK (credits > 0),
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          currency TEXT NOT NULL DEFAULT 'EUR',
          provider TEXT NOT NULL CHECK (provider IN ('stripe', 'sandbox')),
          provider_session_id TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
          accepted_waiver_at TEXT,
          metadata_json TEXT,
          paid_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

        CREATE TABLE IF NOT EXISTS credit_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          delta INTEGER NOT NULL,
          balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
          reason TEXT NOT NULL CHECK (reason IN ('signup_bonus', 'purchase', 'report_unlock', 'admin_grant', 'admin_adjustment', 'refund')),
          reference_id TEXT,
          description TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference ON credit_ledger(reference_id);

        CREATE TABLE IF NOT EXISTS api_cache (
          cache_key TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at ON api_cache(expires_at);
        CREATE INDEX IF NOT EXISTS idx_api_cache_provider ON api_cache(provider);
      `);
    },
  },
  {
    version: 3,
    name: '003_reports_saas_columns_and_indexes',
    up(db) {
      const existingCols = new Set(
        db.prepare('PRAGMA table_info(reports)').all().map((c) => c.name)
      );

      const columnsToAdd = [
        ['user_id', 'TEXT REFERENCES users(id) ON DELETE CASCADE'],
        ['normalized_key', 'TEXT'],
        ['share_token', 'TEXT'],
        ['is_shared', 'INTEGER NOT NULL DEFAULT 0'],
        ['shared_at', 'TEXT'],
        ['credit_cost', 'INTEGER NOT NULL DEFAULT 0'],
      ];

      for (const [col, definition] of columnsToAdd) {
        if (!existingCols.has(col)) {
          db.exec(`ALTER TABLE reports ADD COLUMN ${col} ${definition};`);
        }
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reports_user_norm_key ON reports(user_id, normalized_key);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_share_token
          ON reports(share_token) WHERE share_token IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_reports_vin ON reports(vin);
        CREATE INDEX IF NOT EXISTS idx_reports_plate ON reports(plate);
      `);
    },
  },
];

function defaultTxRunner(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure
      }
    }
    throw err;
  }
}

export function runMigrations(db, txRunner = null) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version))
  );

  const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);

  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;

    const applyStep = (conn) => {
      migration.up(conn);
      conn
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
    };

    if (typeof txRunner === 'function') {
      txRunner(applyStep, db);
    } else {
      defaultTxRunner(db, applyStep);
    }
  }
}

export function getAppliedMigrations(db) {
  return db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC')
    .all()
    .map((row) => ({
      version: Number(row.version),
      name: row.name,
      appliedAt: row.applied_at,
    }));
}
