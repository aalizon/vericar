import { useEffect } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { sanitizeReturnTo, useRouter } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { AuthForm } from './AuthModal.jsx';

function resolveAuthReturnTo(raw) {
  const sanitized = sanitizeReturnTo(raw, '/compte');
  if (sanitized.startsWith('/connexion') || sanitized.startsWith('/inscription')) {
    return '/compte';
  }
  return sanitized;
}

export default function AuthPage({ mode = 'login' }) {
  const { search, searchParams, navigate } = useRouter();
  const { isAuthenticated, loading } = useAuth();

  const safeReturnTo = resolveAuthReturnTo(searchParams.get('returnTo'));

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate(safeReturnTo, { replace: true });
    }
  }, [loading, isAuthenticated, navigate, safeReturnTo]);

  const handleModeChange = (nextMode) => {
    const targetPath = nextMode === 'register' ? '/inscription' : '/connexion';
    navigate(`${targetPath}${search}`, { replace: true });
  };

  const handleSuccess = () => {
    navigate(safeReturnTo, { replace: true });
  };

  if (!loading && isAuthenticated) {
    return (
      <main className="container auth-page-shell">
        <div className="surface-card auth-card" style={{ textAlign: 'center' }} role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" style={{ margin: '0 auto 12px' }} />
          <p style={{ margin: 0, color: 'var(--ink-secondary)' }}>
            Vous êtes déjà connecté. Redirection en cours…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container auth-page-shell">
      <section className="surface-card auth-card">
        <div className="auth-card-head">
          <span
            className="brand-mark"
            aria-hidden="true"
            style={{ width: 42, height: 42, margin: '0 auto' }}
          >
            <ShieldCheck size={22} strokeWidth={2.2} />
          </span>
          <h1>{mode === 'register' ? 'Créer votre compte VériCar' : 'Connexion à votre espace'}</h1>
          <p>
            {mode === 'register'
              ? 'Débloquez vos rapports d’historique véhicule européens et conservez vos factures et dossiers.'
              : 'Retrouvez vos crédits, vos factures TVA et tous vos rapports véhicule enregistrés.'}
          </p>
        </div>

        <AuthForm
          key={mode}
          initialMode={mode}
          onModeChange={handleModeChange}
          onSuccess={handleSuccess}
          autoFocusEmail
          idPrefix="auth-page"
        />
      </section>
    </main>
  );
}
