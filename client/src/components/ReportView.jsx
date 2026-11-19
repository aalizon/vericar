import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileCheck2,
  Gauge,
  Globe2,
  Info,
  Link2,
  Loader2,
  Printer,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Unlink,
  Wrench,
} from 'lucide-react';
import { api } from '../api.js';
import { Link } from '../lib/router.jsx';
import { copyToClipboard } from '../lib/clipboard.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import ScoreRing from './ScoreRing.jsx';
import MileageChart from './MileageChart.jsx';
import DamageDiagram from './DamageDiagram.jsx';

const COUNTRY_NAMES = {
  FR: 'France',
  NL: 'Pays-Bas',
  DE: 'Allemagne',
  BE: 'Belgique',
  GB: 'Royaume-Uni',
  IT: 'Italie',
  ES: 'Espagne',
  PL: 'Pologne',
  NO: 'Norvège',
  SE: 'Suède',
  DK: 'Danemark',
  EE: 'Estonie',
  EU: 'Europe',
};

function OriginBadge({ origin, label }) {
  const cls =
    origin === 'live_open_data' || origin === 'live_vin' || origin === 'histovec_fused'
      ? 'ok'
      : origin === 'demo_enriched'
        ? 'info'
        : 'warn';
  return <span className={`status-badge ${cls}`}>{label}</span>;
}

