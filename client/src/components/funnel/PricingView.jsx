import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Coins,
  CreditCard,
  FileText,
  FlaskConical,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '../../api.js';
import { Link, sanitizeReturnTo, useRouter } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

function formatEuros(cents) {
  const value = Number(cents || 0) / 100;
  return `${value.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function getPackBenefits(credits) {
  const base = [
    'Rapport complet en 9 sections (VIN, compteur, CT, sinistres, rappels)',
    'Réouverture gratuite à vie d’un véhicule déjà débloqué',
    'Lien de partage vérifié & export PDF imprimable inclus',
    'Facture TVA (20 %) disponible immédiatement dans votre compte',
  ];
  if (credits >= 10) {
    return [
      'Idéal négociants, mandataires, garages et acheteurs exigeants',
      ...base,
    ];
  }
  if (credits >= 2) {
    return [
      'Comparez plusieurs annonces côte à côte avant de négocier',
      ...base,
    ];
  }
  return base;
}

export default function PricingView() {
  const { searchParams, navigate } = useRouter();
  const {
    isAuthenticated,
    creditsBalance,
    refreshMe,
    setCreditsBalance,
    openAuthModal,
  } = useAuth();
  const { showToast } = useToast();

  const checkoutParam = searchParams.get('checkout');
  const rawReturnTo = searchParams.get('returnTo');
  const safeReturnTo = rawReturnTo ? sanitizeReturnTo(rawReturnTo, '') : '';

  const [packsData, setPacksData] = useState(null);
  const [loadingPacks, setLoadingPacks] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  const [acceptedWaiver, setAcceptedWaiver] = useState(false);
  const [waiverError, setWaiverError] = useState('');
  const [checkingOutPackId, setCheckingOutPackId] = useState(null);
  const [checkoutError, setCheckoutError] = useState('');

  const [pendingSandboxOrder, setPendingSandboxOrder] = useState(null);
  const [completingSandbox, setCompletingSandbox] = useState(false);
  const [completedOrder, setCompletedOrder] = useState(null);

  const waiverCheckboxRef = useRef(null);
  const waiverBoxRef = useRef(null);
  const sandboxPanelRef = useRef(null);
  const handledSuccessRef = useRef(false);

  // Load canonical billing packs from GET /api/billing/packs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getBillingPacks();
        if (!cancelled) {
          setPacksData(data);
          setLoadError('');
          setLoadingPacks(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Impossible de charger les packs de crédits.');
          setLoadingPacks(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // Handle ?checkout=success return from Stripe Checkout
  useEffect(() => {
    if (checkoutParam !== 'success' || handledSuccessRef.current) return undefined;
    handledSuccessRef.current = true;
    let cancelled = false;
    (async () => {
      await refreshMe().catch(() => {});
      if (!cancelled) {
        showToast({
          type: 'success',
          title: 'Paiement confirmé',
          message: 'Votre solde de crédits a été actualisé.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkoutParam, refreshMe, showToast]);

  const handleRetryPacks = () => {
    setLoadingPacks(true);
    setLoadError('');
    setReloadTick((n) => n + 1);
  };

  const executeCheckout = async (packId) => {
    setCheckingOutPackId(packId);
    setCheckoutError('');
    try {
      const res = await api.createCheckout({ packId, acceptedWaiver: true });
      if (res?.mode === 'stripe' && res?.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
        return;
      }
      if (res?.mode === 'sandbox') {
        setPendingSandboxOrder(res);
        setCompletedOrder(null);
        window.requestAnimationFrame(() => {
          sandboxPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return;
      }
      setCheckoutError('Réponse inattendue du service de paiement.');
    } catch (err) {
      if (err?.status === 401) {
        openAuthModal({
          mode: 'login',
          reason: 'Votre session a expiré. Reconnectez-vous pour finaliser votre commande.',
          onSuccess: () => executeCheckout(packId),
        });
        return;
      }
      if (err?.status === 503 || err?.code === 'BILLING_UNAVAILABLE') {
        setCheckoutError('Le module de paiement est temporairement indisponible.');
      } else {
        setCheckoutError(err?.message || 'Impossible d’initialiser la commande.');
      }
    } finally {
      setCheckingOutPackId(null);
    }
  };

  const handleSelectPack = (pack) => {
    const amountCents = pack.amountCents ?? pack.priceCents ?? 0;
    const credits = pack.credits ?? 1;
    const title =
      pack.name || pack.label || (credits === 1 ? 'Pack Découverte' : `Pack ${credits} crédits`);

    if (!acceptedWaiver) {
      setWaiverError(
        'Veuillez cocher la case d’acceptation des CGV et du renoncement au droit de rétractation (Art. L221-28) avant de commander.'
      );
      waiverBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      waiverCheckboxRef.current?.focus();
      return;
    }

    setWaiverError('');
    setCheckoutError('');

    if (!isAuthenticated) {
      openAuthModal({
        mode: 'register',
        reason: `Connectez-vous ou créez un compte pour commander le ${title} (${formatEuros(amountCents)}).`,
        onSuccess: () => executeCheckout(pack.id),
      });
      return;
    }

    executeCheckout(pack.id);
  };

  const handleCompleteSandbox = async () => {
    if (!pendingSandboxOrder?.orderId) return;
    setCompletingSandbox(true);
    setCheckoutError('');
    try {
      const res = await api.completeSandboxOrder({ orderId: pendingSandboxOrder.orderId });
      const nextBalance =
        typeof res?.creditsBalance === 'number' ? res.creditsBalance : creditsBalance;
      if (typeof setCreditsBalance === 'function' && typeof res?.creditsBalance === 'number') {
        setCreditsBalance(res.creditsBalance);
      } else {
        await refreshMe().catch(() => {});
      }
      setCompletedOrder({
        order: res?.order || {
          id: pendingSandboxOrder.orderId,
          invoiceNumber: pendingSandboxOrder.invoiceNumber,
        },
        creditsBalance: nextBalance,
      });
      setPendingSandboxOrder(null);
      showToast({
        type: 'success',
        title: 'Crédits ajoutés (mode test)',
        message: `Votre solde est maintenant de ${nextBalance} crédit${nextBalance > 1 ? 's' : ''}.`,
      });
    } catch (err) {
      if (err?.status === 403 || err?.code === 'SANDBOX_DISABLED') {
        setCheckoutError('Le mode test est désactivé sur cet environnement.');
        setPendingSandboxOrder(null);
      } else {
        setCheckoutError(err?.message || 'Impossible de valider la commande de test.');
      }
    } finally {
      setCompletingSandbox(false);
    }
  };

  const packs = Array.isArray(packsData?.packs) ? packsData.packs : [];
  const isSandboxMode = packsData?.billingMode === 'sandbox';
  const signupBonusCredits = Number(packsData?.signupBonusCredits ?? 0);
  const showSuccessBanner = Boolean(completedOrder || checkoutParam === 'success');
  const showCancelBanner = checkoutParam === 'cancel' && !completedOrder;

  return (
    <main className="container saas-page">
      <section className="pricing-hero">
        <p className="pricing-hero-eyebrow">TARIFS TRANSPARENTS · SANS ABONNEMENT</p>
        <h1>Des packs de crédits simples pour vérifier avant d’acheter</h1>
        <p>
          1 crédit débloque un rapport complet multi-registres. Vos crédits n’expirent pas, la
          réouverture d’un véhicule déjà débloqué est gratuite, et l’import HistoVec reste à 0
          crédit.
        </p>

        <div className="pricing-hero-meta">
          {isAuthenticated ? (
            <span className="status-badge info">
              <Coins size={14} aria-hidden="true" />
              Votre solde actuel : {creditsBalance} crédit{creditsBalance > 1 ? 's' : ''}
            </span>
          ) : (
            signupBonusCredits > 0 && (
              <span className="status-badge ok">
                <Sparkles size={14} aria-hidden="true" />
                {signupBonusCredits} crédit{signupBonusCredits > 1 ? 's' : ''} offert
                {signupBonusCredits > 1 ? 's' : ''} à la création de votre compte
              </span>
            )
          )}
          <span className="status-badge neutral">
            <ShieldCheck size={14} aria-hidden="true" />
            Facture TVA 20 % incluse
          </span>
        </div>
      </section>

      {/* Unmistakable Honest Sandbox Banner */}
      {isSandboxMode && (
        <section
          id="pricing-sandbox-banner"
          className="sandbox-banner"
          role="note"
          aria-label="Avertissement Mode Test / Sandbox"
        >
          <FlaskConical size={24} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <div className="sandbox-banner-content">
            <span className="sandbox-pill">MODE TEST / SANDBOX</span>
            <strong>Mode Test / Sandbox — Aucun paiement réel n’est débité</strong>
            <p>
              Le paiement par carte bancaire en production n’est pas actif sur cette instance. Vous
              pouvez tester l’intégralité du parcours de commande, l’ajout de crédits et la
              génération de reçus de démonstration en un clic sans aucun débit bancaire.
            </p>
          </div>
        </section>
      )}

      {/* Post-checkout success banner (Sandbox or ?checkout=success from Stripe) */}
      {showSuccessBanner && (
        <section id="pricing-checkout-success" className="checkout-banner success" role="status">
          <h2>
            <CheckCircle2 size={20} color="var(--ok)" aria-hidden="true" />
            Commande confirmée — Crédits disponibles
          </h2>
          <p>
            {completedOrder?.order?.invoiceNumber ? (
              <>
                Référence <strong className="mono">{completedOrder.order.invoiceNumber}</strong>{' '}
                validée.{' '}
              </>
            ) : null}
            Votre solde actualisé est de{' '}
            <strong>
              {completedOrder?.creditsBalance ?? creditsBalance} crédit
              {(completedOrder?.creditsBalance ?? creditsBalance) > 1 ? 's' : ''}
            </strong>
            .
          </p>
          <div className="checkout-banner-actions">
            <Link to={safeReturnTo || '/'} className="btn btn-primary btn-sm">
              {safeReturnTo ? 'Poursuivre ma vérification' : 'Vérifier un véhicule'}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            {completedOrder?.order?.id && (
              <Link
                to={`/compte/factures/${encodeURIComponent(completedOrder.order.id)}`}
                className="btn btn-secondary btn-sm"
              >
                <FileText size={15} aria-hidden="true" />
                Voir la facture
              </Link>
            )}
            <Link to="/compte?tab=orders" className="btn btn-ghost btn-sm">
              Mon compte &amp; commandes
            </Link>
          </div>
        </section>
      )}

      {/* Cancelled Stripe checkout notice */}
      {showCancelBanner && (
        <section id="pricing-checkout-cancel" className="checkout-banner cancel" role="status">
          <h2>
            <AlertTriangle size={20} color="var(--warn)" aria-hidden="true" />
            Commande annulée
          </h2>
          <p>
            Votre paiement a été interrompu et aucun montant n’a été débité. Vous pouvez
            sélectionner un pack à tout moment ci-dessous.
          </p>
        </section>
      )}

      {/* 1-Click Sandbox Order Confirmation Panel */}
      {pendingSandboxOrder && (
        <section
          ref={sandboxPanelRef}
          id="sandbox-checkout-panel"
          className="sandbox-checkout-panel"
          aria-labelledby="sandbox-checkout-title"
        >
          <span className="sandbox-pill">VALIDATION SANDBOX · AUCUN DÉBIT RÉEL</span>
          <h2 id="sandbox-checkout-title">Finaliser la commande de test en 1 clic</h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-secondary)' }}>
            Confirmez cette commande simulée pour créditer immédiatement votre compte et générer le
            reçu de test.
          </p>

          <div className="sandbox-checkout-summary">
            <div>
              <div className="hero-stat-label">N° Reçu Sandbox</div>
              <div className="hero-stat-value mono">{pendingSandboxOrder.invoiceNumber || '—'}</div>
            </div>
            <div>
              <div className="hero-stat-label">Pack sélectionné</div>
              <div className="hero-stat-value">
                {pendingSandboxOrder.pack?.name ||
                  pendingSandboxOrder.pack?.label ||
                  `${pendingSandboxOrder.pack?.credits || ''} crédit(s)`}
              </div>
            </div>
            <div>
              <div className="hero-stat-label">Crédits à ajouter</div>
              <div className="hero-stat-value mono">
                +{pendingSandboxOrder.pack?.credits ?? 0} crédit
                {(pendingSandboxOrder.pack?.credits ?? 0) > 1 ? 's' : ''}
              </div>
            </div>
            <div>
              <div className="hero-stat-label">Montant simulé TTC</div>
              <div className="hero-stat-value mono">
                {formatEuros(pendingSandboxOrder.amountCents)}
              </div>
            </div>
          </div>

          <div className="sandbox-checkout-actions">
            <button
              id="btn-confirm-sandbox-order"
              type="button"
              className="btn btn-primary"
              disabled={completingSandbox}
              onClick={handleCompleteSandbox}
            >
              {completingSandbox ? (
                <Loader2 size={16} className="spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 size={16} aria-hidden="true" />
              )}
              Valider le paiement de test (0 € débité)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={completingSandbox}
              onClick={() => setPendingSandboxOrder(null)}
            >
              Annuler
            </button>
          </div>
        </section>
      )}

      {/* Checkout Error */}
      {checkoutError && (
        <div className="form-alert error" role="alert" style={{ marginBottom: 20 }}>
          <AlertCircle size={17} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{checkoutError}</span>
        </div>
      )}

      {/* Mandatory CGV Art. L221-28 Waiver Box */}
      <div
        ref={waiverBoxRef}
        className={`waiver-box ${waiverError ? 'has-error' : ''}`}
      >
        <label className="checkbox-row" htmlFor="pricing-waiver-checkbox">
          <input
            ref={waiverCheckboxRef}
            id="pricing-waiver-checkbox"
            type="checkbox"
            checked={acceptedWaiver}
            onChange={(e) => {
              setAcceptedWaiver(e.target.checked);
              if (e.target.checked) setWaiverError('');
            }}
          />
          <span>
            J’accepte les{' '}
            <Link to="/cgu" target="_blank" rel="noreferrer" aria-current={undefined}>
              Conditions Générales de Vente (CGV)
            </Link>{' '}
            et je demande expressément la mise à disposition immédiate de mes crédits numériques, en
            reconnaissant renoncer à mon droit de rétractation de 14 jours conformément à{' '}
            <strong>l’article L221-28 du Code de la consommation</strong>.
          </span>
        </label>
        {waiverError && (
          <div className="field-error" role="alert" style={{ marginTop: 8 }}>
            {waiverError}
          </div>
        )}
      </div>

      {/* Loading / Error / 4-Pack Pricing Grid */}
      {loadingPacks ? (
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Chargement des offres et tarifs…</p>
        </div>
      ) : loadError ? (
        <div className="surface-card saas-center-card" role="alert">
          <AlertCircle size={28} color="var(--danger)" aria-hidden="true" />
          <p>{loadError}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleRetryPacks}>
            <RefreshCw size={15} aria-hidden="true" />
            Réessayer
          </button>
        </div>
      ) : (
        <section className="pricing-grid" aria-label="Packs de crédits VériCar Europe">
          {packs.map((pack) => {
            const amountCents = pack.amountCents ?? pack.priceCents ?? 0;
            const credits = Number(pack.credits ?? 1);
            const unitCents =
              pack.unitPriceCents ?? Math.round(amountCents / Math.max(1, credits));
            const title =
              pack.name ||
              pack.label ||
              (credits === 1 ? 'Pack Découverte' : `Pack ${credits} crédits`);
            const savings = Number(pack.savingsPercent || 0);
            const isPopular = Boolean(pack.popular);
            const isBusy = checkingOutPackId === pack.id;
            const isSelected = pendingSandboxOrder?.pack?.id === pack.id;
            const benefits = getPackBenefits(credits);

            return (
              <article
                key={pack.id}
                className={`pack-card ${isPopular ? 'popular' : ''} ${isSelected ? 'selected' : ''}`}
              >
                {isPopular && <span className="pack-ribbon">Le plus choisi</span>}

                <div className="pack-header">
                  <h2 className="pack-name">{title}</h2>
                  <div className="pack-credits-row">
                    <span className="status-badge info">
                      <Coins size={13} aria-hidden="true" />
                      {credits} crédit{credits > 1 ? 's' : ''}
                    </span>
                    {savings > 0 && <span className="pack-savings-badge">-{savings} %</span>}
                  </div>
                </div>

                <div className="pack-price-row">
                  <span className="pack-price">{formatEuros(amountCents)}</span>
                  <span className="pack-price-tax">TTC</span>
                </div>
                <div className="pack-unit-price">{formatEuros(unitCents)} / rapport</div>

                <ul className="pack-features">
                  {benefits.map((feat) => (
                    <li key={feat}>
                      <Check
                        size={15}
                        color="var(--ok)"
                        aria-hidden="true"
                        style={{ flexShrink: 0, marginTop: 2 }}
                      />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <div className="pack-cta">
                  <button
                    id={`btn-buy-${pack.id}`}
                    type="button"
                    className={`btn btn-block ${isPopular ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={Boolean(checkingOutPackId)}
                    onClick={() => handleSelectPack(pack)}
                  >
                    {isBusy ? (
                      <Loader2 size={16} className="spin" aria-hidden="true" />
                    ) : (
                      <CreditCard size={15} aria-hidden="true" />
                    )}
                    {isSandboxMode
                      ? `Tester ce pack (${formatEuros(amountCents)})`
                      : `Commander (${formatEuros(amountCents)})`}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Reassurance Row */}
      <section className="pricing-reassurance" aria-label="Garanties VériCar Europe">
        <div className="reassurance-card">
          <ShieldCheck size={20} color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0 }} />
          <div>
            <h3>0 crédit débité en cas d’échec</h3>
            <p>
              Votre crédit n’est consommé qu’après réception effective des données du véhicule. Une
              plaque introuvable ne vous coûte rien.
            </p>
          </div>
        </div>

        <div className="reassurance-card">
          <FileText size={20} color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0 }} />
          <div>
            <h3>Facturation TVA automatisée</h3>
            <p>
              Retrouvez et imprimez instantanément toutes vos factures avec détail HT, TVA 20 % et
              TTC depuis votre espace client.
            </p>
          </div>
        </div>

        <div className="reassurance-card">
          <Sparkles size={20} color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0 }} />
          <div>
            <h3>HistoVec &amp; dossiers démo gratuits</h3>
            <p>
              La fusion de votre rapport officiel HistoVec (France) et nos dossiers européens de
              démonstration restent accessibles à 0 crédit.
            </p>
          </div>
        </div>
      </section>

      {safeReturnTo && (
        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(safeReturnTo)}
          >
            Retourner à ma vérification en cours
          </button>
        </div>
      )}
    </main>
  );
}
