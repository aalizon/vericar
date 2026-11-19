import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Coins,
  CreditCard,
  FileCheck2,
  FolderClock,
  Globe2,
  LogOut,
  Menu,
  Search,
  Shield,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { Link, useRouter } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

function getUserInitials(user) {
  const source = (user?.fullName || user?.email || 'VC').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function isProtectedPath(pathname) {
  return (
    pathname === '/compte' ||
    pathname.startsWith('/compte/') ||
    pathname === '/mes-rapports' ||
    pathname === '/admin'
  );
}

export default function Header({ savedReportsCount = 0 }) {
  const { pathname, navigate } = useRouter();
  const { user, isAuthenticated, isAdmin, creditsBalance, logout, loading, openAuthModal } =
    useAuth();
  const { showToast } = useToast();

  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const mobileBtnRef = useRef(null);
  const drawerCloseRef = useRef(null);

  const closeAllMenus = useCallback(() => {
    setMenuOpen(false);
    setDrawerOpen(false);
  }, []);

  // Close account dropdown on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return undefined;

    const handleMouseDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Body scroll lock & Escape handler for mobile drawer
  useEffect(() => {
    if (!drawerOpen) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerCloseRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        mobileBtnRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [drawerOpen]);

  const handleLogout = async () => {
    closeAllMenus();
    try {
      await logout();
    } catch {
      // AuthContext clears user in finally
    }
    showToast({ type: 'info', message: 'Vous êtes déconnecté.' });
    if (isProtectedPath(pathname)) {
      navigate('/', { replace: true });
    }
  };

  const isVerifyActive =
    pathname === '/' || pathname === '/verifier' || pathname.startsWith('/rapport/');

  const navItems = [
    {
      id: 'nav-home',
      to: '/',
      label: 'Vérifier',
      icon: Search,
      active: isVerifyActive,
    },
    {
      id: 'nav-pricing',
      to: '/tarifs',
      label: 'Tarifs',
      icon: CreditCard,
      active: pathname === '/tarifs',
    },
    {
      id: 'nav-histovec',
      to: '/histovec',
      label: 'Import HistoVec',
      icon: FileCheck2,
      active: pathname === '/histovec',
    },
    {
      id: 'nav-registries',
      to: '/couverture',
      label: 'Couverture UE',
      icon: Globe2,
      active: pathname === '/couverture',
    },
  ];

  if (isAuthenticated) {
    navItems.push({
      id: 'nav-history',
      to: '/mes-rapports',
      label: 'Mes rapports',
      icon: FolderClock,
      active: pathname === '/mes-rapports',
      count: savedReportsCount,
    });
  }

  const displayName = user?.fullName?.trim() || user?.email || 'Mon compte';
  const initials = getUserInitials(user);

  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <Link
            to="/"
            id="brand-home-link"
            className="brand-button"
            aria-current={pathname === '/' ? 'page' : undefined}
            onClick={closeAllMenus}
          >
            <span className="brand-mark" aria-hidden="true">
              <ShieldCheck size={19} strokeWidth={2.3} />
            </span>
            <span className="brand-name">VériCar</span>
            <span className="brand-tag">Europe</span>
          </Link>

          <nav className="main-nav header-desktop-nav" aria-label="Navigation principale">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  id={item.id}
                  to={item.to}
                  className={`nav-item ${item.active ? 'active' : ''}`}
                  aria-current={item.active ? 'page' : undefined}
                  onClick={closeAllMenus}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{item.label}</span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className="nav-count">{item.count}</span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="header-desktop-actions">
            {!loading && !isAuthenticated && (
              <>
                <button
                  id="header-login-btn"
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => openAuthModal({ mode: 'login' })}
                >
                  Connexion
                </button>
                <button
                  id="header-register-btn"
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => openAuthModal({ mode: 'register' })}
                >
                  Créer un compte
                </button>
              </>
            )}

            {isAuthenticated && (
              <>
                <Link
                  to="/tarifs"
                  id="header-credits-pill"
                  className={`credit-pill ${creditsBalance === 0 ? 'low' : ''}`}
                  title="Consulter les packs de crédits"
                  aria-current={undefined}
                  onClick={closeAllMenus}
                >
                  <Coins size={15} aria-hidden="true" />
                  <span className="mono">{creditsBalance}</span>
                  <span>{creditsBalance > 1 ? 'crédits' : 'crédit'}</span>
                </Link>

                {isAdmin && (
                  <Link
                    to="/admin"
                    id="header-admin-link"
                    className="admin-badge"
                    aria-current={pathname === '/admin' ? 'page' : undefined}
                    onClick={closeAllMenus}
                  >
                    <Shield size={13} aria-hidden="true" />
                    <span>Admin</span>
                  </Link>
                )}

                <div className="account-menu" ref={menuRef}>
                  <button
                    ref={triggerRef}
                    id="header-account-trigger"
                    type="button"
                    className="account-trigger"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((prev) => !prev)}
                  >
                    <span className="account-avatar" aria-hidden="true">
                      {initials}
                    </span>
                    <span className="account-label">{displayName}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>

                  {menuOpen && (
                    <div
                      className="account-dropdown"
                      role="menu"
                      aria-label="Menu de votre compte"
                    >
                      <div className="account-dropdown-head">
                        <div className="account-dropdown-name">{displayName}</div>
                        <div className="account-dropdown-email mono">{user?.email}</div>
                      </div>

                      <Link
                        to="/compte"
                        role="menuitem"
                        className="account-dropdown-item"
                        aria-current={undefined}
                        onClick={closeAllMenus}
                      >
                        <User size={15} aria-hidden="true" />
                        Mon compte &amp; factures
                      </Link>
                      <Link
                        to="/mes-rapports"
                        role="menuitem"
                        className="account-dropdown-item"
                        aria-current={undefined}
                        onClick={closeAllMenus}
                      >
                        <FolderClock size={15} aria-hidden="true" />
                        Mes rapports
                      </Link>
                      <Link
                        to="/tarifs"
                        role="menuitem"
                        className="account-dropdown-item"
                        aria-current={undefined}
                        onClick={closeAllMenus}
                      >
                        <Coins size={15} aria-hidden="true" />
                        Acheter des crédits
                      </Link>

                      {isAdmin && (
                        <Link
                          to="/admin"
                          role="menuitem"
                          className="account-dropdown-item"
                          aria-current={undefined}
                          onClick={closeAllMenus}
                        >
                          <Shield size={15} aria-hidden="true" />
                          Console Admin
                        </Link>
                      )}

                      <div className="account-dropdown-divider" role="separator" />

                      <button
                        id="header-logout-btn"
                        type="button"
                        role="menuitem"
                        className="account-dropdown-item danger"
                        onClick={handleLogout}
                      >
                        <LogOut size={15} aria-hidden="true" />
                        Déconnexion
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="header-mobile-controls">
            {isAuthenticated && (
              <Link
                to="/tarifs"
                className={`credit-pill ${creditsBalance === 0 ? 'low' : ''}`}
                aria-label={`${creditsBalance} crédit${creditsBalance > 1 ? 's' : ''} disponible${creditsBalance > 1 ? 's' : ''}`}
                aria-current={undefined}
                onClick={closeAllMenus}
              >
                <Coins size={14} aria-hidden="true" />
                <span className="mono">{creditsBalance}</span>
              </Link>
            )}

            <button
              ref={mobileBtnRef}
              id="header-mobile-menu-btn"
              type="button"
              className="hamburger-btn"
              aria-label="Ouvrir le menu de navigation"
              aria-expanded={drawerOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setDrawerOpen((prev) => !prev)}
            >
              {drawerOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      {drawerOpen && (
        <>
          <div
            className="mobile-drawer-backdrop"
            aria-hidden="true"
            onClick={() => {
              setDrawerOpen(false);
              mobileBtnRef.current?.focus();
            }}
          />
          <div
            id="mobile-nav-drawer"
            className="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navigation"
          >
            <div className="mobile-drawer-head">
              <span className="brand-name">VériCar Europe</span>
              <button
                ref={drawerCloseRef}
                type="button"
                className="modal-close"
                aria-label="Fermer le menu"
                onClick={() => {
                  setDrawerOpen(false);
                  mobileBtnRef.current?.focus();
                }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <nav className="mobile-drawer-nav" aria-label="Navigation mobile">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={`mobile-${item.id}`}
                    to={item.to}
                    className="mobile-drawer-link"
                    aria-current={item.active ? 'page' : undefined}
                    onClick={closeAllMenus}
                  >
                    <span className="mobile-drawer-link-left">
                      <Icon size={17} aria-hidden="true" />
                      <span>{item.label}</span>
                    </span>
                    {typeof item.count === 'number' && item.count > 0 && (
                      <span className="nav-count">{item.count}</span>
                    )}
                  </Link>
                );
              })}

              {isAuthenticated && (
                <Link
                  to="/compte"
                  className="mobile-drawer-link"
                  aria-current={pathname === '/compte' ? 'page' : undefined}
                  onClick={closeAllMenus}
                >
                  <span className="mobile-drawer-link-left">
                    <User size={17} aria-hidden="true" />
                    <span>Mon compte &amp; factures</span>
                  </span>
                </Link>
              )}

              {isAdmin && (
                <Link
                  to="/admin"
                  className="mobile-drawer-link"
                  aria-current={pathname === '/admin' ? 'page' : undefined}
                  onClick={closeAllMenus}
                >
                  <span className="mobile-drawer-link-left">
                    <Shield size={17} aria-hidden="true" />
                    <span>Console Administration</span>
                  </span>
                </Link>
              )}
            </nav>

            <div className="mobile-drawer-section">
              {isAuthenticated ? (
                <>
                  <div className="mobile-drawer-user">
                    <span className="account-avatar" aria-hidden="true">
                      {initials}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="account-dropdown-name">{displayName}</div>
                      <div className="account-dropdown-email mono">{user?.email}</div>
                    </div>
                  </div>
                  <div className="mobile-drawer-actions">
                    <Link
                      to="/tarifs"
                      className="btn btn-primary btn-block btn-sm"
                      aria-current={undefined}
                      onClick={closeAllMenus}
                    >
                      <Coins size={15} aria-hidden="true" />
                      Solde : {creditsBalance} crédit{creditsBalance > 1 ? 's' : ''} — Recharger
                    </Link>
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-block btn-sm"
                      onClick={handleLogout}
                    >
                      <LogOut size={15} aria-hidden="true" />
                      Déconnexion
                    </button>
                  </div>
                </>
              ) : (
                <div className="mobile-drawer-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() => {
                      closeAllMenus();
                      openAuthModal({ mode: 'register' });
                    }}
                  >
                    Créer un compte
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={() => {
                      closeAllMenus();
                      openAuthModal({ mode: 'login' });
                    }}
                  >
                    Connexion
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
