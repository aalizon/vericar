import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Coins,
  Database,
  FileText,
  FlaskConical,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { api } from '../../api.js';
import { Link } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

function formatEuros(cents) {
  return `${(Number(cents || 0) / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminView() {
  const { isAuthenticated, isAdmin, loading: authLoading, openAuthModal } = useAuth();
  const { showToast } = useToast();

  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Credit grant form state
  const [selectedUserId, setSelectedUserId] = useState('');
  const [delta, setDelta] = useState('3');
  const [description, setDescription] = useState('Geste commercial / support client');
  const [submittingGrant, setSubmittingGrant] = useState(false);

  const loadAdminData = useCallback(async () => {
    if (!isAuthenticated || !isAdmin) return;
    setLoading(true);
    setError('');
    try {
      const [ovRes, usersRes] = await Promise.all([api.getAdminOverview(), api.getAdminUsers()]);
      setOverview(ovRes);
      const list = Array.isArray(usersRes?.users) ? usersRes.users : [];
      setUsers(list);
      if (list.length > 0 && !selectedUserId) {
        setSelectedUserId(list[0].id);
      }
    } catch (err) {
      setError(err?.message || 'Impossible de charger la console d’administration.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isAdmin, selectedUserId]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !isAdmin) return undefined;
    let cancelled = false;
    Promise.all([api.getAdminOverview(), api.getAdminUsers()])
      .then(([ovRes, usersRes]) => {
        if (cancelled) return;
        setOverview(ovRes);
        const list = Array.isArray(usersRes?.users) ? usersRes.users : [];
        setUsers(list);
        setSelectedUserId((prev) => prev || list[0]?.id || '');
        setError('');
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Impossible de charger la console d’administration.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, isAdmin]);

  const handleAdjustCredits = async (e) => {
    e.preventDefault();
    const numericDelta = Number.parseInt(delta, 10);
    if (!selectedUserId) {
      showToast({ type: 'error', message: 'Veuillez sélectionner un utilisateur.' });
      return;
    }
    if (!Number.isInteger(numericDelta) || numericDelta === 0) {
      showToast({ type: 'error', message: 'Indiquez un entier non nul.' });
      return;
    }
    setSubmittingGrant(true);
    try {
      const res = await api.adjustAdminUserCredits(selectedUserId, {
        delta: numericDelta,
        description: description.trim(),
      });
      showToast({
        type: 'success',
        title: 'Solde ajusté',
        message: `${res.user.email} dispose désormais de ${res.user.creditsBalance} crédit(s).`,
      });
      await loadAdminData();
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Échec de l’ajustement de crédits.' });
    } finally {
      setSubmittingGrant(false);
    }
  };

  if (authLoading || (isAuthenticated && isAdmin && loading)) {
    return (
      <main className="container saas-page">
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Chargement de la console d’administration…</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="container saas-page">
        <section className="surface-card guard-card">
          <span className="guard-icon-badge" aria-hidden="true">
            <Lock size={24} />
          </span>
          <h1>Authentification administrateur requise</h1>
          <p>Connectez-vous avec un compte administrateur pour accéder aux KPIs et à l’exploitation.</p>
          <div className="guard-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openAuthModal({ mode: 'login', returnTo: '/admin' })}
            >
              Connexion
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="container saas-page">
        <section className="surface-card guard-card" role="alert">
          <span className="guard-icon-badge danger" aria-hidden="true">
            <ShieldAlert size={24} />
          </span>
          <h1>Accès refusé (403)</h1>
          <p>Cette console est strictement réservée aux comptes administrateurs VériCar Europe.</p>
          <div className="guard-actions">
            <Link to="/" className="btn btn-primary">
              Retour à l’accueil
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const kpis = overview?.kpis || {};
  const telemetry = overview?.connectors?.telemetry24h || [];
  const registries = overview?.connectors?.registries || [];
  const recentOrders = overview?.recentOrders || [];
  const recentReports = overview?.recentReports || [];

  const filteredUsers = userSearch.trim()
    ? users.filter((u) => {
        const needle = userSearch.trim().toLowerCase();
        return (
          (u.email || '').toLowerCase().includes(needle) ||
          (u.fullName || '').toLowerCase().includes(needle) ||
          (u.companyName || '').toLowerCase().includes(needle)
        );
      })
    : users;

  return (
    <main className="container saas-page" id="admin-dashboard">
      <div className="admin-header-bar">
        <div>
          <span className="eyebrow">
            <Shield size={13} aria-hidden="true" style={{ marginRight: 6 }} />
            Exploitation SaaS
          </span>
          <h1 style={{ margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 28 }}>
            Console d’administration VériCar Europe
          </h1>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={loadAdminData}>
          <RefreshCw size={15} aria-hidden="true" />
          Actualiser
        </button>
      </div>

      {error && (
        <div className="form-alert error" role="alert" style={{ marginBottom: 18 }}>
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI GRID */}
      <section className="admin-kpi-grid" aria-label="Indicateurs clés">
        <article className="surface-card admin-kpi-card">
          <div className="admin-kpi-label">
            <Users size={14} aria-hidden="true" /> Utilisateurs
          </div>
          <div className="admin-kpi-value mono">{kpis.usersTotal ?? 0}</div>
          <div className="admin-kpi-sub">
            {kpis.activeSessions ?? 0} session(s) active(s) · {kpis.adminUsers ?? 0} admin(s)
          </div>
        </article>

        <article className="surface-card admin-kpi-card">
          <div className="admin-kpi-label">
            <FileText size={14} aria-hidden="true" /> Rapports générés
          </div>
          <div className="admin-kpi-value mono">{kpis.reportsTotal ?? 0}</div>
          <div className="admin-kpi-sub">
            {kpis.reportsLast24h ?? 0} sur 24h · {kpis.reportsUnlockedPaid ?? 0} payants
          </div>
        </article>

        <article className="surface-card admin-kpi-card">
          <div className="admin-kpi-label">
            <Coins size={14} aria-hidden="true" /> Crédits en circulation
          </div>
          <div className="admin-kpi-value mono">{kpis.creditsCirculating ?? 0}</div>
          <div className="admin-kpi-sub">
            {kpis.creditsIssued ?? 0} émis · {kpis.creditsConsumed ?? 0} consommés
          </div>
        </article>

        <article className="surface-card admin-kpi-card">
          <div className="admin-kpi-label">
            <Database size={14} aria-hidden="true" /> Cache API (SQLite)
          </div>
          <div className="admin-kpi-value mono">{kpis.activeCacheEntries ?? 0}</div>
          <div className="admin-kpi-sub">
            {kpis.apiCacheEntries ?? 0} entrée(s) totale(s) · mode{' '}
            <strong>{overview?.billing?.billingMode || 'sandbox'}</strong>
          </div>
        </article>
      </section>

      {/* LIVE VS SANDBOX REVENUE SEPARATION */}
      <section className="revenue-split-grid" aria-label="Chiffre d’affaires Stripe vs Sandbox">
        <article className="surface-card revenue-card live">
          <div className="admin-kpi-label">Chiffre d’affaires Réel (Stripe)</div>
          <div className="revenue-amount mono">{formatEuros(kpis.revenueLiveCents)}</div>
          <div className="admin-kpi-sub">
            {kpis.ordersLivePaid ?? 0} commande(s) payée(s) ·{' '}
            {overview?.billing?.stripeConfigured ? 'Stripe configuré' : 'Stripe non configuré'}
          </div>
        </article>

        <article className="surface-card revenue-card sandbox">
          <div className="admin-kpi-label">
            <FlaskConical size={14} aria-hidden="true" /> Volume Simulé (Mode Sandbox)
          </div>
          <div className="revenue-amount mono">{formatEuros(kpis.revenueSandboxCents)}</div>
          <div className="admin-kpi-sub">
            {kpis.ordersSandboxPaid ?? 0} commande(s) de test · exclu du chiffre d’affaires réel
          </div>
        </article>
      </section>

      {/* USER MANAGEMENT & CREDIT ADJUSTMENT */}
      <section className="admin-section-grid">
        <article className="surface-card" style={{ padding: 22 }}>
          <div className="admin-users-toolbar">
            <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'var(--font-display)' }}>
              Comptes utilisateurs ({filteredUsers.length})
            </h2>
            <div className="history-search-input-wrap" style={{ maxWidth: 260 }}>
              <Search size={15} className="history-search-icon" aria-hidden="true" />
              <input
                type="search"
                className="text-input"
                placeholder="Filtrer par e-mail ou nom…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle</th>
                  <th>Solde</th>
                  <th>Rapports</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.fullName || '—'}</div>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                        {u.email}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${u.role === 'admin' ? 'info' : 'neutral'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {u.creditsBalance}
                    </td>
                    <td className="mono">{u.reportsCount ?? 0}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedUserId(u.id)}
                      >
                        Sélectionner
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="surface-card" style={{ padding: 22 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
            Ajustement manuel de crédits
          </h2>
          <form className="admin-grant-form" onSubmit={handleAdjustCredits}>
            <div className="form-group">
              <label htmlFor="admin-user-select" className="field-label">
                Compte cible
              </label>
              <select
                id="admin-user-select"
                className="text-input"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email} ({u.creditsBalance} cr.)
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="admin-delta-input" className="field-label">
                Delta de crédits (positif ou négatif)
              </label>
              <input
                id="admin-delta-input"
                type="number"
                className="text-input mono"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                required
              />
              <div className="preset-deltas">
                {['+1', '+3', '+10', '-1'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="preset-chip mono"
                    onClick={() => setDelta(preset.replace('+', ''))}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="admin-desc-input" className="field-label">
                Motif (journalisé dans le ledger)
              </label>
              <input
                id="admin-desc-input"
                type="text"
                className="text-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                minLength={3}
                maxLength={200}
                required
              />
            </div>

            <button
              id="btn-admin-adjust-credits"
              type="submit"
              className="btn btn-primary"
              disabled={submittingGrant}
            >
              {submittingGrant && <Loader2 size={15} className="spin" aria-hidden="true" />}
              Appliquer l’ajustement
            </button>
          </form>
        </article>
      </section>

      {/* CONNECTORS & ENV CONFIGURATION MATRIX (ADMIN ONLY) */}
      <section className="surface-card" style={{ padding: 22, marginTop: 20 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
          <Activity size={16} aria-hidden="true" style={{ marginRight: 8, verticalAlign: -2 }} />
          Connecteurs européens, clés d’API &amp; télémétrie 24h
        </h2>

        <div className="env-matrix-grid">
          {registries
            .filter((r) => (r.envVars && r.envVars.length > 0) || r.code === 'NL')
            .map((r) => (
              <div key={r.code} className="env-card">
                <div>
                  <strong>
                    {r.code} · {r.country}
                  </strong>
                  <div className="env-scope">{r.statusLabel}</div>
                  {r.envVars && r.envVars.length > 0 && (
                    <div className="env-key mono">{r.envVars.join(', ')}</div>
                  )}
                </div>
                <span className={`status-badge ${r.configured ? 'ok' : 'warn'}`}>
                  {r.configured ? 'Actif' : 'Non configuré'}
                </span>
              </div>
            ))}
        </div>

        {telemetry.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Connecteur</th>
                  <th>Appels (24h)</th>
                  <th>Succès</th>
                  <th>Latence moy.</th>
                  <th>Dernier contrôle</th>
                </tr>
              </thead>
              <tbody>
                {telemetry.map((t) => (
                  <tr key={t.connector}>
                    <td className="mono">{t.connector}</td>
                    <td className="mono">{t.totalCalls}</td>
                    <td className="mono">
                      {t.onlineCalls}/{t.totalCalls}
                    </td>
                    <td className="mono">{t.avgLatencyMs} ms</td>
                    <td className="mono">{formatDateTime(t.lastCheckedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* RECENT ORDERS & REPORTS */}
      <section className="admin-section-grid" style={{ marginTop: 20 }}>
        <article className="surface-card" style={{ padding: 22 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
            Dernières commandes
          </h2>
          {recentOrders.length === 0 ? (
            <p className="saas-muted-note">Aucune commande enregistrée.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Facture</th>
                    <th>Client</th>
                    <th>Mode</th>
                    <th>TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.slice(0, 10).map((o) => (
                    <tr key={o.id}>
                      <td className="mono">{o.invoiceNumber}</td>
                      <td className="mono">{o.userEmail || o.userId}</td>
                      <td>
                        <span className={`status-badge ${o.provider === 'stripe' ? 'ok' : 'warn'}`}>
                          {o.provider}
                        </span>
                      </td>
                      <td className="mono">{formatEuros(o.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="surface-card" style={{ padding: 22 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
            Derniers rapports générés
          </h2>
          {recentReports.length === 0 ? (
            <p className="saas-muted-note">Aucun rapport enregistré.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Véhicule</th>
                    <th>Origine</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReports.slice(0, 10).map((r) => (
                    <tr key={r.id}>
                      <td className="mono">
                        <Link to={`/rapport/${encodeURIComponent(r.id)}`}>{r.id}</Link>
                      </td>
                      <td>
                        {r.make} {r.model} ({r.query})
                      </td>
                      <td>{r.dataOrigin}</td>
                      <td className="mono">{r.trustScore}/100</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
