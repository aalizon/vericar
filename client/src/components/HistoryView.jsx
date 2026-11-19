import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Columns2,
  FolderClock,
  Loader2,
  Lock,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import { Link } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

function riskLabel(risk) {
  if (risk === 'high') return { text: 'Risque élevé', tone: 'danger' };
  if (risk === 'medium') return { text: 'Vigilance', tone: 'warn' };
  return { text: 'Serein', tone: 'ok' };
}

function originLabel(origin) {
  if (origin === 'live_open_data') return 'Registre officiel live';
  if (origin === 'live_vin') return 'VIN live';
  if (origin === 'histovec_fused') return 'HistoVec fusionné';
  if (origin === 'demo_enriched') return 'Dossier démo';
  return 'Pré-rapport guidé';
}

export default function HistoryView({ onReportsChanged }) {
  const { isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const { showToast } = useToast();

  const [reports, setReports] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [comparing, setComparing] = useState(false);

  const loadReports = useCallback(
    async (q = '') => {
      if (!isAuthenticated) return;
      setLoading(true);
      try {
        const res = await api.listReports({ q, limit: 50 });
        const list = Array.isArray(res?.reports) ? res.reports : [];
        setReports(list);
        onReportsChanged?.(list.length);
      } catch (err) {
        showToast({ type: 'error', message: err?.message || 'Impossible de charger vos rapports.' });
      } finally {
        setLoading(false);
      }
    },
    [isAuthenticated, onReportsChanged, showToast]
  );

  useEffect(() => {
    if (authLoading || !isAuthenticated) return undefined;
    let cancelled = false;
    api
      .listReports({ q: '', limit: 50 })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.reports) ? res.reports : [];
        setReports(list);
        onReportsChanged?.(list.length);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        showToast({ type: 'error', message: err?.message || 'Impossible de charger vos rapports.' });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, onReportsChanged, showToast]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadReports(searchQuery);
  };

  const toggleSelect = (id) => {
    setCompareData(null);
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleCompare = async () => {
    if (selectedIds.length !== 2) return;
    setComparing(true);
    try {
      const [r1, r2] = await Promise.all([api.getReport(selectedIds[0]), api.getReport(selectedIds[1])]);
      setCompareData([r1, r2]);
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Impossible de comparer ces deux rapports.' });
    } finally {
      setComparing(false);
    }
  };

  const handleDelete = async (id, label) => {
    try {
      await api.deleteReport(id);
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      setCompareData(null);
      showToast({ type: 'info', message: `Rapport ${label} supprimé de votre bibliothèque.` });
      await loadReports(searchQuery);
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Échec de la suppression.' });
    }
  };

  if (authLoading) {
    return (
      <main className="container saas-page">
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Chargement de votre bibliothèque…</p>
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
          <h1>Retrouvez tous vos rapports véhicule</h1>
          <p>
            Connectez-vous pour consulter vos dossiers débloqués, comparer deux véhicules côte à côte
            et partager vos liens vérifiés.
          </p>
          <div className="guard-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openAuthModal({ mode: 'login', returnTo: '/mes-rapports' })}
            >
              Connexion
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openAuthModal({ mode: 'register', returnTo: '/mes-rapports' })}
            >
              Créer un compte
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container saas-page">
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <span className="eyebrow">Bibliothèque personnelle</span>
          <h1>Mes rapports &amp; comparateur</h1>
          <p className="section-subtitle">
            Consultez vos dossiers débloqués à tout moment sans consommer de nouveau crédit, ou
            sélectionnez 2 véhicules pour les comparer côte à côte.
          </p>
        </div>
        <Link to="/" className="btn btn-primary btn-sm">
          Nouvelle vérification
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>

      <div className="history-toolbar">
        <form className="history-search-form" onSubmit={handleSearchSubmit}>
          <div className="history-search-input-wrap">
            <Search size={15} className="history-search-icon" aria-hidden="true" />
            <input
              id="history-search-input"
              type="search"
              className="text-input"
              placeholder="Rechercher par VIN, plaque, marque ou modèle…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-secondary btn-sm">
            Filtrer
          </button>
        </form>

        <div className="history-compare-actions">
          <button
            id="btn-compare-selected"
            type="button"
            className="btn btn-primary btn-sm"
            disabled={selectedIds.length !== 2 || comparing}
            onClick={handleCompare}
          >
            {comparing ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <Columns2 size={15} aria-hidden="true" />
            )}
            Comparer ({selectedIds.length}/2)
          </button>
        </div>
      </div>

      {/* Side-by-side Comparator */}
      {compareData && (
        <section className="surface-card compare-card" id="compare-panel" aria-label="Comparateur côte à côte">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>
              Comparaison côte à côte
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompareData(null)}>
              Fermer
            </button>
          </div>
          <div className="compare-card-grid">
            {compareData.map((r) => {
              const badge = riskLabel(r.riskLevel);
              return (
                <div
                  key={r.id}
                  style={{
                    padding: 16,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-canvas)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <strong>
                      {r.vehicle?.make} {r.vehicle?.model} ({r.vehicle?.year || '—'})
                    </strong>
                    <span className={`status-badge ${badge.tone}`}>{r.trustScore}/100</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 4 }}>
                    {r.vehicle?.vin || r.vehicle?.plate || r.query}
                  </div>
                  <dl
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px 12px',
                      margin: '14px 0 12px',
                      fontSize: 13.5,
                    }}
                  >
                    <div>
                      <dt style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Compteur</dt>
                      <dd style={{ margin: 0, fontWeight: 600 }}>
                        {r.mileage?.rollbackDetected ? 'Anomalie détectée' : r.mileage?.statusLabel || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Sinistres</dt>
                      <dd style={{ margin: 0, fontWeight: 600 }}>{r.damages?.count ?? 0}</dd>
                    </div>
                    <div>
                      <dt style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Rappels</dt>
                      <dd style={{ margin: 0, fontWeight: 600 }}>{r.recalls?.length ?? 0}</dd>
                    </div>
                    <div>
                      <dt style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Crit’Air</dt>
                      <dd style={{ margin: 0, fontWeight: 600 }}>{r.vehicle?.critAir?.label || '—'}</dd>
                    </div>
                  </dl>
                  <Link to={`/rapport/${encodeURIComponent(r.id)}`} className="btn btn-secondary btn-sm">
                    Ouvrir ce dossier
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {loading ? (
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Chargement de vos dossiers…</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="surface-card empty-state-card">
          <FolderClock size={32} color="var(--ink-muted)" aria-hidden="true" />
          <h2 style={{ margin: '10px 0 6px', fontSize: 18 }}>Aucun rapport enregistré</h2>
          <p style={{ margin: '0 0 16px', color: 'var(--ink-secondary)' }}>
            Lancez une pré-vérification gratuite par VIN ou plaque, ou importez un rapport HistoVec
            pour commencer votre bibliothèque.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/" className="btn btn-primary btn-sm">
              Vérifier un véhicule
            </Link>
            <Link to="/histovec" className="btn btn-secondary btn-sm">
              Importer un rapport HistoVec
            </Link>
          </div>
        </div>
      ) : (
        <div className="surface-card" style={{ padding: 16 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Comp.</th>
                  <th>Véhicule</th>
                  <th>Identifiant</th>
                  <th>Source</th>
                  <th>Score</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((item) => {
                  const badge = riskLabel(item.riskLevel);
                  const checked = selectedIds.includes(item.id);
                  return (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`Sélectionner ${item.make || ''} ${item.model || ''} pour comparaison`}
                          onChange={() => toggleSelect(item.id)}
                        />
                      </td>
                      <td>
                        <Link
                          to={`/rapport/${encodeURIComponent(item.id)}`}
                          style={{ fontWeight: 700, color: 'var(--ink-primary)' }}
                        >
                          {item.make || 'Véhicule'} {item.model || ''}
                        </Link>
                        {item.year ? ` (${item.year})` : ''}
                        {item.isShared && (
                          <span
                            className="status-badge info"
                            style={{ marginLeft: 8, fontSize: 11, padding: '2px 7px' }}
                          >
                            <Share2 size={11} aria-hidden="true" /> Partagé
                          </span>
                        )}
                      </td>
                      <td className="mono">{item.vin || item.plate || item.query}</td>
                      <td>{originLabel(item.dataOrigin)}</td>
                      <td>
                        <span className={`status-badge ${badge.tone}`}>
                          {item.trustScore}/100 · {badge.text}
                        </span>
                      </td>
                      <td className="mono">
                        {item.createdAt ? new Date(item.createdAt).toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td>
                        <div className="row-actions-group">
                          <Link
                            to={`/rapport/${encodeURIComponent(item.id)}`}
                            className="btn btn-secondary btn-sm"
                          >
                            Ouvrir
                          </Link>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Supprimer le rapport ${item.id}`}
                            onClick={() => handleDelete(item.id, `${item.make || ''} ${item.model || ''}`.trim())}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
