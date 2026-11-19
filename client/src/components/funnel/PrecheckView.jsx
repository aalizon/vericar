import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Coins,
  Database,
  FileCheck2,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '../../api.js';
import { Link, useRouter } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const SCAN_STAGES = [
  'Normalisation de l’identifiant (VIN ISO 3779 / plaque UE)',
  'Vérification de la structure constructeur (WMI & millésime)',
  'Cartographie des registres officiels & bases rappels compatibles',
  'Préparation de l’aperçu gratuit (0 crédit consommé)',
];

const COUNTRIES = [
  { code: 'AUTO', label: 'Détection auto' },
  { code: 'FR', label: 'France (FR)' },
  { code: 'NL', label: 'Pays-Bas (NL)' },
  { code: 'DE', label: 'Allemagne (DE)' },
  { code: 'BE', label: 'Belgique (BE)' },
  { code: 'GB', label: 'Royaume-Uni (GB)' },
  { code: 'IT', label: 'Italie (IT)' },
  { code: 'ES', label: 'Espagne (ES)' },
  { code: 'NO', label: 'Norvège (NO)' },
];

export default function PrecheckView({ onReportReady }) {
  const { searchParams, navigate } = useRouter();
  const {
    isAuthenticated,
    creditsBalance,
    publicConfig,
    setCreditsBalance,
    refreshMe,
    openAuthModal,
    savePendingPrecheck,
    loadPendingPrecheck,
    clearPendingPrecheck,
  } = useAuth();
  const { showToast } = useToast();

  const urlQuery = (searchParams.get('q') || '').trim();
  const urlCountry = (searchParams.get('country') || 'AUTO').trim().toUpperCase();

  const [inputQuery, setInputQuery] = useState(urlQuery);
  const [inputCountry, setInputCountry] = useState(urlCountry || 'AUTO');
  const [activeStage, setActiveStage] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [precheck, setPrecheck] = useState(null);
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const autoRanRef = useRef('');

  const runPrecheck = useCallback(
    async (q, country) => {
      const trimmed = String(q || '').trim();
      if (trimmed.length < 4) {
        setError('Veuillez saisir un VIN (17 caractères) ou une plaque valide.');
        return;
      }
      setError('');
      setPrecheck(null);
      setScanning(true);
      setActiveStage(0);

      const reduceMotion =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const stageTimer = reduceMotion
        ? null
        : setInterval(() => {
            setActiveStage((prev) => (prev < SCAN_STAGES.length - 1 ? prev + 1 : prev));
          }, 160);

      try {
        const [data] = await Promise.all([
          api.precheckVehicle({ query: trimmed, country }),
          reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, 480)),
        ]);
        setActiveStage(SCAN_STAGES.length);
        setPrecheck(data);
        savePendingPrecheck({ query: trimmed, country });
      } catch (err) {
        setError(err?.message || 'Impossible de pré-vérifier cet identifiant.');
      } finally {
        if (stageTimer) clearInterval(stageTimer);
        setScanning(false);
      }
    },
    [savePendingPrecheck]
  );

  // Sync from URL or pending sessionStorage precheck
  useEffect(() => {
    const targetQ = urlQuery || loadPendingPrecheck()?.query || '';
    const targetC = urlQuery ? urlCountry : loadPendingPrecheck()?.country || 'AUTO';
    if (!targetQ) return;
    const key = `${targetQ}|${targetC}`;
    if (autoRanRef.current === key) return;
    autoRanRef.current = key;
    setInputQuery(targetQ);
    setInputCountry(targetC);
    runPrecheck(targetQ, targetC);
  }, [urlQuery, urlCountry, loadPendingPrecheck, runPrecheck]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const trimmed = inputQuery.trim();
    if (trimmed.length < 4) {
      setError('Veuillez saisir un VIN (17 caractères) ou une plaque d’immatriculation.');
      return;
    }
    autoRanRef.current = `${trimmed}|${inputCountry}`;
    navigate(`/verifier?q=${encodeURIComponent(trimmed)}&country=${encodeURIComponent(inputCountry)}`, {
      replace: true,
    });
    runPrecheck(trimmed, inputCountry);
  };

  const executeUnlock = async () => {
    const queryToUse = inputQuery.trim() || precheck?.normalized;
    if (!queryToUse) return;
    setUnlocking(true);
    setError('');
    try {
      const res = await api.lookupVehicle({
        query: queryToUse,
        country: inputCountry,
      });

      if (typeof res?.creditsBalance === 'number') {
        setCreditsBalance(res.creditsBalance);
      } else if (isAuthenticated) {
        refreshMe().catch(() => {});
      }

      clearPendingPrecheck();

      if (res.creditCost > 0) {
        showToast({
          type: 'success',
          title: 'Rapport complet débloqué',
          message: `1 crédit utilisé. Nouveau solde : ${res.creditsBalance ?? 0} crédit(s).`,
        });
      } else if (res.alreadyUnlocked) {
        showToast({
          type: 'info',
          message: 'Rapport déjà débloqué — réouverture gratuite (0 crédit).',
        });
      }

      onReportReady?.(res.report);
      if (res.ephemeral) {
        navigate(`/rapport/${encodeURIComponent(res.report.id)}`);
      } else {
        navigate(`/rapport/${encodeURIComponent(res.report.id)}`);
      }
    } catch (err) {
      if (err?.status === 401) {
        openAuthModal({
          mode: 'register',
          reason: 'Créez un compte gratuit (1 crédit offert) ou connectez-vous pour débloquer ce rapport live.',
          onSuccess: () => executeUnlock(),
        });
        return;
      }
      if (err?.status === 402 || err?.code === 'INSUFFICIENT_CREDITS') {
        showToast({
          type: 'warning',
          title: 'Crédits insuffisants',
          message: 'Choisissez un pack pour débloquer votre rapport complet.',
        });
        const ret = `/verifier?q=${encodeURIComponent(queryToUse)}&country=${encodeURIComponent(inputCountry)}`;
        navigate(`/tarifs?returnTo=${encodeURIComponent(ret)}`);
        return;
      }
      setError(err?.message || 'Erreur lors du déblocage du rapport.');
    } finally {
      setUnlocking(false);
    }
  };

  const bonusCredits = Number(publicConfig?.signupBonusCredits ?? 1);
  const returnToSelf = `/verifier?q=${encodeURIComponent(inputQuery.trim())}&country=${encodeURIComponent(inputCountry)}`;

  return (
    <main className="container saas-page precheck-shell">
      <section className="surface-card" style={{ padding: 20, marginBottom: 20 }}>
        <form onSubmit={handleSearchSubmit} className="saas-inline-search" style={{ flexWrap: 'wrap' }}>
          <input
            id="precheck-query-input"
            type="text"
            className="text-input mono"
            style={{ flex: '1 1 260px' }}
            placeholder="VIN (17 caractères) ou plaque européenne (ex. 21STVK, HSF60S)…"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            aria-label="VIN ou plaque d’immatriculation"
          />
          <select
            id="precheck-country-select"
            className="text-input"
            style={{ width: 'auto', minWidth: 160 }}
            value={inputCountry}
            onChange={(e) => setInputCountry(e.target.value)}
            aria-label="Pays du registre"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={scanning || unlocking}>
            <Search size={16} aria-hidden="true" />
            Pré-vérifier (Gratuit)
          </button>
        </form>
      </section>

      {error && (
        <div className="form-alert error" role="alert" style={{ marginBottom: 20 }}>
          <AlertCircle size={17} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Animated 4-Stage Scan Progress */}
      {scanning && (
        <section className="surface-card precheck-progress-card" role="status" aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Loader2 size={20} className="spin" color="var(--accent)" aria-hidden="true" />
            <h1 style={{ margin: 0, fontSize: 20, fontFamily: 'var(--font-display)' }}>
              Pré-vérification en cours…
            </h1>
          </div>
          <div className="precheck-steps">
            {SCAN_STAGES.map((label, idx) => {
              const state = idx < activeStage ? 'done' : idx === activeStage ? 'active' : 'pending';
              return (
                <div key={label} className={`precheck-step ${state}`}>
                  {state === 'done' ? (
                    <CheckCircle2 size={16} color="var(--ok)" aria-hidden="true" />
                  ) : state === 'active' ? (
                    <Loader2 size={16} className="spin" color="var(--accent)" aria-hidden="true" />
                  ) : (
                    <span style={{ width: 16, display: 'inline-block', textAlign: 'center' }}>·</span>
                  )}
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Pre-Check Preview Card */}
      {!scanning && precheck && (
        <section className="surface-card precheck-card" id="precheck-result-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <span className="eyebrow">
                {precheck.isDemo ? 'Dossier de démonstration · 0 crédit' : 'Pré-vérification gratuite terminée'}
              </span>
              <h1 style={{ margin: '6px 0 4px', fontFamily: 'var(--font-display)', fontSize: 26 }}>
                {precheck.vinPreview?.make
                  ? `${precheck.vinPreview.make}${precheck.vinPreview.model ? ` ${precheck.vinPreview.model}` : ''}${precheck.vinPreview.modelYear ? ` (${precheck.vinPreview.modelYear})` : ''}`
                  : `Identifiant ${precheck.normalized}`}
              </h1>
              <div className="mono" style={{ fontSize: 13.5, color: 'var(--ink-muted)' }}>
                {precheck.queryType === 'vin' ? 'VIN' : `Plaque ${precheck.detectedCountry}`} :{' '}
                <strong>{precheck.normalized}</strong>
                {precheck.vinPreview?.assemblyCountry
                  ? ` · Assemblage ${precheck.vinPreview.assemblyCountry}`
                  : ''}
              </div>
            </div>

            <span className={`status-badge ${precheck.creditCost === 0 ? 'ok' : 'info'}`}>
              {precheck.alreadyUnlockedReportId
                ? 'Déjà débloqué · 0 crédit'
                : precheck.creditCost === 0
                  ? 'Accès gratuit · 0 crédit'
                  : '1 crédit requis pour le rapport complet'}
            </span>
          </div>

          {precheck.demoInfo && (
            <div className="saas-banner saas-banner-info" style={{ marginTop: 16 }}>
              <div>
                <strong>{precheck.demoInfo.badge}</strong> — {precheck.demoInfo.subtitle}
              </div>
            </div>
          )}

          {/* Signal Teasers */}
          <div className="precheck-teasers-grid">
            {(precheck.signalTeasers || []).map((t) => (
              <div key={`${t.category}-${t.label}`} className="precheck-teaser-item">
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                  {t.category}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: 'var(--ink-primary)' }}>
                  {t.label}
                </div>
              </div>
            ))}
          </div>

          {/* Available Sources */}
          <div style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 14.5, fontFamily: 'var(--font-display)', margin: '0 0 10px' }}>
              <Database size={15} aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }} />
              Sources prêtes pour ce rapport ({precheck.estimatedSectionsCount} sections)
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(precheck.availableSources || []).map((s) => (
                <span
                  key={s.name}
                  className={`status-badge ${s.live ? 'ok' : s.status === 'demo' ? 'info' : 'warn'}`}
                >
                  {s.name} ({s.country})
                </span>
              ))}
            </div>
          </div>

          {/* Smart Unlock CTA Bar */}
          <div className="precheck-cta-bar">
            <div>
              <strong style={{ display: 'block', fontSize: 15 }}>
                {precheck.alreadyUnlockedReportId
                  ? 'Vous avez déjà débloqué ce véhicule'
                  : precheck.creditCost === 0
                    ? 'Consultation gratuite sans débit de crédit'
                    : isAuthenticated
                      ? creditsBalance >= 1
                        ? `Solde disponible : ${creditsBalance} crédit${creditsBalance > 1 ? 's' : ''}`
                        : 'Votre solde est à 0 crédit'
                      : `Créez un compte gratuit${bonusCredits > 0 ? ` (${bonusCredits} crédit offert)` : ''} pour débloquer`}
              </strong>
              <span style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
                Garantie VériCar : 0 crédit débité si le registre ne trouve pas le véhicule ou ne répond pas.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {precheck.alreadyUnlockedReportId ? (
                <Link
                  id="btn-open-already-unlocked"
                  to={`/rapport/${encodeURIComponent(precheck.alreadyUnlockedReportId)}`}
                  className="btn btn-primary"
                >
                  <FileCheck2 size={16} aria-hidden="true" />
                  Ouvrir mon rapport (0 crédit)
                </Link>
              ) : precheck.creditCost === 0 ? (
                <button
                  id="btn-unlock-free-report"
                  type="button"
                  className="btn btn-primary"
                  disabled={unlocking}
                  onClick={executeUnlock}
                >
                  {unlocking ? (
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                  ) : (
                    <Sparkles size={16} aria-hidden="true" />
                  )}
                  Ouvrir le rapport gratuit (0 crédit)
                </button>
              ) : !isAuthenticated ? (
                <>
                  <button
                    id="btn-guest-register-unlock"
                    type="button"
                    className="btn btn-primary"
                    disabled={unlocking}
                    onClick={() =>
                      openAuthModal({
                        mode: 'register',
                        reason: `Créez votre compte gratuit (${bonusCredits} crédit offert) pour débloquer le rapport complet de ${precheck.normalized}.`,
                        onSuccess: () => executeUnlock(),
                      })
                    }
                  >
                    <ShieldCheck size={16} aria-hidden="true" />
                    Créer un compte &amp; Débloquer
                  </button>
                  <button
                    id="btn-guest-login-unlock"
                    type="button"
                    className="btn btn-secondary"
                    disabled={unlocking}
                    onClick={() =>
                      openAuthModal({
                        mode: 'login',
                        reason: `Connectez-vous pour débloquer le rapport complet de ${precheck.normalized}.`,
                        onSuccess: () => executeUnlock(),
                      })
                    }
                  >
                    <Lock size={15} aria-hidden="true" />
                    Connexion
                  </button>
                </>
              ) : creditsBalance >= 1 ? (
                <button
                  id="btn-unlock-paid-report"
                  type="button"
                  className="btn btn-primary"
                  disabled={unlocking}
                  onClick={executeUnlock}
                >
                  {unlocking ? (
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                  ) : (
                    <Coins size={16} aria-hidden="true" />
                  )}
                  Débloquer le rapport complet (1 crédit)
                </button>
              ) : (
                <Link
                  id="btn-buy-credits-from-precheck"
                  to={`/tarifs?returnTo=${encodeURIComponent(returnToSelf)}`}
                  className="btn btn-primary"
                >
                  <Coins size={16} aria-hidden="true" />
                  Acheter un pack de crédits
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
