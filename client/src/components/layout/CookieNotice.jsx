import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Link } from '../../lib/router.jsx';

const COOKIE_NOTICE_KEY = 'vericar_cookie_notice_v1';

function readDismissedFlag() {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(COOKIE_NOTICE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export default function CookieNotice() {
  const [dismissed, setDismissed] = useState(readDismissedFlag);

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, 'dismissed');
    } catch {
      // Ignore private-browsing storage errors
    }
    setDismissed(true);
  };

  return (
    <aside
      id="cookie-notice-banner"
      className="cookie-notice no-print"
      aria-label="Information sur les cookies essentiels"
    >
      <div className="cookie-notice-body">
        <ShieldCheck
          size={19}
          color="var(--accent)"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 2 }}
        />
        <div>
          <strong>Cookies strictement nécessaires uniquement</strong> — VériCar Europe utilise un
          unique cookie technique de session (<code className="mono">vericar_session</code>) pour
          sécuriser votre connexion. Aucun traceur publicitaire ni cookie analytique tiers n’est
          déposé (conformité CNIL).{' '}
          <Link to="/confidentialite" aria-current={undefined}>
            En savoir plus
          </Link>
          .
        </div>
      </div>

      <div className="cookie-notice-actions">
        <button
          id="cookie-notice-dismiss"
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleDismiss}
        >
          J’ai compris
        </button>
      </div>
    </aside>
  );
}
