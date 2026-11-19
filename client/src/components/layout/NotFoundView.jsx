import { ArrowLeft, Compass, CreditCard } from 'lucide-react';
import { Link, useRouter } from '../../lib/router.jsx';

export default function NotFoundView() {
  const { pathname } = useRouter();

  return (
    <main className="container notfound-wrap">
      <section className="surface-card notfound-card">
        <span className="notfound-code">ERREUR 404</span>
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            marginBottom: 10,
            color: 'var(--accent)',
          }}
          aria-hidden="true"
        >
          <Compass size={32} />
        </div>
        <h1>Page introuvable</h1>
        <p>
          La page demandée n’existe pas ou a été déplacée :{' '}
          <code className="notfound-path">{pathname}</code>
        </p>

        <div className="notfound-actions">
          <Link to="/" className="btn btn-primary">
            <ArrowLeft size={16} aria-hidden="true" />
            Retour à l’accueil
          </Link>
          <Link to="/tarifs" className="btn btn-secondary">
            <CreditCard size={16} aria-hidden="true" />
            Voir les tarifs
          </Link>
        </div>
      </section>
    </main>
  );
}
