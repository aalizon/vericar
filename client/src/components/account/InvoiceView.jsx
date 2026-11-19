import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  FlaskConical,
  Loader2,
  Lock,
  Printer,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../../api.js';
import { Link } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

function formatEuros(cents) {
  return `${(Number(cents || 0) / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function InvoiceView({ orderId }) {
  const { isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading || !isAuthenticated) return undefined;

    let cancelled = false;
    api
      .getOrderReceipt(orderId, 'json')
      .then((res) => {
        if (!cancelled) {
          setReceipt(res?.receipt || null);
          setError('');
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Facture introuvable ou accès refusé.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, authLoading, isAuthenticated]);

  if (authLoading || (isAuthenticated && loading)) {
    return (
      <main className="container saas-page">
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Chargement de la facture…</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="container saas-page">
        <section className="surface-card guard-card">
          <span className="guard-icon-badge" aria-hidden="true">
            <Lock size={24} />
          </span>
          <h1>Connexion requise</h1>
          <p>Connectez-vous au compte titulaire de la commande pour consulter cette facture.</p>
          <div className="guard-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                openAuthModal({ mode: 'login', returnTo: `/compte/factures/${encodeURIComponent(orderId)}` })
              }
            >
              Se connecter
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (error || !receipt) {
    return (
      <main className="container saas-page">
        <section className="surface-card saas-center-card" role="alert">
          <AlertCircle size={28} color="var(--danger)" aria-hidden="true" />
          <h1>Facture introuvable</h1>
          <p>{error || 'Cette facture n’existe pas ou n’est pas associée à votre compte.'}</p>
          <Link to="/compte?tab=orders" className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} aria-hidden="true" />
            Retour à mes commandes
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="container saas-page">
      <div className="invoice-toolbar no-print">
        <Link to="/compte?tab=orders" className="btn btn-ghost btn-sm">
          <ArrowLeft size={15} aria-hidden="true" />
          Retour aux commandes
        </Link>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={api.getOrderReceiptHtmlUrl(orderId)}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            <ExternalLink size={15} aria-hidden="true" />
            Ouvrir la version HTML autonome
          </a>
          <button
            id="btn-print-invoice"
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => window.print()}
          >
            <Printer size={15} aria-hidden="true" />
            Imprimer / PDF
          </button>
        </div>
      </div>

      <article className="surface-card invoice-sheet" id="invoice-sheet">
        {receipt.sandboxNotice && (
          <div className="invoice-sandbox-banner" role="alert">
            <FlaskConical size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>{receipt.sandboxNotice}</span>
          </div>
        )}

        <header className="invoice-header">
          <div className="invoice-brand">
            <span className="brand-mark" aria-hidden="true">
              <ShieldCheck size={19} strokeWidth={2.3} />
            </span>
            <div>
              <div className="brand-name">{receipt.issuer?.name || 'VériCar Europe'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                {receipt.issuer?.contactEmail}
              </div>
            </div>
          </div>

          <div className="invoice-doc-meta">
            <h1>FACTURE</h1>
            <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
              {receipt.invoiceNumber}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 4 }}>
              Émise le {formatDate(receipt.issuedAt)}
              {receipt.paidAt ? ` · Payée le ${formatDate(receipt.paidAt)}` : ''}
            </div>
          </div>
        </header>

        <section className="invoice-parties">
          <div className="invoice-party-box">
            <h2>Émetteur</h2>
            <strong>{receipt.issuer?.name}</strong>
            <div style={{ fontSize: 13.5, color: 'var(--ink-secondary)' }}>
              {receipt.issuer?.contactEmail}
            </div>
          </div>
          <div className="invoice-party-box">
            <h2>Client</h2>
            <strong>{receipt.customer?.fullName || receipt.customer?.email}</strong>
            {receipt.customer?.companyName && (
              <div style={{ fontSize: 13.5, color: 'var(--ink-primary)' }}>
                {receipt.customer.companyName}
              </div>
            )}
            <div className="mono" style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
              {receipt.customer?.email}
            </div>
          </div>
        </section>

        <div className="table-wrap" style={{ marginBottom: 20 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th>Qté</th>
                <th>Mode</th>
                <th>Montant HT</th>
                <th>Montant TTC</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{receipt.lineItem?.description}</td>
                <td className="mono">{receipt.lineItem?.quantity ?? 1}</td>
                <td>{receipt.provider === 'stripe' ? 'Carte bancaire (Stripe)' : 'Test / Sandbox'}</td>
                <td className="mono">{formatEuros(receipt.subtotalCents)}</td>
                <td className="mono">{formatEuros(receipt.totalCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="invoice-totals">
          <div className="invoice-totals-row">
            <span>Sous-total HT</span>
            <span className="mono">{formatEuros(receipt.subtotalCents)}</span>
          </div>
          <div className="invoice-totals-row">
            <span>TVA ({receipt.vatRate ?? 20} %)</span>
            <span className="mono">{formatEuros(receipt.vatCents)}</span>
          </div>
          <div className="invoice-totals-grand">
            <span>Total TTC ({receipt.currency || 'EUR'})</span>
            <span className="mono">{formatEuros(receipt.totalCents)}</span>
          </div>
        </div>

        <footer className="invoice-legal-note">
          Référence interne de commande : <span className="mono">{receipt.orderId}</span>. Crédits
          numériques fournis immédiatement après validation conformément aux CGV et à l’article
          L221-28 du Code de la consommation.
        </footer>
      </article>
    </main>
  );
}
