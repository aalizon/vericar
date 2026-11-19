import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Coins,
  FileCheck2,
  Globe2,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Link, useRouter } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const COUNTRIES = [
  { code: 'AUTO', label: 'Auto (UE)' },
  { code: 'FR', label: 'France (FR)' },
  { code: 'NL', label: 'Pays-Bas (NL)' },
  { code: 'DE', label: 'Allemagne (DE)' },
  { code: 'BE', label: 'Belgique (BE)' },
  { code: 'GB', label: 'Royaume-Uni (UK)' },
  { code: 'IT', label: 'Italie (IT)' },
  { code: 'ES', label: 'Espagne (ES)' },
  { code: 'PL', label: 'Pologne (PL)' },
  { code: 'NO', label: 'Norvège (NO)' },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Pré-vérification gratuite',
    description:
      'Saisissez un numéro VIN (17 caractères) ou une plaque européenne. VériCar valide l’identifiant, décode la structure constructeur et détecte les registres disponibles — 0 crédit consommé.',
  },
  {
    step: '02',
    title: 'Déblocage instantané (1 crédit)',
    description:
      'Débloquez le rapport complet en 9 sections : courbe kilométrique, sinistres carrosserie, contrôles techniques, rappels de sécurité en direct et estimation de cote.',
  },
  {
    step: '03',
    title: 'Négociez & partagez en confiance',
    description:
      'Exportez votre rapport en PDF A4 ou activez un lien vérifié en lecture seule pour rassurer un acheteur — sans jamais exposer vos coordonnées personnelles.',
  },
];

const PRICING_TEASER = [
  {
    id: 'pack_1',
    name: 'Pack Découverte · 1 crédit',
    price: '14,90 €',
    unit: '14,90 € / rapport · Sans abonnement',
    desc: 'Pour vérifier un véhicule précis avant votre visite avec réouverture gratuite à vie.',
    popular: false,
  },
  {
    id: 'pack_2',
    name: 'Pack Acheteur · 2 crédits',
    price: '24,90 €',
    unit: '12,45 € / rapport · -16 %',
    desc: 'Le plus populaire pour comparer 2 annonces côte à côte avant de négocier.',
    popular: true,
  },
  {
    id: 'pack_pro_10',
    name: 'Pack Pro / Marchand · 10 crédits',
    price: '79,90 €',
    unit: '7,99 € / rapport · -46 %',
    desc: 'Tarif dégressif avec factures TVA 20 % pour négociants, garages et mandataires.',
    popular: false,
  },
];

const FAQ_ITEMS = [
  {
    q: 'Quelle est la différence entre HistoVec et VériCar Europe ?',
    a: 'HistoVec est un service public français gratuit, mais il dépend uniquement du vendeur et ne couvre pas l’historique d’un véhicule avant son importation en France. VériCar Europe vous permet de croiser les registres européens (Pays-Bas RDW live, Royaume-Uni, Norvège, Belgique, etc.), les rappels constructeur en direct (RappelConso & NHTSA), le décodage VIN ISO 3779 et même d’importer gratuitement un HistoVec pour obtenir un score 0–100 et une courbe kilométrique.',
  },
  {
    q: 'Comment fonctionne le système de crédits sans abonnement ?',
    a: 'Vous achetez uniquement les crédits dont vous avez besoin, sans renouvellement automatique. 1 crédit débloque 1 rapport complet avec réouverture gratuite à vie pour ce même véhicule. La pré-vérification, les 3 dossiers de démonstration et l’import HistoVec sont toujours gratuits (0 crédit).',
  },
  {
    q: 'Mon crédit est-il débité si le registre ne trouve pas le véhicule ?',
    a: 'Jamais. VériCar applique la garantie « Vérification avant débit » : le crédit est débité uniquement après réception effective des données du véhicule. En cas d’indisponibilité d’un registre ou d’identifiant introuvable, votre solde reste intact.',
  },
  {
    q: 'Puis-je vérifier un véhicule importé d’Allemagne, de Belgique ou des Pays-Bas ?',
    a: 'Oui. Les plaques néerlandaises sont interrogées en direct sur les 5 jeux de données officiels Open Data des Pays-Bas (statut compteur RDW, défauts APK, rappels, assurance WAM, WOK). Pour les véhicules allemands ou belges, le décodage VIN ISO 3779 + rappels temps réel est complété par notre guide HistoVec / Car-Pass.',
  },
  {
    q: 'Les données officielles temps réel et les dossiers de démonstration sont-ils distingués ?',
    a: 'Oui, en toute transparence. Chaque rapport affiche un badge d’origine explicite (Open Data temps réel, VIN Live, HistoVec fusionné ou Démonstration enrichie) ainsi que le détail exact des sources consultées et des champs effectivement vérifiés.',
  },
  {
    q: 'Comment fonctionne le partage de rapport avec un acheteur ?',
    a: 'Depuis n’importe quel rapport de votre espace, vous pouvez activer en un clic un lien public vérifié en lecture seule (/r/...). Aucune information personnelle de votre compte (ni email, ni nom, ni facture) n’est exposée, et vous pouvez révoquer le lien à tout moment.',
  },
  {
    q: 'Fournissez-vous une facture TVA pour les professionnels de l’automobile ?',
    a: 'Oui. Chaque achat de pack génère immédiatement une facture numérotée avec TVA à 20 % détaillée (HT, TVA, TTC), consultable et imprimable en PDF depuis votre espace « Mon compte & factures ».',
  },
  {
    q: 'Comment sont protégées mes données personnelles (RGPD) ?',
    a: 'VériCar utilise uniquement un cookie de session strictement nécessaire (HttpOnly, SameSite=Lax), sans aucun traceur publicitaire tiers. Depuis votre compte, vous pouvez exporter l’intégralité de vos données au format JSON ou supprimer définitivement votre compte en un clic.',
  },
];

