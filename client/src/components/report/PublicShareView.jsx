import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../../api.js';
import { Link, useRouter } from '../../lib/router.jsx';
import ReportView from '../ReportView.jsx';

export default function PublicShareView({ shareToken }) {
  const { setPageMeta } = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.getSharedReport(shareToken);
        if (!cancelled) {
          setData(res);
          const v = res?.report?.vehicle;
          if (v?.make) {
            setPageMeta({
              title: `Rapport partagé : ${v.make} ${v.model || ''} — VériCar Europe`,
              description: `Consultez ce rapport d’historique véhicule vérifié (${res.report.trustScore}/100) partagé via VériCar Europe.`,
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Ce lien de partage est invalide ou a été révoqué par son propriétaire.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shareToken, setPageMeta]);

  if (loading) {
    return (
      <main className="container saas-page">
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Vérification du lien de partage…</p>
        </div>
      </main>
    );
  }

  if (error || !data?.report) {
    return (
      <main className="container saas-page">
        <section className="surface-card saas-center-card" role="alert" id="share-not-found">
          <AlertCircle size={32} color="var(--danger)" aria-hidden="true" />
          <h1>Lien de partage indisponible</h1>
          <p>{error || 'Ce lien de partage n’est plus actif.'}</p>
          <div className="saas-action-row">
            <Link to="/" className="btn btn-primary btn-sm">
              Vérifier un autre véhicule
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const sharedDate = data.sharedAt
    ? new Date(data.sharedAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null;

  return (
    <div>
      <div className="container" style={{ paddingTop: 20 }}>
        <div className="public-share-banner no-print" id="public-share-banner" role="status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={20} color="var(--ok)" aria-hidden="true" style={{ flexShrink: 0 }} />
            <div>
              <strong>Rapport vérifié et partagé via VériCar Europe</strong>
              <div className="public-share-meta">
                Consultation publique en lecture seule
                {sharedDate ? ` · Partagé le ${sharedDate}` : ''} · Aucune donnée personnelle du propriétaire n’est exposée
              </div>
            </div>
          </div>
          <Link to="/" className="btn btn-secondary btn-sm">
            Vérifier un autre véhicule
          </Link>
        </div>
      </div>

      <ReportView report={data.report} readOnly />

      <div className="container no-print" style={{ paddingBottom: 48 }}>
        <section className="surface-card public-share-cta-card">
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: 19, fontFamily: 'var(--font-display)' }}>
              Vous achetez ou vendez un véhicule d’occasion ?
            </h2>
            <p style={{ margin: 0, color: 'var(--ink-secondary)', fontSize: 14 }}>
              Lancez une pré-vérification gratuite par VIN ou plaque européenne et profitez d’un crédit
              offert à l’inscription.
            </p>
          </div>
          <Link to="/" className="btn btn-primary">
            Lancer une vérification
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </div>
  );
}
