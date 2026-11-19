import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Receipt,
  RefreshCw,
  ShieldAlert,
  Trash2,
  User,
} from 'lucide-react';
import { api } from '../../api.js';
import { Link, useRouter } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const REASON_LABELS = {
  signup_bonus: 'Crédit de bienvenue',
  purchase: 'Achat de pack',
  report_unlock: 'Déblocage rapport',
  admin_grant: 'Ajustement support (+)',
  admin_adjustment: 'Ajustement support',
  refund: 'Remboursement',
};

function formatEuros(cents) {
  return `${(Number(cents || 0) / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AccountView() {
  const { searchParams, navigate } = useRouter();
  const {
    user,
    isAuthenticated,
    loading: authLoading,
    creditsBalance,
    refreshMe,
    updateUser,
    clearUser,
    openAuthModal,
  } = useAuth();
  const { showToast } = useToast();

  const initialTab = searchParams.get('tab');
  const checkoutParam = searchParams.get('checkout');
  const activeTab = ['credits', 'orders', 'profile'].includes(initialTab) ? initialTab : 'credits';

  const [summary, setSummary] = useState(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState('');

  // Profile form draft overrides (falls back cleanly to user.*)
  const [profileDraft, setProfileDraft] = useState({});
  const fullName = profileDraft.fullName ?? user?.fullName ?? '';
  const companyName = profileDraft.companyName ?? user?.companyName ?? '';
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // RGPD export & delete state
  const [exporting, setExporting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadSummary = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoadingData(true);
    setDataError('');
    try {
      const data = await api.getBillingSummary();
      setSummary(data);
    } catch (err) {
      setDataError(err?.message || 'Impossible de charger les données de votre compte.');
    } finally {
      setLoadingData(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return undefined;
    let cancelled = false;
    if (checkoutParam === 'success') {
      refreshMe().catch(() => {});
    }
    api
      .getBillingSummary()
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setDataError('');
          setLoadingData(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDataError(err?.message || 'Impossible de charger les données de votre compte.');
          setLoadingData(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, checkoutParam, refreshMe]);

  const handleTabChange = (tab) => {
    navigate(`/compte?tab=${tab}`, { replace: true, scroll: false });
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await api.updateProfile({
        fullName: fullName.trim(),
        companyName: companyName.trim(),
      });
      if (res?.user) {
        updateUser(res.user);
        setProfileDraft({});
      }
      showToast({ type: 'success', message: 'Votre profil a été mis à jour.' });
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Échec de la mise à jour du profil.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    if (newPassword.length < 8) {
      setPasswordError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      showToast({
        type: 'success',
        title: 'Mot de passe modifié',
        message: 'Vos autres sessions actives ont été déconnectées par sécurité.',
      });
    } catch (err) {
      setPasswordError(err?.message || 'Impossible de modifier le mot de passe.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleExportRgpd = async () => {
    setExporting(true);
    try {
      const data = await api.exportAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vericar-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast({ type: 'success', message: 'Export RGPD téléchargé au format JSON.' });
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Impossible de générer l’export RGPD.' });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    setDeleteError('');
    if (deleteConfirm !== 'SUPPRIMER') {
      setDeleteError('Veuillez saisir exactement « SUPPRIMER » en majuscules.');
      return;
    }
    if (!deletePassword) {
      setDeleteError('Votre mot de passe actuel est requis.');
      return;
    }
    setDeletingAccount(true);
    try {
      await api.deleteAccount({ password: deletePassword, confirmation: deleteConfirm });
      clearUser();
      showToast({
        type: 'info',
        title: 'Compte supprimé',
        message: 'Toutes vos données personnelles, sessions et rapports ont été effacés.',
      });
      navigate('/', { replace: true });
    } catch (err) {
      setDeleteError(err?.message || 'Échec de la suppression du compte.');
    } finally {
      setDeletingAccount(false);
    }
  };

  if (authLoading) {
    return (
      <main className="container saas-page">
        <div className="surface-card saas-center-card" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Chargement de votre espace client…</p>
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
          <h1>Connectez-vous pour accéder à votre compte</h1>
          <p>
            Retrouvez votre solde de crédits, l’historique de vos déblocages, vos factures TVA et vos
            paramètres RGPD dans votre espace personnel.
          </p>
          <div className="guard-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openAuthModal({ mode: 'login', returnTo: '/compte' })}
            >
              Connexion
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openAuthModal({ mode: 'register', returnTo: '/compte' })}
            >
              Créer un compte
            </button>
          </div>
        </section>
      </main>
    );
  }

  const ledger = summary?.ledger || [];
  const orders = summary?.orders || [];
  const liveBalance =
    typeof summary?.creditsBalance === 'number' ? summary.creditsBalance : creditsBalance;

  return (
    <main className="container saas-page">
      {checkoutParam === 'success' && (
        <section className="checkout-banner success" role="status" style={{ marginBottom: 20 }}>
          <h2>
            <CheckCircle2 size={20} color="var(--ok)" aria-hidden="true" />
            Paiement confirmé — vos crédits sont disponibles
          </h2>
          <p>
            Merci pour votre commande. Retrouvez votre facture dans l’onglet « Commandes &amp; Factures »
            ci-dessous.
          </p>
        </section>
      )}

      <section className="surface-card account-header-card">
        <div className="account-identity">
          <span className="eyebrow">Espace Client</span>
          <h1>{user.fullName || user.email}</h1>
          <div className="account-meta-row">
            <span className="mono">{user.email}</span>
            {user.companyName && <span>· {user.companyName}</span>}
            <span>· Membre depuis le {formatDateTime(user.createdAt).slice(0, 10)}</span>
          </div>
        </div>
        <div className="account-header-actions">
          <Link to="/tarifs" className="btn btn-primary btn-sm">
            <Coins size={15} aria-hidden="true" />
            Recharger des crédits
          </Link>
          <Link to="/mes-rapports" className="btn btn-secondary btn-sm">
            <FileText size={15} aria-hidden="true" />
            Mes rapports
          </Link>
        </div>
      </section>

      <div className="tab-bar" role="tablist" aria-label="Sections de votre compte">
        <button
          id="account-tab-credits"
          type="button"
          role="tab"
          aria-selected={activeTab === 'credits'}
          className={`tab-btn ${activeTab === 'credits' ? 'active' : ''}`}
          onClick={() => handleTabChange('credits')}
        >
          <Coins size={15} aria-hidden="true" />
          Crédits &amp; Historique
          <span className="tab-count">{ledger.length}</span>
        </button>
        <button
          id="account-tab-orders"
          type="button"
          role="tab"
          aria-selected={activeTab === 'orders'}
          className={`tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => handleTabChange('orders')}
        >
          <Receipt size={15} aria-hidden="true" />
          Commandes &amp; Factures
          <span className="tab-count">{orders.length}</span>
        </button>
        <button
          id="account-tab-profile"
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => handleTabChange('profile')}
        >
          <User size={15} aria-hidden="true" />
          Profil, Sécurité &amp; RGPD
        </button>
      </div>

      {dataError && (
        <div className="form-alert error" role="alert" style={{ marginBottom: 18 }}>
          <AlertCircle size={16} aria-hidden="true" />
          <span>{dataError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={loadSummary}>
            <RefreshCw size={14} aria-hidden="true" />
            Réessayer
          </button>
        </div>
      )}

      {/* TAB 1: CREDITS & LEDGER */}
      {activeTab === 'credits' && (
        <div id="account-panel-credits" role="tabpanel">
          <div className="wallet-hero">
            <div>
              <div className="wallet-hero-eyebrow">Solde disponible</div>
              <div className="wallet-balance-row">
                <span className="wallet-balance mono" id="account-credits-balance">
                  {liveBalance}
                </span>
                <span>crédit{liveBalance > 1 ? 's' : ''} rapport Europe</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                1 crédit = 1 rapport live débloqué à vie. L’import HistoVec et les dossiers démo sont
                gratuits (0 crédit).
              </p>
            </div>
            <div className="wallet-hero-actions">
              <Link to="/tarifs" className="btn btn-primary">
                <Coins size={16} aria-hidden="true" />
                Acheter un pack
              </Link>
              <Link to="/" className="btn btn-secondary">
                Vérifier un véhicule
              </Link>
            </div>
          </div>

          <section className="surface-card" style={{ padding: 22 }}>
            <h2 style={{ margin: '0 0 14px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
              Journal des crédits
            </h2>
            {loadingData ? (
              <p className="saas-muted-note">Chargement du journal…</p>
            ) : ledger.length === 0 ? (
              <p className="saas-muted-note">Aucun mouvement de crédit enregistré pour le moment.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Opération</th>
                      <th>Détail</th>
                      <th>Mouvement</th>
                      <th>Solde après</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((entry) => (
                      <tr key={entry.id}>
                        <td className="mono">{formatDateTime(entry.createdAt)}</td>
                        <td>{REASON_LABELS[entry.reason] || entry.reason}</td>
                        <td>{entry.description || '—'}</td>
                        <td className={`mono ${entry.delta >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                        </td>
                        <td className="mono">{entry.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: ORDERS & INVOICES */}
      {activeTab === 'orders' && (
        <section id="account-panel-orders" role="tabpanel" className="surface-card" style={{ padding: 22 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
            Historique des commandes &amp; factures TVA
          </h2>
          {loadingData ? (
            <p className="saas-muted-note">Chargement des commandes…</p>
          ) : orders.length === 0 ? (
            <div className="empty-state-card">
              <p>Vous n’avez pas encore passé de commande de pack de crédits.</p>
              <Link to="/tarifs" className="btn btn-primary btn-sm">
                Découvrir nos packs
              </Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>N° Facture</th>
                    <th>Date</th>
                    <th>Pack</th>
                    <th>Mode</th>
                    <th>Montant TTC</th>
                    <th>Statut</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="mono">{order.invoiceNumber}</td>
                      <td className="mono">{formatDateTime(order.paidAt || order.createdAt)}</td>
                      <td>
                        {order.packName} ({order.credits} cr.)
                      </td>
                      <td>
                        <span className={`status-badge ${order.provider === 'stripe' ? 'ok' : 'warn'}`}>
                          {order.provider === 'stripe' ? 'Stripe' : 'Sandbox (test)'}
                        </span>
                      </td>
                      <td className="mono">{formatEuros(order.amountCents)}</td>
                      <td>
                        <span
                          className={`status-badge ${
                            order.status === 'paid'
                              ? 'ok'
                              : order.status === 'pending'
                                ? 'info'
                                : 'danger'
                          }`}
                        >
                          {order.status === 'paid'
                            ? 'Payée'
                            : order.status === 'pending'
                              ? 'En attente'
                              : order.status}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions-group">
                          <Link
                            to={`/compte/factures/${encodeURIComponent(order.id)}`}
                            className="btn btn-secondary btn-sm"
                          >
                            <FileText size={14} aria-hidden="true" />
                            Facture
                          </Link>
                          <a
                            href={api.getOrderReceiptHtmlUrl(order.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-ghost btn-sm"
                            title="Version imprimable HTML"
                          >
                            <ExternalLink size={14} aria-hidden="true" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: PROFILE, SECURITY & RGPD */}
      {activeTab === 'profile' && (
        <div id="account-panel-profile" role="tabpanel" className="saas-form-stack">
          <div className="security-grid">
            <section className="surface-card" style={{ padding: 22 }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
                Informations personnelles &amp; facturation
              </h2>
              <form className="form-stack" onSubmit={handleSaveProfile}>
                <div className="form-group">
                  <label htmlFor="profile-email" className="field-label">
                    Adresse e-mail
                  </label>
                  <input
                    id="profile-email"
                    type="email"
                    className="text-input"
                    value={user.email}
                    disabled
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="profile-fullname" className="field-label">
                    Nom complet
                  </label>
                  <input
                    id="profile-fullname"
                    type="text"
                    className="text-input"
                    value={fullName}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, fullName: e.target.value }))}
                    placeholder="Camille Martin"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="profile-company" className="field-label">
                    Société / Garage (apparaît sur les factures)
                  </label>
                  <input
                    id="profile-company"
                    type="text"
                    className="text-input"
                    value={companyName}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, companyName: e.target.value }))}
                    placeholder="Auto Sélection Lyon SAS"
                  />
                </div>
                <button
                  id="btn-save-profile"
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingProfile}
                >
                  {savingProfile && <Loader2 size={15} className="spin" aria-hidden="true" />}
                  Enregistrer les modifications
                </button>
              </form>
            </section>

            <section className="surface-card" style={{ padding: 22 }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
                Changer de mot de passe
              </h2>
              {passwordError && (
                <div className="form-alert error" role="alert" style={{ marginBottom: 12 }}>
                  <AlertCircle size={15} aria-hidden="true" />
                  <span>{passwordError}</span>
                </div>
              )}
              <form className="form-stack" onSubmit={handleChangePassword}>
                <div className="form-group">
                  <label htmlFor="pwd-current" className="field-label">
                    Mot de passe actuel
                  </label>
                  <input
                    id="pwd-current"
                    type="password"
                    className="text-input"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="pwd-new" className="field-label">
                    Nouveau mot de passe (min. 8 caractères)
                  </label>
                  <input
                    id="pwd-new"
                    type="password"
                    className="text-input"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <button
                  id="btn-change-password"
                  type="submit"
                  className="btn btn-secondary"
                  disabled={savingPassword}
                >
                  {savingPassword ? (
                    <Loader2 size={15} className="spin" aria-hidden="true" />
                  ) : (
                    <KeyRound size={15} aria-hidden="true" />
                  )}
                  Mettre à jour le mot de passe
                </button>
              </form>
            </section>
          </div>

          <section className="surface-card" style={{ padding: 22 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 17, fontFamily: 'var(--font-display)' }}>
              Portabilité &amp; Export RGPD (Art. 20)
            </h2>
            <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink-secondary)' }}>
              Téléchargez une copie complète au format JSON de votre profil, journal de crédits,
              commandes et rapports d’historique véhicule enregistrés.
            </p>
            <button
              id="btn-rgpd-export"
              type="button"
              className="btn btn-secondary"
              disabled={exporting}
              onClick={handleExportRgpd}
            >
              {exporting ? (
                <Loader2 size={15} className="spin" aria-hidden="true" />
              ) : (
                <Download size={15} aria-hidden="true" />
              )}
              Exporter mes données (JSON)
            </button>
          </section>

          <section className="danger-zone-card">
            <div className="danger-zone-head">
              <ShieldAlert size={20} color="var(--danger)" aria-hidden="true" />
              <h2>Supprimer définitivement mon compte (RGPD Art. 17)</h2>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--ink-secondary)' }}>
              Cette action est irréversible : votre compte, vos crédits restants, vos rapports et vos
              liens de partage seront immédiatement supprimés.
            </p>
            {deleteError && (
              <div className="form-alert error" role="alert" style={{ marginBottom: 12 }}>
                <AlertTriangle size={15} aria-hidden="true" />
                <span>{deleteError}</span>
              </div>
            )}
            <form className="form-stack" onSubmit={handleDeleteAccount}>
              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="delete-account-confirm" className="field-label">
                    Tapez <strong className="mono">SUPPRIMER</strong> pour confirmer
                  </label>
                  <input
                    id="delete-account-confirm"
                    type="text"
                    className="text-input mono"
                    placeholder="SUPPRIMER"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="delete-account-password" className="field-label">
                    Votre mot de passe actuel
                  </label>
                  <input
                    id="delete-account-password"
                    type="password"
                    className="text-input"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <button
                  id="btn-delete-account"
                  type="submit"
                  className="btn btn-danger-outline"
                  disabled={deletingAccount}
                >
                  {deletingAccount ? (
                    <Loader2 size={15} className="spin" aria-hidden="true" />
                  ) : (
                    <Trash2 size={15} aria-hidden="true" />
                  )}
                  Supprimer définitivement mon compte
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