export default function HomeView({ samples }) {
  const { navigate } = useRouter();
  const { publicConfig } = useAuth();
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('AUTO');
  const [openFaqIdx, setOpenFaqIdx] = useState(0);

  const bonusCredits = Number(publicConfig?.signupBonusCredits ?? 1);

  const goToPrecheck = (targetQuery, targetCountry = 'AUTO') => {
    const cleaned = String(targetQuery || '').trim();
    if (!cleaned) return;
    navigate(
      `/verifier?q=${encodeURIComponent(cleaned)}&country=${encodeURIComponent(targetCountry || 'AUTO')}`
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    goToPrecheck(query, country);
  };

  return (
    <main>
      {/* Editorial Hero */}
      <section className="hero-section">
        <div className="container hero-grid">
          <div>
            <p className="hero-eyebrow">Agrégateur européen d’historique véhicule</p>
            <h1 className="hero-title">
              L’historique complet de chaque voiture, au-delà des frontières d’HistoVec.
            </h1>
            <p className="hero-lead">
              Décodez n’importe quel numéro VIN ou immatriculation européenne : contrôles techniques,
              anomalies kilométriques, sinistres carrosserie, rappels constructeur en direct et fusion
              de vos rapports HistoVec français.
            </p>

            <div className="search-box">
              <form className="search-form" onSubmit={handleSubmit}>
                <select
                  id="search-country-select"
                  aria-label="Pays d’immatriculation"
                  className="search-select"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <input
                  id="search-vehicle-input"
                  type="text"
                  className="search-input"
                  placeholder="VIN (17 car.) ou plaque (ex. 21STVK, GH-418-KP)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                  aria-label="Numéro VIN ou plaque d’immatriculation"
                />

                <button
                  id="search-submit-btn"
                  type="submit"
                  className="btn btn-primary search-submit"
                  disabled={!query.trim()}
                >
                  <Search size={17} aria-hidden="true" />
                  Pré-vérifier
                </button>
              </form>

              <div className="search-hint-row">
                <span>Pré-vérification 100 % gratuite · Détection auto VIN ISO 3779, SIV FR, RDW NL…</span>
                <Link to="/histovec" className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }}>
                  <FileCheck2 size={14} aria-hidden="true" />
                  Importer un HistoVec (0 crédit)
                </Link>
              </div>
            </div>
          </div>

          <div className="hero-visual">
            <img
              src="/images/hero-sedan.jpg"
              alt="Véhicule européen soumis à l’inspection d’historique VériCar"
            />
            <div className="hero-visual-caption">
              <div>
                <span className="hero-stat-label">Registres cartographiés</span>
                <span className="hero-stat-value">12 pays européens</span>
              </div>
              <div>
                <span className="hero-stat-label">APIs temps réel actives</span>
                <span className="hero-stat-value">RDW · vPIC · RappelConso</span>
              </div>
              <div>
                <span className="hero-stat-label">Export &amp; partage</span>
                <span className="hero-stat-value">Export PDF &amp; Partage vérifié</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust & Guarantee Strip */}
      <section className="trust-strip" aria-label="Garanties VériCar Europe">
        <div className="container trust-strip-grid">
          <div className="trust-strip-item">
            <Globe2 size={18} color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>
              <strong>12 pays couverts</strong> — Open Data &amp; guides officiels
            </span>
          </div>
          <div className="trust-strip-item">
            <Sparkles size={18} color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>
              <strong>{bonusCredits > 0 ? `${bonusCredits} crédit offert` : 'Pré-vérification gratuite'}</strong>{' '}
              à la création du compte
            </span>
          </div>
          <div className="trust-strip-item">
            <ShieldCheck size={18} color="var(--ok)" aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>
              <strong>Garantie 0 crédit débité</strong> si registre indisponible
            </span>
          </div>
          <div className="trust-strip-item">
            <CheckCircle2 size={18} color="var(--ok)" aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>
              <strong>Sans abonnement</strong> — réouverture gratuite à vie
            </span>
          </div>
        </div>
      </section>

      {/* 3-Step How It Works */}
      <section className="section-block">
        <div className="container">
          <div className="section-header">
            <div>
              <h2 className="section-title">Comment ça marche en 3 étapes</h2>
              <p className="section-subtitle">
                Un parcours transparent : vérifiez la compatibilité gratuitement avant d’utiliser le moindre crédit.
              </p>
            </div>
            <Link to="/tarifs" className="btn btn-secondary btn-sm">
              <Coins size={15} aria-hidden="true" />
              Voir les packs de crédits
            </Link>
          </div>

          <div className="how-it-works-grid">
            {HOW_IT_WORKS.map((item) => (
              <article key={item.step} className="step-card">
                <div className="step-number">{item.step}</div>
                <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 17 }}>
                  {item.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.55 }}>
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Live API Tests */}
      <section className="section-block" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="section-header">
            <div>
              <h2 className="section-title">Tester en direct sur les APIs officielles ouvertes</h2>
              <p className="section-subtitle">
                Ces exemples interrogent en temps réel les serveurs Open Data publics (Pays-Bas RDW, RappelConso France, NHTSA vPIC) sans aucune donnée fictive.
              </p>
            </div>
            <span className="status-badge ok">
              <Radio size={13} aria-hidden="true" />
              APIs Live actives
            </span>
          </div>

          <div className="card-grid-3">
            {(samples?.liveExamples || []).map((item) => (
              <button
                key={item.query}
                type="button"
                className="sample-card"
                onClick={() => goToPrecheck(item.query, item.country)}
              >
                <div>
                  <span className="status-badge ok">{item.badge}</span>
                  <h3 className="sample-card-title">{item.title}</h3>
                  <p className="sample-card-desc">{item.subtitle}</p>
                </div>
                <div className="sample-card-footer">
                  <span className="mono">{item.query}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Pré-vérifier live <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Rich European Demo Dossiers */}
      <section className="section-block" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="section-header">
            <div>
              <h2 className="section-title">Dossiers européens complets (0 crédit · Démonstration)</h2>
              <p className="section-subtitle">
                Explorez gratuitement toutes les fonctionnalités avancées (courbe de recul compteur, schéma interactif de sinistres, import DE→FR, ex-VTC) sur 3 dossiers réalistes.
              </p>
            </div>
            <span className="status-badge info">Accès gratuit · 0 crédit</span>
          </div>

          <div className="card-grid-3">
            {(samples?.demoDossiers || []).map((demo) => {
              const badgeCls =
                demo.key === 'DE_FR_ROLLBACK'
                  ? 'danger'
                  : demo.key === 'FR_CLEAN_3008'
                    ? 'ok'
                    : 'warn';
              return (
                <button
                  key={demo.key}
                  type="button"
                  className="sample-card"
                  onClick={() => goToPrecheck(demo.query, demo.country)}
                >
                  <div>
                    <span className={`status-badge ${badgeCls}`}>{demo.badge}</span>
                    <h3 className="sample-card-title">{demo.title}</h3>
                    <p className="sample-card-desc">{demo.subtitle}</p>
                  </div>
                  <div className="sample-card-footer">
                    <span className="eu-plate">
                      <span className="eu-plate-band">{demo.country}</span>
                      <span className="eu-plate-text">{demo.plate}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Voir le dossier <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section className="section-block" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="section-header">
            <div>
              <h2 className="section-title">Des packs simples, sans abonnement</h2>
              <p className="section-subtitle">
                Crédits valables sans limite de durée, facture TVA 20 % immédiate et réouverture gratuite des véhicules déjà débloqués.
              </p>
            </div>
            <Link to="/tarifs" className="btn btn-primary btn-sm">
              Choisir un pack <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>

          <div className="card-grid-3">
            {PRICING_TEASER.map((pack) => (
              <article
                key={pack.id}
                className="surface-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  borderColor: pack.popular ? 'var(--accent)' : undefined,
                  boxShadow: pack.popular ? 'var(--shadow-md)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>{pack.name}</h3>
                  {pack.popular && <span className="status-badge info">Populaire</span>}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--ink-primary)' }}>
                  {pack.price}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>{pack.unit}</div>
                <p style={{ margin: '0 0 8px', fontSize: 13.5, color: 'var(--ink-secondary)', flex: 1 }}>
                  {pack.desc}
                </p>
                <Link
                  to="/tarifs"
                  className={`btn btn-sm ${pack.popular ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: '100%' }}
                >
                  Commander ce pack
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Transparent Comparison: Why cross-border matters */}
      <section className="section-block" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="comparison-panel">
            <div className="section-header" style={{ marginBottom: 16 }}>
              <div>
                <h2 className="section-title">Pourquoi combiner HistoVec et une agrégation européenne ?</h2>
                <p className="section-subtitle">
                  HistoVec est incontournable et gratuit en France, mais chaque registre national s’arrête à la frontière.
                </p>
              </div>
              <Link to="/couverture" className="btn btn-secondary btn-sm">
                <Globe2 size={15} aria-hidden="true" />
                Voir les 12 pays européens
              </Link>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Critère de vérification</th>
                    <th>HistoVec seul (France)</th>
                    <th>VériCar Europe (plateforme complète)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>Historique administratif France (gages, VGE/VEI, titulaires)</strong>
                    </td>
                    <td>Gratuit, exige l’action du propriétaire</td>
                    <td>Import &amp; analyse HistoVec gratuit (0 crédit) + assistant demande vendeur</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Véhicules importés (Allemagne, Pays-Bas, Belgique, UK…)</strong>
                    </td>
                    <td>Angle mort total avant l’entrée en France</td>
                    <td>Croisement multi-pays (RDW live, MOT UK, Vegvesen NO, Car-Pass, guides pays)</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Rappels de sécurité constructeur</strong>
                    </td>
                    <td>Non inclus dans le rapport SIV</td>
                    <td>Vérification temps réel RappelConso (DGCCRF) + RDW + NHTSA</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Aide à la décision, partage &amp; négociation</strong>
                    </td>
                    <td>Données brutes sans score ni cote</td>
                    <td>Score 0–100, détection recul compteur, Crit’Air, schéma sinistres, PDF &amp; lien vérifié</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Accessible FAQ Accordion */}
      <section className="section-block" style={{ paddingTop: 8, paddingBottom: 64 }}>
        <div className="container" style={{ maxWidth: 880 }}>
          <div className="section-header">
            <div>
              <h2 className="section-title">Questions fréquentes</h2>
              <p className="section-subtitle">
                Tout savoir sur nos sources officielles, le fonctionnement des crédits et la conformité RGPD.
              </p>
            </div>
          </div>

          <div className="faq-list" id="home-faq-list">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              const panelId = `faq-panel-${idx}`;
              const triggerId = `faq-trigger-${idx}`;
              return (
                <div key={item.q} className="faq-item">
                  <button
                    id={triggerId}
                    type="button"
                    className="faq-trigger"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenFaqIdx(isOpen ? -1 : idx)}
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className="faq-chevron"
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </button>
                  {isOpen && (
                    <div id={panelId} role="region" aria-labelledby={triggerId} className="faq-panel">
                      <p className="faq-answer">{item.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
