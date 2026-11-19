import { Mail, ShieldCheck } from 'lucide-react';
import { Link } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const CURRENT_YEAR = new Date().getFullYear();

export default function Footer() {
  const { publicConfig } = useAuth();
  const publisherName = publicConfig?.legal?.publisherName || 'VériCar Europe';
  const contactEmail = publicConfig?.legal?.contactEmail || '';
  const currentYear = CURRENT_YEAR;

  return (
    <footer className="saas-footer no-print">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="brand-button" aria-current={undefined}>
              <span className="brand-mark" aria-hidden="true">
                <ShieldCheck size={19} strokeWidth={2.3} />
              </span>
              <span className="brand-name">VériCar</span>
              <span className="brand-tag">Europe</span>
            </Link>
            <p className="footer-brand-desc">
              Vérification d’historique véhicule en France et en Europe : décodage VIN ISO 3779,
              registres Open Data officiels, contrôles techniques, rappels sécurité en direct et
              fusion HistoVec.
            </p>
            {contactEmail && (
              <a href={`mailto:${contactEmail}`} className="footer-contact-link">
                <Mail size={14} aria-hidden="true" />
                {contactEmail}
              </a>
            )}
          </div>

          <div>
            <h2 className="footer-col-title">Produit</h2>
            <ul className="footer-links">
              <li>
                <Link to="/" aria-current={undefined}>
                  Vérifier un véhicule
                </Link>
              </li>
              <li>
                <Link to="/tarifs" aria-current={undefined}>
                  Tarifs &amp; Packs
                </Link>
              </li>
              <li>
                <Link to="/histovec" aria-current={undefined}>
                  Import HistoVec
                </Link>
              </li>
              <li>
                <Link to="/couverture" aria-current={undefined}>
                  Couverture UE (12 pays)
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="footer-col-title">Espace client</h2>
            <ul className="footer-links">
              <li>
                <Link to="/mes-rapports" aria-current={undefined}>
                  Mes rapports
                </Link>
              </li>
              <li>
                <Link to="/compte" aria-current={undefined}>
                  Mon compte &amp; factures
                </Link>
              </li>
              <li>
                <Link to="/connexion" aria-current={undefined}>
                  Connexion
                </Link>
              </li>
              <li>
                <Link to="/inscription" aria-current={undefined}>
                  Créer un compte
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="footer-col-title">Légal &amp; RGPD</h2>
            <ul className="footer-links">
              <li>
                <Link to="/mentions-legales" aria-current={undefined}>
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link to="/cgu" aria-current={undefined}>
                  CGU &amp; CGV
                </Link>
              </li>
              <li>
                <Link to="/confidentialite" aria-current={undefined}>
                  Politique de confidentialité
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div>
            © {currentYear} {publisherName}. Tous droits réservés.
          </div>
          <p className="footer-disclaimer">
            Service indépendant non affilié à l’ANTS ni aux constructeurs automobiles. Les sources
            temps réel et dossiers de démonstration sont distingués sur chaque rapport.
          </p>
        </div>
      </div>
    </footer>
  );
}
