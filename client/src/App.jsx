import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Lock } from 'lucide-react';
import { api } from './api.js';
import { Link, useRouter } from './lib/router.jsx';
import { useAuth } from './context/AuthContext.jsx';
import Header from './components/layout/Header.jsx';
import Footer from './components/layout/Footer.jsx';
import CookieNotice from './components/layout/CookieNotice.jsx';
import NotFoundView from './components/layout/NotFoundView.jsx';
import AuthModal from './components/auth/AuthModal.jsx';
import AuthPage from './components/auth/AuthPage.jsx';
import HomeView from './components/HomeView.jsx';
import PrecheckView from './components/funnel/PrecheckView.jsx';
import PricingView from './components/funnel/PricingView.jsx';
import ReportView from './components/ReportView.jsx';
import PublicShareView from './components/report/PublicShareView.jsx';
import HistovecImportView from './components/HistovecImportView.jsx';
import RegistriesView from './components/RegistriesView.jsx';
import HistoryView from './components/HistoryView.jsx';
import AccountView from './components/account/AccountView.jsx';
import InvoiceView from './components/account/InvoiceView.jsx';
import AdminView from './components/admin/AdminView.jsx';
import LegalView from './components/legal/LegalView.jsx';

function ReportRouteView({ reportId, getCachedReport, cacheReport }) {
  const { setPageMeta } = useRouter();
  const { isAuthenticated, loading: authLoading, openAuthModal } = useAuth();

  const cachedReport = getCachedReport(reportId);
  const [fetchedReport, setFetchedReport] = useState(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);

  const report = fetchedReport || cachedReport;

  useEffect(() => {
    if (cachedReport || authLoading || !isAuthenticated) return undefined;

    let cancelled = false;
    api
      .getReport(reportId)
      .then((fetched) => {
        if (!cancelled) {
          cacheReport(fetched);
          setFetchedReport(fetched);
          setError('');
          setAuthRequired(false);
          setFetchDone(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err?.status === 401) {
            setAuthRequired(true);
          } else {
            setError(err?.message || 'Rapport introuvable ou inaccessible.');
          }
          setFetchDone(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reportId, cachedReport, authLoading, isAuthenticated, cacheReport]);

  useEffect(() => {
    if (!report?.vehicle?.make) return;
    const v = report.vehicle;
    setPageMeta({
      title: `Rapport ${v.make} ${v.model || ''} — VériCar Europe`,
      description: `Rapport d’historique véhicule ${v.make} ${v.model || ''} (${report.trustScore}/100) généré par VériCar Europe.`,
    });
  }, [report, setPageMeta]);

  const loading = !report && (authLoading || (isAuthenticated && !fetchDone));
  const needsAuth = !report && !authLoading && (!isAuthenticated || authRequired);

  if (loading) {
    return (
      <main className="container saas-page">
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Chargement du rapport {reportId}…</p>
        </div>
      </main>
    );
  }

  if (needsAuth) {
    return (
      <main className="container saas-page">
        <section className="surface-card saas-center-card">
          <Lock size={30} color="var(--accent)" aria-hidden="true" />
          <h1>Rapport privé — Connexion requise</h1>
          <p>
            Connectez-vous au compte propriétaire pour ouvrir ce dossier. S’il s’agit d’un rapport
            partagé par un vendeur, demandez-lui son lien public vérifié.
          </p>
          <div className="saas-action-row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openAuthModal({ mode: 'login' })}
            >
              Se connecter
            </button>
            <Link to="/" className="btn btn-secondary btn-sm">
              <ArrowLeft size={14} aria-hidden="true" />
              Retour à l’accueil
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (error || !report) {
    return (
      <main className="container saas-page">
        <section className="surface-card saas-center-card" role="alert">
          <AlertCircle size={30} color="var(--danger)" aria-hidden="true" />
          <h1>Rapport introuvable</h1>
          <p>{error || 'Ce rapport n’existe pas ou a été supprimé de votre bibliothèque.'}</p>
          <div className="saas-action-row">
            <Link to="/mes-rapports" className="btn btn-primary btn-sm">
              Mes rapports
            </Link>
            <Link to="/" className="btn btn-secondary btn-sm">
              Nouvelle vérification
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <ReportView
      key={report.id}
      report={report}
      onReportUpdated={(updated) => {
        cacheReport(updated);
        setFetchedReport(updated);
      }}
    />
  );
}

export default function App() {
  const { route, params } = useRouter();
  const { isAuthenticated } = useAuth();

  const [samples, setSamples] = useState(null);
  const [registries, setRegistries] = useState([]);
  const [savedReportsCount, setSavedReportsCount] = useState(0);

  // In-memory cache for freshly unlocked reports & ephemeral guest demo dossiers
  const reportCacheRef = useRef(new Map());

  const cacheReport = useCallback((report) => {
    if (!report || !report.id) return;
    reportCacheRef.current.set(String(report.id), report);
  }, []);

  const getCachedReport = useCallback((id) => {
    if (!id) return null;
    return reportCacheRef.current.get(String(id)) || null;
  }, []);

  const refreshSavedReportsCount = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.listReports({ limit: 50 });
      setSavedReportsCount(Array.isArray(res?.reports) ? res.reports.length : 0);
    } catch {
      // Non-blocking badge counter
    }
  }, [isAuthenticated]);

  useEffect(() => {
    api.getSamples().then(setSamples).catch(() => {});
    api
      .getRegistries()
      .then((res) => setRegistries(res?.registries || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      // Clear cached private reports on sign-out, keeping only ephemeral DEMO- dossiers
      for (const key of Array.from(reportCacheRef.current.keys())) {
        if (!key.startsWith('DEMO-')) {
          reportCacheRef.current.delete(key);
        }
      }
      return undefined;
    }
    let cancelled = false;
    api
      .listReports({ limit: 50 })
      .then((res) => {
        if (!cancelled) {
          setSavedReportsCount(Array.isArray(res?.reports) ? res.reports.length : 0);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const visibleReportsCount = isAuthenticated ? savedReportsCount : 0;

  const handleReportReady = useCallback(
    (report) => {
      cacheReport(report);
      if (isAuthenticated && report && !report.ephemeral) {
        refreshSavedReportsCount();
      }
    },
    [cacheReport, isAuthenticated, refreshSavedReportsCount]
  );

  let content = null;
  switch (route.name) {
    case 'home':
      content = <HomeView samples={samples} />;
      break;
    case 'verifier':
      content = <PrecheckView onReportReady={handleReportReady} />;
      break;
    case 'report':
      content = (
        <ReportRouteView
          key={params.id}
          reportId={params.id}
          getCachedReport={getCachedReport}
          cacheReport={cacheReport}
        />
      );
      break;
    case 'share':
      content = <PublicShareView key={params.shareToken} shareToken={params.shareToken} />;
      break;
    case 'pricing':
      content = <PricingView />;
      break;
    case 'login':
      content = <AuthPage mode="login" />;
      break;
    case 'register':
      content = <AuthPage mode="register" />;
      break;
    case 'account':
      content = <AccountView />;
      break;
    case 'invoice':
      content = <InvoiceView key={params.orderId} orderId={params.orderId} />;
      break;
    case 'history':
      content = <HistoryView onReportsChanged={refreshSavedReportsCount} />;
      break;
    case 'histovec':
      content = (
        <HistovecImportView
          samplePayload={samples?.sampleHistovec || samples?.histovecSample}
          onReportGenerated={handleReportReady}
        />
      );
      break;
    case 'registries':
      content = <RegistriesView registries={registries} />;
      break;
    case 'admin':
      content = <AdminView />;
      break;
    case 'mentions-legales':
    case 'cgu':
    case 'confidentialite':
      content = <LegalView page={route.name} />;
      break;
    default:
      content = <NotFoundView />;
      break;
  }

  return (
    <div className="saas-app">
      <a href="#main-content" className="skip-link">
        Aller au contenu principal
      </a>
      <Header savedReportsCount={visibleReportsCount} />
      <div id="main-content" className="saas-main">
        {content}
      </div>
      <Footer />
      <AuthModal />
      <CookieNotice />
    </div>
  );
}
