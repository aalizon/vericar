import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function LegalView({ page = 'mentions-legales' }) {
  const { publicConfig } = useAuth();
  const legal = publicConfig?.legal || {};
  const publisherName = legal.publisherName || 'VériCar Europe SAS';
  const contactEmail = legal.contactEmail || 'contact@vericar-europe.eu';
  const hostProvider = legal.hostProvider || 'Hébergement Cloud UE';

  return (
    <main className="container saas-page">
      <div style={{ marginBottom: 16 }}>
        <Link to="/" className="btn btn-ghost btn-sm">
          <ArrowLeft size={15} aria-hidden="true" />
          Retour à l’accueil
        </Link>
      </div>

      <div className="legal-layout">
        <aside className="legal-toc">
          <div className="surface-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 10 }}>
              Documents légaux
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="Navigation légale">
              <Link
                to="/mentions-legales"
                className={`nav-item ${page === 'mentions-legales' ? 'active' : ''}`}
              >
                Mentions légales (LCEN)
              </Link>
              <Link to="/cgu" className={`nav-item ${page === 'cgu' ? 'active' : ''}`}>
                CGU &amp; CGV (Art. L221-28)
              </Link>
              <Link
                to="/confidentialite"
                className={`nav-item ${page === 'confidentialite' ? 'active' : ''}`}
              >
                Confidentialité &amp; RGPD
              </Link>
            </nav>
          </div>
        </aside>

        <article className="surface-card saas-legal-article legal-prose">
          {page === 'mentions-legales' && (
            <>
              <span className="eyebrow">Information légale — Loi LCEN n° 2004-575</span>
              <h1>Mentions légales</h1>
              <p>
                Conformément aux dispositions des articles 6-III et 19 de la loi pour la Confiance dans
                l’Économie Numérique (LCEN), les informations relatives à l’édition et à l’hébergement du
                service <strong>VériCar Europe</strong> sont précisées ci-dessous.
              </p>

              <h2>1. Éditeur de la plateforme</h2>
              <p>
                <strong>{publisherName}</strong>
                <br />
                Contact éditeur &amp; support :{' '}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </p>

              <h2>2. Hébergement</h2>
              <p>
                La plateforme VériCar Europe est hébergée sur une infrastructure cloud européenne :{' '}
                <strong>{hostProvider}</strong>.
              </p>

              <h2>3. Indépendance &amp; sources officielles</h2>
              <p>
                VériCar Europe est une plateforme indépendante non affiliée au Ministère de l’Intérieur, à
                l’ANTS, au service HistoVec, ni aux constructeurs automobiles. Les données présentées
                proviennent de registres Open Data officiels (Pays-Bas RDW CC0, DGCCRF RappelConso, NHTSA
                vPIC &amp; Recalls), de connecteurs agréés lorsqu’ils sont activés, ou d’imports volontaires
                fournis par l’utilisateur (HistoVec). Les dossiers de démonstration sont systématiquement
                identifiés comme tels.
              </p>

              <h2>4. Propriété intellectuelle</h2>
              <p>
                L’architecture logicielle, l’interface éditoriale, les algorithmes d’analyse kilométrique
                et le score de confiance sont la propriété exclusive de {publisherName}.
              </p>
            </>
          )}

          {page === 'cgu' && (
            <>
              <span className="eyebrow">Conditions Contractuelles</span>
              <h1>Conditions Générales d’Utilisation et de Vente (CGU / CGV)</h1>

              <h2>1. Objet du service</h2>
              <p>
                VériCar Europe fournit un service numérique d’agrégation d’informations publiques et
                partenaires relatives à l’historique des véhicules d’occasion en Europe (décodage VIN ISO
                3779, contrôle de cohérence kilométrique, rappels sécurité, contrôles techniques et fusion
                HistoVec).
              </p>

              <h2>2. Modèle par crédits &amp; tarification TTC</h2>
              <p>
                La pré-vérification d’un véhicule, la consultation des dossiers de démonstration et l’import
                d’un rapport HistoVec sont gratuits (0 crédit). Le déblocage d’un rapport live multi-sources
                consomme <strong>1 crédit</strong>. Les packs proposés sont facturés en euros TTC (TVA
                française 20 % incluse) sans abonnement récurrent :
              </p>
              <ul>
                <li>Pack Découverte : 1 crédit — 14,90 € TTC</li>
                <li>Pack Acheteur : 2 crédits — 24,90 € TTC (12,45 € / rapport)</li>
                <li>Pack Comparateur : 3 crédits — 32,90 € TTC (10,97 € / rapport)</li>
                <li>Pack Pro / Marchand : 10 crédits — 79,90 € TTC (7,99 € / rapport)</li>
              </ul>

              <h2>3. Garantie « Fetch-before-charge » &amp; réouverture gratuite</h2>
              <p>
                Aucun crédit n’est débité si le registre distant ne retourne aucun véhicule correspondant ou
                rencontre une indisponibilité technique. Un véhicule déjà débloqué sur votre compte peut être
                consulté à nouveau à tout moment sans consommation de crédit supplémentaire.
              </p>

              <h2>4. Droit de rétractation — Contenu numérique immédiat (Art. L221-28)</h2>
              <p>
                Conformément à l’article L221-28, 13° du Code de la consommation, le droit de rétractation
                de 14 jours ne peut être exercé pour la fourniture d’un contenu numérique sans support
                matériel dont l’exécution a commencé avec l’accord préalable exprès du consommateur et son
                renoncement exprès au droit de rétractation. Cette acceptation est recueillie avant chaque
                commande.
              </p>

              <h2>5. Limites de responsabilité</h2>
              <p>
                Un rapport d’historique constitue une aide objective à la décision mais ne remplace pas un
                examen mécanique physique, un essai routier ni la vérification des documents originaux
                (carte grise, factures d’entretien, procès-verbaux de contrôle technique).
              </p>
            </>
          )}

          {page === 'confidentialite' && (
            <>
              <span className="eyebrow">Protection des données — RGPD (UE 2016/679)</span>
              <h1>Politique de confidentialité &amp; Cookies</h1>

              <h2>1. Responsable de traitement</h2>
              <p>
                Le responsable de traitement est <strong>{publisherName}</strong>. Pour toute demande
                relative à vos données personnelles :{' '}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
              </p>

              <h2>2. Données collectées et finalités</h2>
              <ul>
                <li>
                  <strong>Compte &amp; authentification :</strong> adresse e-mail, mot de passe chiffré par
                  dérivation <code>scrypt</code>, nom et société optionnels pour l’édition de vos factures.
                </li>
                <li>
                  <strong>Facturation &amp; crédits :</strong> journal des crédits, commandes et factures
                  TVA (les données bancaires sont traitées exclusivement par Stripe en mode production).
                </li>
                <li>
                  <strong>Rapports véhicule :</strong> historique de vos vérifications et liens de partage
                  que vous pouvez activer ou révoquer en un clic.
                </li>
              </ul>

              <h2>3. Cookies strictement nécessaires</h2>
              <p>
                VériCar Europe utilise uniquement un cookie technique essentiel (<code>vericar_session</code>
                , <code>HttpOnly</code>, <code>SameSite=Lax</code>) indispensable au maintien de votre
                session connectée. <strong>Aucun cookie publicitaire ni traceur tiers</strong> n’est déposé.
              </p>

              <h2>4. Vos droits RGPD (Accès, Portabilité &amp; Effacement)</h2>
              <p>
                Conformément au RGPD, vous pouvez exercer directement vos droits en autonomie depuis votre{' '}
                <Link to="/compte?tab=profile">Espace Mon compte</Link> :
              </p>
              <ul>
                <li>
                  <strong>Droit à la portabilité (Art. 20) :</strong> téléchargement immédiat de toutes vos
                  données au format JSON.
                </li>
                <li>
                  <strong>Droit à l’effacement (Art. 17) :</strong> suppression immédiate et en cascade de
                  votre compte, sessions, rapports et liens de partage après confirmation par mot de passe.
                </li>
              </ul>

              <div className="saas-banner saas-banner-info" style={{ marginTop: 20 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <ShieldCheck size={16} aria-hidden="true" />
                  Liens de partage publics : aucune adresse e-mail ni identité du titulaire du compte n’est
                  jamais exposée sur les pages <code>/r/:token</code>.
                </span>
              </div>
            </>
          )}
        </article>
      </div>
    </main>
  );
}