export default function ReportView({ report, readOnly = false, onReportUpdated }) {
  const { isAuthenticated, openAuthModal } = useAuth();
  const { showToast } = useToast();

  const [shareState, setShareState] = useState({
    isShared: Boolean(report?.isShared && report?.shareToken),
    shareToken: report?.shareToken || null,
    sharedAt: report?.sharedAt || null,
  });
  const [shareLoading, setShareLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!report) return null;

  const {
    id,
    vehicle = {},
    mileage = {},
    damages = { records: [] },
    administrative = {},
    usageHistory = {},
    inspections = [],
    recalls = [],
    timeline = [],
    valuation = {},
    alerts = [],
    sourcesConsulted = [],
    countriesVisited = [],
    ownersCount,
    trustScore,
    riskLevel,
    summary = {},
    dataOrigin,
    dataOriginLabel,
    createdAt,
    ephemeral = false,
  } = report;

  const isEphemeral = Boolean(ephemeral || String(id || '').startsWith('DEMO-'));
  const canManageShare = !readOnly && !isEphemeral && isAuthenticated;
  const shareUrl =
    shareState.isShared && shareState.shareToken && typeof window !== 'undefined'
      ? `${window.location.origin}/r/${encodeURIComponent(shareState.shareToken)}`
      : '';

  const vf = administrative.verifiedFields || null;
  const fieldVerified = (key) => (!vf ? true : vf[key] !== false);

  const stolenVerified = fieldVerified('stolen');
  const pledgeVerified = fieldVerified('pledge') || fieldVerified('opposition');
  const damageProcVerified =
    fieldVerified('vgeProcedure') || fieldVerified('veiProcedure') || fieldVerified('wokStatus');
  const insuranceVerified = fieldVerified('insuredWam');

  const openRecallsCount = recalls.filter((r) => r.status === 'open').length;
  const navItems = [
    {
      href: '#sec-synthese',
      label: 'Synthèse & Alertes',
      dot: riskLevel === 'high' ? 'danger' : riskLevel === 'medium' ? 'warn' : 'ok',
    },
    {
      href: '#sec-kilometrage',
      label: 'Kilométrage',
      dot:
        mileage.status === 'rollback'
          ? 'danger'
          : mileage.status === 'verified'
            ? 'ok'
            : 'neutral',
    },
    {
      href: '#sec-sinistres',
      label: 'Sinistres & Carrosserie',
      dot:
        damages.records?.some((d) => d.severity === 'high')
          ? 'danger'
          : damages.records?.length > 0
            ? 'warn'
            : 'ok',
    },
    {
      href: '#sec-admin',
      label: 'Vol & Situation admin.',
      dot:
        administrative.stolen || administrative.pledge || administrative.vgeProcedure
          ? 'danger'
          : usageHistory.taxiOrVtc
            ? 'warn'
            : stolenVerified || pledgeVerified || damageProcVerified
              ? 'ok'
              : 'neutral',
    },
    {
      href: '#sec-ct',
      label: 'Contrôles techniques',
      dot: inspections.length > 0 ? 'ok' : 'neutral',
    },
    {
      href: '#sec-rappels',
      label: 'Rappels sécurité',
      dot: openRecallsCount > 0 ? 'warn' : recalls.length > 0 ? 'neutral' : 'ok',
    },
    {
      href: '#sec-parcours',
      label: 'Parcours européen',
      dot: countriesVisited.length > 1 ? 'warn' : 'ok',
    },
    {
      href: '#sec-specs',
      label: 'Fiche technique & VIN',
      dot: 'ok',
    },
    {
      href: '#sec-cote',
      label: 'Cote & Négociation',
      dot: valuation.available ? 'ok' : 'neutral',
    },
  ];

  const handleEnableShare = async () => {
    setShareLoading(true);
    try {
      const res = await api.enableReportShare(id);
      const nextShare = {
        isShared: Boolean(res?.isShared),
        shareToken: res?.shareToken || null,
        sharedAt: res?.sharedAt || new Date().toISOString(),
      };
      setShareState(nextShare);
      onReportUpdated?.({ ...report, ...nextShare });

      if (nextShare.shareToken && typeof window !== 'undefined') {
        const url = `${window.location.origin}/r/${encodeURIComponent(nextShare.shareToken)}`;
        const ok = await copyToClipboard(url);
        if (ok) {
          setCopiedLink(true);
          setTimeout(() => setCopiedLink(false), 2400);
        }
        showToast({
          type: 'success',
          title: 'Lien de partage vérifié activé',
          message: ok
            ? 'Le lien public en lecture seule a été copié dans le presse-papiers.'
            : 'Votre lien public en lecture seule est prêt à être partagé.',
        });
      }
    } catch (err) {
      showToast({
        type: 'error',
        message: err?.message || 'Impossible d’activer le partage vérifié.',
      });
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2400);
      showToast({ type: 'success', message: 'Lien vérifié copié dans le presse-papiers.' });
    } else {
      showToast({ type: 'warning', message: 'Copie automatique impossible — sélectionnez le lien affiché.' });
    }
  };

  const handleRevokeShare = async () => {
    setShareLoading(true);
    try {
      await api.disableReportShare(id);
      const nextShare = { isShared: false, shareToken: null, sharedAt: null };
      setShareState(nextShare);
      onReportUpdated?.({ ...report, ...nextShare });
      showToast({
        type: 'info',
        title: 'Partage révoqué',
        message: 'L’ancien lien public ne permet plus d’accéder à ce rapport.',
      });
    } catch (err) {
      showToast({
        type: 'error',
        message: err?.message || 'Impossible de révoquer ce lien de partage.',
      });
    } finally {
      setShareLoading(false);
    }
  };

  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const specsList = [
    ['Marque', vehicle.make],
    ['Modèle / Version', vehicle.model],
    ['Finition', vehicle.trim],
    ['Année / 1re immat.', vehicle.firstRegistrationDate || vehicle.year],
    ['Carburant', vehicle.fuelType],
    ['Boîte de vitesses', vehicle.transmission],
    ['Transmission', vehicle.driveType],
    ['Puissance', vehicle.powerHp ? `${vehicle.powerHp} ch (${vehicle.powerKw || '?'} kW)` : null],
    ['Cylindrée', vehicle.displacementCC ? `${vehicle.displacementCC} cm³` : null],
    ['Cylindres', vehicle.engineCylinders],
    ['Émissions CO₂', vehicle.co2Gkm !== null && vehicle.co2Gkm !== undefined ? `${vehicle.co2Gkm} g/km` : null],
    ['Conso. mixte', vehicle.consumptionCombinedL100 ? `${vehicle.consumptionCombinedL100} L/100 km` : null],
    ['Norme Euro', vehicle.euroClass],
    ['Carrosserie', vehicle.bodyType],
    ['Couleur', vehicle.color],
    [
      'Places / Portes',
      vehicle.seats || vehicle.doors ? `${vehicle.seats || '—'} places · ${vehicle.doors || '—'} portes` : null,
    ],
    ['Masse à vide', vehicle.curbWeightKg ? `${vehicle.curbWeightKg} kg` : null],
    [
      'Prix catalogue neuf',
      vehicle.catalogPriceEur ? `${Number(vehicle.catalogPriceEur).toLocaleString('fr-FR')} €` : null,
    ],
    ['Usine / Assemblage', vehicle.assemblyPlant],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');

  return (
    <main className="container report-shell">
      <div className="report-topbar no-print">
        {!readOnly ? (
          <Link id="btn-back-home" to="/" className="btn btn-secondary btn-sm">
            <ArrowLeft size={16} aria-hidden="true" />
            Nouvelle vérification
          </Link>
        ) : (
          <div />
        )}

        <div className="report-actions">
          {!readOnly && (
            <Link id="btn-histovec-fusion" to="/histovec" className="btn btn-secondary btn-sm">
              <FileCheck2 size={15} aria-hidden="true" />
              Fusionner un HistoVec
            </Link>
          )}

          {canManageShare && !shareState.isShared && (
            <button
              id="btn-enable-share"
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={shareLoading}
              onClick={handleEnableShare}
            >
              {shareLoading ? (
                <Loader2 size={15} className="spin" aria-hidden="true" />
              ) : (
                <Share2 size={15} aria-hidden="true" />
              )}
              Activer le lien partagé
            </button>
          )}

          <button
            id="btn-print-pdf"
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => window.print()}
          >
            <Printer size={15} aria-hidden="true" />
            Exporter PDF / Imprimer
          </button>
        </div>
      </div>

      {/* Verified Share Control Bar (Owner view when active) */}
      {canManageShare && shareState.isShared && shareUrl && (
        <div
          id="report-share-bar"
          className="public-share-banner no-print"
          style={{ marginBottom: 20 }}
          role="region"
          aria-label="Gestion du lien de partage public"
        >
          <div style={{ minWidth: 0, flex: '1 1 280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
              <Link2 size={16} color="var(--accent)" aria-hidden="true" />
              <span>Lien public vérifié actif (lecture seule · sans PII)</span>
            </div>
            <div
              id="report-share-url"
              className="mono"
              style={{
                fontSize: 12.5,
                color: 'var(--accent-ink)',
                marginTop: 4,
                wordBreak: 'break-all',
              }}
            >
              {shareUrl}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              id="btn-copy-share-link"
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleCopyShareUrl}
            >
              {copiedLink ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copiedLink ? 'Lien copié' : 'Copier le lien'}
            </button>
            <Link
              id="btn-open-share-link"
              to={`/r/${encodeURIComponent(shareState.shareToken)}`}
              className="btn btn-secondary btn-sm"
            >
              <ExternalLink size={14} aria-hidden="true" />
              Aperçu public
            </Link>
            <button
              id="btn-revoke-share"
              type="button"
              className="btn btn-danger-outline btn-sm"
              disabled={shareLoading}
              onClick={handleRevokeShare}
            >
              {shareLoading ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <Unlink size={14} aria-hidden="true" />
              )}
              Révoquer
            </button>
          </div>
        </div>
      )}

      {/* Ephemeral guest demo notice */}
      {!readOnly && isEphemeral && !isAuthenticated && (
        <div className="saas-banner saas-banner-info no-print" style={{ marginBottom: 20 }}>
          <div>
            <strong>Dossier de démonstration (0 crédit)</strong> — Créez un compte gratuit pour
            sauvegarder vos propres rapports, importer un HistoVec et générer des liens vérifiés.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => openAuthModal({ mode: 'register' })}
          >
            Créer un compte gratuit
          </button>
        </div>
      )}

      <div className="report-layout">
        {/* Sticky section navigation */}
        <aside className="report-sidebar no-print" aria-label="Sommaire du rapport">
          <div className="sidebar-heading">Dossier {id}</div>
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="sidebar-link">
                <span>{item.label}</span>
                <span className={`sidebar-dot ${item.dot}`} />
              </a>
            ))}
          </nav>
        </aside>

        {/* Main report column */}
        <div className="report-content">
          {/* 1. Executive Header Card */}
          <section id="sec-synthese" className="report-hero-card">
            <div className="report-hero-top">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <OriginBadge origin={dataOrigin} label={dataOriginLabel} />
                  <span className="mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    Réf. {id} {formattedDate ? `· ${formattedDate}` : ''}
                  </span>
                </div>

                <h1 className="report-vehicle-title">
                  {vehicle.make} {vehicle.model} {vehicle.year ? `(${vehicle.year})` : ''}
                </h1>

                <div className="report-id-row">
                  {vehicle.plate && (
                    <span className={`eu-plate ${report.country === 'NL' ? 'nl' : ''}`}>
                      <span className="eu-plate-band">{report.country || 'EU'}</span>
                      <span className="eu-plate-text">{vehicle.plate}</span>
                    </span>
                  )}
                  {vehicle.vin && <span className="vin-chip">VIN : {vehicle.vin}</span>}
                  {vehicle.critAir?.level !== null && vehicle.critAir?.level !== undefined && (
                    <span
                      className="status-badge"
                      style={{
                        background: `${vehicle.critAir.color}18`,
                        color: vehicle.critAir.color,
                      }}
                    >
                      {vehicle.critAir.label}
                    </span>
                  )}
                </div>
              </div>

              <ScoreRing score={trustScore} riskLevel={riskLevel} />
            </div>

            <div className={`verdict-strip ${riskLevel}`}>
              {riskLevel === 'high' ? (
                <ShieldAlert size={22} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : riskLevel === 'medium' ? (
                <AlertTriangle size={22} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : (
                <ShieldCheck size={22} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              )}
              <div>
                <strong>{summary.verdict}</strong>
                <p>{summary.recommendation}</p>
              </div>
            </div>

            {/* Key KPI Summary Strip */}
            <div className="kpi-strip">
              <div className="kpi-cell">
                <span className="kpi-label">Compteur / Kilométrage</span>
                <span
                  className="kpi-value"
                  style={{
                    color:
                      mileage.rollbackDetected
                        ? 'var(--danger)'
                        : mileage.status === 'verified'
                          ? 'var(--ok)'
                          : 'var(--ink-primary)',
                  }}
                >
                  {mileage.rollbackDetected
                    ? 'Anomalie détectée'
                    : mileage.latestKm !== null && mileage.latestKm !== undefined
                      ? `${Number(mileage.latestKm).toLocaleString('fr-FR')} km`
                      : mileage.externalVerdict?.raw || 'Non communiqué'}
                </span>
              </div>
              <div className="kpi-cell">
                <span className="kpi-label">Sinistres déclarés</span>
                <span
                  className="kpi-value"
                  style={{ color: damages.records?.length > 0 ? 'var(--danger)' : 'var(--ok)' }}
                >
                  {damages.records?.length || 0} dossier(s)
                </span>
              </div>
              <div className="kpi-cell">
                <span className="kpi-label">Pays détectés</span>
                <span className="kpi-value">
                  {countriesVisited.map((c) => COUNTRY_NAMES[c] || c).join(' → ') || 'Europe'}
                </span>
              </div>
              <div className="kpi-cell">
                <span className="kpi-label">Rappels sécurité</span>
                <span
                  className="kpi-value"
                  style={{ color: openRecallsCount > 0 ? 'var(--warn)' : 'var(--ink-primary)' }}
                >
                  {openRecallsCount > 0
                    ? `${openRecallsCount} ouvert(s)`
                    : `${recalls.length} répertorié(s)`}
                </span>
              </div>
            </div>

            {/* Provenance Transparency */}
            <div className="source-list" aria-label="Sources interrogées">
              {sourcesConsulted.map((src, i) => (
                <span key={i} className="source-chip">
                  <span
                    className={`sidebar-dot ${
                      src.status === 'ok' ? 'ok' : src.status === 'pending' ? 'warn' : 'neutral'
                    }`}
                  />
                  <strong>{src.name}</strong>
                  <span>· {src.detail}</span>
                </span>
              ))}
            </div>

            {alerts.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div className="sidebar-heading" style={{ paddingLeft: 0 }}>
                  Points clés &amp; Alertes ({alerts.length})
                </div>
                <div className="alert-list">
                  {alerts.map((al, idx) => (
                    <div key={idx} className={`alert-item ${al.severity}`}>
                      {al.severity === 'critical' ? (
                        <ShieldAlert size={18} color="var(--danger)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                      ) : al.severity === 'warning' ? (
                        <AlertTriangle size={18} color="var(--warn)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                      ) : (
                        <Info size={18} color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                      )}
                      <div>
                        <div className="alert-item-title">
                          [{al.category}] {al.title}
                        </div>
                        <p className="alert-item-body">{al.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 2. Kilométrage */}
          <section id="sec-kilometrage" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <Gauge size={20} color="var(--accent)" aria-hidden="true" />
                  Historique kilométrique &amp; Contrôle compteur
                </h2>
                <p className="section-desc">{mileage.statusLabel}</p>
              </div>
              <span
                className={`status-badge ${
                  mileage.rollbackDetected ? 'danger' : mileage.status === 'verified' ? 'ok' : 'neutral'
                }`}
              >
                {mileage.rollbackDetected
                  ? 'Recul / Illogique'
                  : mileage.status === 'verified'
                    ? 'Compteur cohérent'
                    : 'Données partielles'}
              </span>
            </div>

            {mileage.readings?.length >= 2 && (
              <MileageChart readings={mileage.readings} rollbackEvent={mileage.rollbackEvent} />
            )}

            <div className="specs-grid" style={{ marginBottom: mileage.readings?.length ? 16 : 0 }}>
              <div className="spec-row">
                <span className="spec-key">Dernier relevé connu</span>
                <span className="spec-val mono">
                  {mileage.latestKm !== null && mileage.latestKm !== undefined
                    ? `${Number(mileage.latestKm).toLocaleString('fr-FR')} km`
                    : 'Non publié en Open Data'}
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-key">Kilométrage réel estimé</span>
                <span
                  className="spec-val mono"
                  style={{ color: mileage.rollbackDetected ? 'var(--danger)' : undefined }}
                >
                  {mileage.estimatedTrueKm !== null && mileage.estimatedTrueKm !== undefined
                    ? `~${Number(mileage.estimatedTrueKm).toLocaleString('fr-FR')} km`
                    : mileage.externalVerdict?.raw || '—'}
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-key">Rythme moyen estimé</span>
                <span className="spec-val mono">
                  {mileage.avgKmPerYear !== null && mileage.avgKmPerYear !== undefined
                    ? `${Number(mileage.avgKmPerYear).toLocaleString('fr-FR')} km / an`
                    : '—'}
                </span>
              </div>
            </div>

            {mileage.readings?.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Pays</th>
                      <th>Source du relevé</th>
                      <th>Kilométrage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mileage.readings.map((r, i) => (
                      <tr key={`${r.date}-${i}`} className={r.anomaly ? 'row-anomaly' : ''}>
                        <td className="mono">{r.date}</td>
                        <td>{COUNTRY_NAMES[r.country] || r.country}</td>
                        <td>
                          {r.source} {r.anomaly ? '— Recul suspect détecté' : ''}
                        </td>
                        <td className="mono">{Number(r.km).toLocaleString('fr-FR')} km</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 3. Sinistres & Schéma Carrosserie */}
          <section id="sec-sinistres" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <ShieldAlert size={20} color="var(--accent)" aria-hidden="true" />
                  Sinistres &amp; Schéma des zones de dommages
                </h2>
                <p className="section-desc">
                  Cliquez sur une pastille numérotée ou sur un dossier pour examiner la zone d’impact et le coût estimé.
                </p>
              </div>
              <span className={`status-badge ${damages.records?.length ? 'danger' : 'ok'}`}>
                {damages.records?.length ? `${damages.records.length} sinistre(s)` : 'Aucun sinistre déclaré'}
              </span>
            </div>

            <DamageDiagram damages={damages.records || []} note={damages.note} />
          </section>

          {/* 4. Vol, Gages & Situation Administrative */}
          <section id="sec-admin" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <ShieldCheck size={20} color="var(--accent)" aria-hidden="true" />
                  Vol, gages &amp; situation administrative
                </h2>
                <p className="section-desc">
                  Statut juridique, assurance, procédures graves (VGE/VEI/WOK) et usage commercial antérieur.
                </p>
              </div>
            </div>

            <div className="check-grid">
              <div className="check-tile">
                <div>
                  <strong>Déclaration de vol</strong>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                    {stolenVerified
                      ? 'Registres nationaux consultés'
                      : 'Non couvert par cette source (import HistoVec requis en FR)'}
                  </div>
                </div>
                <span
                  className={`status-badge ${
                    administrative.stolen ? 'danger' : stolenVerified ? 'ok' : 'neutral'
                  }`}
                >
                  {administrative.stolen
                    ? 'Signalé volé'
                    : stolenVerified
                      ? 'Non signalé'
                      : 'Non vérifié par cette source'}
                </span>
              </div>

              <div className="check-tile">
                <div>
                  <strong>Gage ou opposition</strong>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                    {pledgeVerified
                      ? 'Certificat de non-gage / transfert carte grise'
                      : 'Non publié en Open Data (vérifier via HistoVec)'}
                  </div>
                </div>
                <span
                  className={`status-badge ${
                    administrative.pledge || administrative.opposition
                      ? 'danger'
                      : pledgeVerified
                        ? 'ok'
                        : 'neutral'
                  }`}
                >
                  {administrative.pledge || administrative.opposition
                    ? 'Blocage présent'
                    : pledgeVerified
                      ? 'Aucun blocage'
                      : 'Non vérifié par cette source'}
                </span>
              </div>

              <div className="check-tile">
                <div>
                  <strong>Procédure véhicule endommagé (VGE / VEI / WOK)</strong>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                    {administrative.wokStatus ||
                      (damageProcVerified
                        ? 'Expertise lourde / interdiction de circuler'
                        : 'Non vérifié sur cette requête (HistoVec requis)')}
                  </div>
                </div>
                <span
                  className={`status-badge ${
                    administrative.vgeProcedure || administrative.veiProcedure || administrative.hasActiveWok
                      ? 'danger'
                      : damageProcVerified
                        ? 'ok'
                        : 'neutral'
                  }`}
                >
                  {administrative.vgeProcedure || administrative.veiProcedure || administrative.hasActiveWok
                    ? 'Procédure active'
                    : damageProcVerified
                      ? 'Aucune'
                      : 'Non vérifié par cette source'}
                </span>
              </div>

              <div className="check-tile">
                <div>
                  <strong>Usage Taxi / VTC / Flotte commerciale</strong>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                    {usageHistory.note || 'Usage particulier standard'}
                  </div>
                </div>
                <span
                  className={`status-badge ${
                    usageHistory.taxiOrVtc ? 'warn' : usageHistory.rentalOrFleet ? 'info' : 'ok'
                  }`}
                >
                  {usageHistory.taxiOrVtc
                    ? 'Ex-Taxi / VTC'
                    : usageHistory.rentalOrFleet
                      ? 'Ex-Flotte / Leasing'
                      : 'Usage particulier'}
                </span>
              </div>

              <div className="check-tile">
                <div>
                  <strong>Statut d’assurance &amp; Export</strong>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                    {administrative.apkExpiryDate
                      ? `Validité contrôle APK jusqu’au ${administrative.apkExpiryDate}`
                      : 'Vérification de radiation / exportation'}
                  </div>
                </div>
                <span
                  className={`status-badge ${
                    administrative.exported
                      ? 'warn'
                      : administrative.insuredWam === false
                        ? 'danger'
                        : administrative.insuredWam === true
                          ? 'ok'
                          : insuranceVerified
                            ? 'ok'
                            : 'neutral'
                  }`}
                >
                  {administrative.exported
                    ? 'Radié pour export'
                    : administrative.insuredWam === true
                      ? 'Assuré (WAM actif)'
                      : administrative.insuredWam === false
                        ? 'Non assuré (WAM)'
                        : insuranceVerified
                          ? 'En circulation'
                          : 'Non vérifié par cette source'}
                </span>
              </div>

              <div className="check-tile">
                <div>
                  <strong>Importation transfrontalière</strong>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                    {administrative.importNote || 'Origine nationale vérifiée'}
                  </div>
                </div>
                <span className={`status-badge ${administrative.importedIntoCountry ? 'warn' : 'ok'}`}>
                  {administrative.importedIntoCountry ? 'Importé UE' : 'Origine nationale'}
                </span>
              </div>
            </div>
          </section>

          {/* 5. Contrôles Techniques & Défauts */}
          <section id="sec-ct" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <ClipboardCheck size={20} color="var(--accent)" aria-hidden="true" />
                  Contrôles techniques (CT / APK / MOT / TÜV)
                </h2>
                <p className="section-desc">
                  Historique des passages réglementaires et liste des défauts constatés par les inspecteurs.
                </p>
              </div>
              <span className="status-badge neutral">{inspections.length} passage(s)</span>
            </div>

            {inspections.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                Aucun contrôle technique public n’est accessible directement pour cette recherche. En France, importez le
                rapport officiel HistoVec (UTAC-OTC) pour afficher chaque passage et kilométrage.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {inspections.map((insp, idx) => (
                  <div
                    key={`${insp.date}-${idx}`}
                    style={{
                      padding: 16,
                      borderRadius: 10,
                      background: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginBottom: insp.defects?.length ? 10 : 0,
                      }}
                    >
                      <div>
                        <strong className="mono">{insp.date}</strong> · <strong>{insp.type}</strong> (
                        {COUNTRY_NAMES[insp.country] || insp.country})
                        {insp.mileageKm !== null && insp.mileageKm !== undefined && (
                          <span className="mono" style={{ marginLeft: 10, color: 'var(--accent)' }}>
                            {Number(insp.mileageKm).toLocaleString('fr-FR')} km
                          </span>
                        )}
                      </div>
                      <span className={`status-badge ${insp.passed ? 'ok' : 'danger'}`}>{insp.result}</span>
                    </div>

                    {insp.defects?.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                        {insp.defects.map((def, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>
                            {def.code && <code className="mono">[{def.code}] </code>}
                            {def.description}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6. Rappels Constructeur */}
          <section id="sec-rappels" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <Wrench size={20} color="var(--accent)" aria-hidden="true" />
                  Rappels constructeur &amp; alertes sécurité
                </h2>
                <p className="section-desc">
                  Interrogation temps réel de RappelConso (DGCCRF France), du registre néerlandais et de NHTSA.
                </p>
              </div>
              <span className={`status-badge ${openRecallsCount > 0 ? 'warn' : 'ok'}`}>
                {openRecallsCount > 0
                  ? `${openRecallsCount} rappel(s) ouvert(s)`
                  : `${recalls.length} campagne(s) listée(s)`}
              </span>
            </div>

            {recalls.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ok)' }}>
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>Aucune campagne de rappel correspondante trouvée dans les bases ouvertes consultées.</span>
              </div>
            ) : (
              <div className="alert-list">
                {recalls.map((rec, idx) => (
                  <div
                    key={`${rec.campaignId}-${idx}`}
                    className={`alert-item ${rec.status === 'open' ? 'warning' : ''}`}
                    style={{ flexDirection: 'column', gap: 6 }}
                  >
                    <div
                      style={{
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="vin-chip">{rec.campaignId}</span>
                        <strong>{rec.component}</strong>
                        {rec.date && (
                          <span className="mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                            {rec.date}
                          </span>
                        )}
                      </div>
                      <span
                        className={`status-badge ${
                          rec.status === 'open'
                            ? 'danger'
                            : rec.status === 'resolved'
                              ? 'ok'
                              : 'info'
                        }`}
                      >
                        {rec.statusLabel}
                      </span>
                    </div>

                    <p className="alert-item-body">{rec.description}</p>
                    {rec.risk && (
                      <p className="alert-item-body" style={{ color: 'var(--danger)' }}>
                        <strong>Risque :</strong> {rec.risk}
                      </p>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginTop: 4,
                        fontSize: 12,
                        color: 'var(--ink-muted)',
                      }}
                    >
                      <span>Source : {rec.source}</span>
                      {rec.officialUrl && (
                        <a
                          href={rec.officialUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                        >
                          Fiche officielle <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 7. Parcours Européen & Chronologie */}
          <section id="sec-parcours" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <Globe2 size={20} color="var(--accent)" aria-hidden="true" />
                  Parcours européen &amp; propriétaires
                </h2>
                <p className="section-desc">
                  Chronologie consolidée des immatriculations, cessions, contrôles et passages de frontières.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ownersCount !== null && ownersCount !== undefined && (
                  <span className="status-badge info">{ownersCount} propriétaire(s)</span>
                )}
                <span className="status-badge neutral">
                  {countriesVisited.map((c) => COUNTRY_NAMES[c] || c).join(' → ') || 'Europe'}
                </span>
              </div>
            </div>

            {timeline.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                Chronologie détaillée indisponible sans import HistoVec ou registre historique complémentaire.
              </p>
            ) : (
              <div className="timeline-list">
                {timeline.map((ev, i) => (
                  <div key={`${ev.date}-${i}`} className="timeline-entry">
                    <span className={`timeline-dot ${ev.kind || ''}`} />
                    <div className="timeline-meta">
                      <strong className="mono">{ev.date}</strong>
                      <span className="status-badge neutral">{COUNTRY_NAMES[ev.country] || ev.country}</span>
                      {ev.km !== null && ev.km !== undefined && (
                        <span className="mono" style={{ color: 'var(--ink-primary)', fontWeight: 600 }}>
                          {Number(ev.km).toLocaleString('fr-FR')} km
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{ev.title}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 8. Fiche Technique & Décodage VIN ISO 3779 */}
          <section id="sec-specs" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <Sparkles size={20} color="var(--accent)" aria-hidden="true" />
                  Fiche technique, Crit’Air &amp; anatomie du VIN
                </h2>
                <p className="section-desc">
                  Comparez chaque caractéristique usine avec le véhicule physique et sa carte grise.
                </p>
              </div>
            </div>

            {vehicle.vinAnatomy && (
              <div style={{ marginBottom: 20 }}>
                <div className="vin-anatomy-grid">
                  <div className="vin-segment">
                    <span className="spec-key">WMI (Positions 1–3 · Constructeur)</span>
                    <div className="vin-segment-code">{vehicle.vinAnatomy.wmi}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', marginTop: 4 }}>
                      {vehicle.make} · {vehicle.assemblyPlant || 'Europe'}
                    </div>
                  </div>
                  <div className="vin-segment">
                    <span className="spec-key">VDS (Positions 4–9 · Descripteur &amp; Clé)</span>
                    <div className="vin-segment-code">{vehicle.vinAnatomy.vds}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', marginTop: 4 }}>
                      {vehicle.vinCheckDigit?.note}
                    </div>
                  </div>
                  <div className="vin-segment">
                    <span className="spec-key">VIS (Positions 10–17 · Année &amp; Série)</span>
                    <div className="vin-segment-code">{vehicle.vinAnatomy.vis}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', marginTop: 4 }}>
                      Code année « {vehicle.vinAnatomy.yearChar} » · N° série {vehicle.vinAnatomy.serialNumber}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="specs-grid">
              {specsList.map(([label, val]) => (
                <div key={label} className="spec-row">
                  <span className="spec-key">{label}</span>
                  <span className="spec-val">{val}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 9. Cote Marché & Aide à la Négociation */}
          <section id="sec-cote" className="report-section">
            <div className="report-section-head">
              <div>
                <h2>
                  <TrendingDown size={20} color="var(--accent)" aria-hidden="true" />
                  Estimation de cote &amp; arguments de négociation
                </h2>
                <p className="section-desc">
                  Valeur indicative ajustée selon les anomalies d’historique détectées dans le rapport.
                </p>
              </div>
            </div>

            {valuation.available ? (
              <div className="valuation-cards">
                <div className="valuation-box">
                  <span className="spec-key">Cote marché standard (historique sain)</span>
                  <div className="valuation-price mono">
                    {valuation.cleanRangeEur.mid.toLocaleString('fr-FR')} €
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
                    Fourchette : {valuation.cleanRangeEur.low.toLocaleString('fr-FR')} € –{' '}
                    {valuation.cleanRangeEur.high.toLocaleString('fr-FR')} €
                  </span>
                </div>
                <div className="valuation-box">
                  <span className="spec-key">
                    Valeur ajustée VériCar{' '}
                    {valuation.penaltyPercent > 0 ? `(-${valuation.penaltyPercent} %)` : '(sans décote)'}
                  </span>
                  <div
                    className="valuation-price mono"
                    style={{
                      color: valuation.penaltyPercent >= 20 ? 'var(--danger)' : 'var(--accent)',
                    }}
                  >
                    {valuation.adjustedRangeEur.mid.toLocaleString('fr-FR')} €
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
                    Offre raisonnable : {valuation.adjustedRangeEur.low.toLocaleString('fr-FR')} € –{' '}
                    {valuation.adjustedRangeEur.high.toLocaleString('fr-FR')} €
                  </span>
                </div>
              </div>
            ) : (
              <p style={{ marginTop: 0, fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                {valuation.note}
              </p>
            )}

            {valuation.negotiationPoints?.length > 0 && (
              <div className="alert-list">
                {valuation.negotiationPoints.map((pt, i) => (
                  <div
                    key={i}
                    className={`alert-item ${
                      pt.severity === 'critical'
                        ? 'critical'
                        : pt.severity === 'warning'
                          ? 'warning'
                          : 'info'
                    }`}
                  >
                    <div style={{ width: '100%' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <strong>{pt.title}</strong>
                        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700 }}>
                          {pt.impact}
                        </span>
                      </div>
                      <p className="alert-item-body">{pt.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
