import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ExternalLink,
  FileCheck2,
  Globe2,
  Loader2,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api.js';
import { Link } from '../lib/router.jsx';

const ACCESS_FILTERS = [
  { id: 'all', label: 'Tous les pays (12)' },
  { id: 'live', label: 'Open Data Live actif' },
  { id: 'api_key', label: 'API officielle partenaire' },
  { id: 'portal', label: 'Portail officiel / Certificat' },
  { id: 'b2b', label: 'Accès B2B (ex. Allemagne)' },
];

function getBadgeProps(status) {
  if (status === 'live_full') return { cls: 'ok', text: 'Connecteur Live actif' };
  if (status === 'live_partial') return { cls: 'info', text: 'Live partiel + Import guidé' };
  if (status === 'ready_key_required') return { cls: 'warn', text: 'Connecteur officiel disponible' };
  if (status === 'b2b_required') return { cls: 'danger', text: 'Accès partenaire B2B' };
  return { cls: 'neutral', text: 'Portail officiel public' };
}

function getAccessSummary(accessModel) {
  if (accessModel === 'open_data_public') return 'Accès Open Data public sans inscription';
  if (accessModel === 'free_api_key') return 'API gouvernementale officielle agréée';
  if (accessModel === 'owner_portal') return 'Portail public officiel (action vendeur)';
  if (accessModel === 'owner_certificate') return 'Certificat officiel vérifiable (ex. Car-Pass)';
  if (accessModel === 'b2b_commercial') return 'Réseau partenaire B2B / assureurs';
  return 'Source publique européenne';
}

export default function RegistriesView({ registries: propRegistries = [] }) {
  const [fetchedRegistries, setFetchedRegistries] = useState([]);
  const [fetching, setFetching] = useState(propRegistries.length === 0);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (propRegistries.length > 0) return undefined;
    let cancelled = false;
    api
      .getRegistries()
      .then((res) => {
        if (!cancelled) {
          setFetchedRegistries(res?.registries || []);
          setFetching(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propRegistries.length]);

  const registries = propRegistries.length > 0 ? propRegistries : fetchedRegistries;
  const loading = propRegistries.length === 0 && fetching;

  const filtered = registries.filter((reg) => {
    if (filter === 'all') return true;
    if (filter === 'live') return reg.connectorStatus === 'live_full' || reg.connectorStatus === 'live_partial';
    if (filter === 'api_key') return reg.accessModel === 'free_api_key';
    if (filter === 'portal') return reg.accessModel === 'owner_portal' || reg.accessModel === 'owner_certificate';
    if (filter === 'b2b') return reg.accessModel === 'b2b_commercial';
    return true;
  });

  return (
    <main className="container" style={{ paddingBottom: 56 }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="status-badge ok">
            <Radio size={13} aria-hidden="true" />
            12 registres européens cartographiés
          </span>
        </div>
        <h1>Couverture européenne &amp; registres officiels</h1>
        <p>
          Découvrez les équivalents nationaux d’HistoVec dans 12 pays d’Europe : les données ouvertes
          interrogées en temps réel (Pays-Bas RDW, RappelConso FR, décodage VIN ISO 3779 / vPIC), les
          registres partenaires et les démarches vendeur officielles (HistoVec, Car-Pass).
        </p>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }} role="group" aria-label="Filtrer les registres">
        {ACCESS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={22} className="spin" aria-hidden="true" />
          <p>Chargement des registres européens…</p>
        </div>
      ) : (
        <div className="card-grid-2">
          {filtered.map((reg) => {
            const badge = getBadgeProps(reg.connectorStatus);
            return (
              <article key={reg.code} className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="vin-chip">{reg.code}</span>
                      <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>{reg.country}</h2>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-secondary)' }}>
                      {reg.registry}
                    </div>
                  </div>
                  <span className={`status-badge ${badge.cls}`}>{badge.text}</span>
                </div>

                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                  {(reg.freeOfficialData || []).map((item, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {item}
                    </li>
                  ))}
                </ul>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'var(--bg-canvas)',
                    fontSize: 12.5,
                    color: 'var(--ink-secondary)',
                  }}
                >
                  <strong>Limites &amp; accès :</strong> {reg.limitations}
                </div>

                <div
                  style={{
                    marginTop: 'auto',
                    paddingTop: 10,
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-muted)' }}>
                    <ShieldCheck size={13} aria-hidden="true" />
                    <span>{getAccessSummary(reg.accessModel)}</span>
                  </div>

                  {reg.officialUrl && (
                    <a
                      href={reg.officialUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                    >
                      <Globe2 size={13} aria-hidden="true" />
                      Portail officiel <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Bottom CTA */}
      <section className="surface-card public-share-cta-card" style={{ marginTop: 28 }}>
        <div>
          <h2 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontSize: 19 }}>
            Prêt à vérifier un numéro VIN ou une plaque européenne ?
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-secondary)' }}>
            Lancez une pré-vérification gratuite ou fusionnez un rapport HistoVec français sans consommer de crédit.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/histovec" className="btn btn-secondary btn-sm">
            <FileCheck2 size={15} aria-hidden="true" />
            Import HistoVec (0 crédit)
          </Link>
          <Link to="/" className="btn btn-primary btn-sm">
            Lancer une pré-vérification
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
