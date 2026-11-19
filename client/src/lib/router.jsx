import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext(null);

const ROUTE_META = {
  home: {
    title: 'VériCar Europe — Rapport d’historique véhicule en Europe (VIN, Plaque & HistoVec)',
    description:
      'Vérifiez l’historique d’un véhicule d’occasion en France et en Europe : décodage VIN ISO 3779, contrôle compteur, sinistres, rappels constructeur en direct et fusion HistoVec.',
  },
  verifier: {
    title: 'Pré-vérification véhicule gratuite — VériCar Europe',
    description:
      'Analysez instantanément un numéro VIN ou une plaque européenne gratuitement avant de débloquer le rapport complet.',
  },
  report: {
    title: 'Rapport d’historique véhicule — VériCar Europe',
    description:
      'Rapport complet en 9 sections : score de confiance, historique kilométrique, sinistres carrosserie, contrôles techniques et rappels sécurité.',
  },
  share: {
    title: 'Rapport véhicule partagé et vérifié — VériCar Europe',
    description:
      'Consultez ce rapport d’historique véhicule vérifié et partagé via VériCar Europe.',
  },
  pricing: {
    title: 'Tarifs & Packs de crédits — VériCar Europe',
    description:
      'Packs de 1 à 10 crédits sans abonnement pour débloquer vos rapports d’historique véhicule européens avec facture TVA incluse.',
  },
  login: {
    title: 'Connexion — VériCar Europe',
    description:
      'Connectez-vous à votre espace VériCar Europe pour accéder à vos crédits et rapports d’historique véhicule.',
  },
  register: {
    title: 'Créer un compte — VériCar Europe',
    description:
      'Créez votre compte VériCar Europe pour vérifier vos véhicules d’occasion et conserver tous vos rapports.',
  },
  account: {
    title: 'Mon compte, crédits & factures — VériCar Europe',
    description:
      'Gérez votre solde de crédits, vos commandes, vos factures, votre sécurité et vos droits RGPD.',
  },
  invoice: {
    title: 'Facture / Reçu — VériCar Europe',
    description: 'Consultez ou imprimez votre justificatif de commande VériCar Europe.',
  },
  history: {
    title: 'Mes rapports & comparateur — VériCar Europe',
    description:
      'Retrouvez tous vos rapports véhicule débloqués, partagez-les et comparez deux véhicules côte à côte.',
  },
  histovec: {
    title: 'Import HistoVec & Kit Acheteur France — VériCar Europe',
    description:
      'Importez gratuitement votre rapport officiel HistoVec pour le fusionner avec le décodage VIN et les rappels RappelConso en direct.',
  },
  registries: {
    title: 'Couverture européenne (12 registres) — VériCar Europe',
    description:
      'Découvrez les 12 registres automobiles européens couverts par VériCar Europe : France, Pays-Bas, Royaume-Uni, Belgique, Allemagne, Norvège et plus.',
  },
  admin: {
    title: 'Console d’administration — VériCar Europe',
    description: 'Tableau de bord opérateur VériCar Europe : KPIs, connecteurs et gestion des comptes.',
  },
  'mentions-legales': {
    title: 'Mentions légales — VériCar Europe',
    description: 'Informations légales, éditeur et hébergeur de la plateforme VériCar Europe (LCEN).',
  },
  cgu: {
    title: 'Conditions Générales d’Utilisation et de Vente (CGU / CGV) — VériCar Europe',
    description:
      'Conditions d’utilisation, packs de crédits, droit de rétractation (Art. L221-28) et sources de données VériCar Europe.',
  },
  confidentialite: {
    title: 'Politique de confidentialité & RGPD — VériCar Europe',
    description:
      'Protection de vos données personnelles, cookies essentiels, export et suppression de compte RGPD sur VériCar Europe.',
  },
  'not-found': {
    title: 'Page introuvable (404) — VériCar Europe',
    description: 'La page demandée est introuvable sur VériCar Europe.',
  },
};

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizePathname(rawPathname) {
  if (!rawPathname || rawPathname === '/') return '/';
  const cleaned = rawPathname.replace(/\/+$/, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function resolveLegacyHashPath(pathname, hash) {
  if (pathname === '/' && typeof hash === 'string' && hash.startsWith('#report/')) {
    const rawId = hash.slice('#report/'.length).trim();
    if (rawId) {
      return {
        pathname: `/rapport/${encodeURIComponent(safeDecode(rawId))}`,
        hash: '',
        upgradedFromHash: true,
      };
    }
  }
  return { pathname: normalizePathname(pathname), hash: hash || '', upgradedFromHash: false };
}

function readWindowLocation() {
  if (typeof window === 'undefined') {
    return { pathname: '/', search: '', hash: '' };
  }
  const resolved = resolveLegacyHashPath(window.location.pathname, window.location.hash);
  return {
    pathname: resolved.pathname,
    search: window.location.search || '',
    hash: resolved.hash,
  };
}

function scrollToHashElement(hash) {
  if (typeof document === 'undefined' || !hash || !hash.startsWith('#')) return false;
  const targetId = safeDecode(hash.slice(1));
  if (!targetId) return false;
  const el = document.getElementById(targetId);
  if (!el) return false;
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  return true;
}

// oxlint-disable-next-line react/only-export-components
export function sanitizeReturnTo(raw, fallback = '/') {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    /[\r\n]/.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

// oxlint-disable-next-line react/only-export-components
export function matchRoute(rawPathname) {
  const pathname = normalizePathname(rawPathname);

  if (pathname === '/') return { name: 'home', params: {} };
  if (pathname === '/verifier') return { name: 'verifier', params: {} };
  if (pathname === '/tarifs') return { name: 'pricing', params: {} };
  if (pathname === '/connexion') return { name: 'login', params: {} };
  if (pathname === '/inscription') return { name: 'register', params: {} };
  if (pathname === '/compte') return { name: 'account', params: {} };
  if (pathname === '/mes-rapports') return { name: 'history', params: {} };
  if (pathname === '/histovec') return { name: 'histovec', params: {} };
  if (pathname === '/couverture') return { name: 'registries', params: {} };
  if (pathname === '/admin') return { name: 'admin', params: {} };
  if (pathname === '/mentions-legales') return { name: 'mentions-legales', params: {} };
  if (pathname === '/cgu') return { name: 'cgu', params: {} };
  if (pathname === '/confidentialite') return { name: 'confidentialite', params: {} };

  const reportMatch = pathname.match(/^\/rapport\/([^/]+)$/);
  if (reportMatch) {
    return { name: 'report', params: { id: safeDecode(reportMatch[1]) } };
  }

  const shareMatch = pathname.match(/^\/r\/([^/]+)$/);
  if (shareMatch) {
    return { name: 'share', params: { shareToken: safeDecode(shareMatch[1]) } };
  }

  const invoiceMatch = pathname.match(/^\/compte\/factures\/([^/]+)$/);
  if (invoiceMatch) {
    return { name: 'invoice', params: { orderId: safeDecode(invoiceMatch[1]) } };
  }

  return { name: 'not-found', params: {} };
}

export function RouterProvider({ children }) {
  const [loc, setLoc] = useState(readWindowLocation);
  const [metaOverride, setMetaOverride] = useState(null);

  const route = useMemo(() => matchRoute(loc.pathname), [loc.pathname]);
  const searchParams = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const query = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);

  // Upgrade legacy /#report/:id URL in browser address bar on initial load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resolved = resolveLegacyHashPath(window.location.pathname, window.location.hash);
    if (resolved.upgradedFromHash) {
      window.history.replaceState(null, '', `${resolved.pathname}${window.location.search}`);
    }
  }, []);

  // Listen to browser Back/Forward (popstate) and legacy #report/ hash changes
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handlePopState = () => {
      const next = readWindowLocation();
      setLoc((prev) => {
        if (prev.pathname === next.pathname && prev.search === next.search && prev.hash === next.hash) {
          return prev;
        }
        return next;
      });
      if (next.hash && next.hash.startsWith('#sec-')) {
        window.requestAnimationFrame(() => scrollToHashElement(next.hash));
      }
    };

    const handleHashChange = () => {
      const resolved = resolveLegacyHashPath(window.location.pathname, window.location.hash);
      if (resolved.upgradedFromHash) {
        window.history.replaceState(null, '', `${resolved.pathname}${window.location.search}`);
        setMetaOverride(null);
        setLoc({ pathname: resolved.pathname, search: window.location.search || '', hash: '' });
      } else if (window.location.hash.startsWith('#sec-')) {
        setLoc((prev) => ({ ...prev, hash: window.location.hash }));
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Sync per-route document.title and <meta name="description">
  const activeMeta = metaOverride && metaOverride.pathname === loc.pathname ? metaOverride : null;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const defaults = ROUTE_META[route.name] || ROUTE_META['not-found'];
    const title = activeMeta?.title || defaults.title;
    const description = activeMeta?.description || defaults.description;

    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && description) {
      metaDesc.setAttribute('content', description);
    }
  }, [route.name, activeMeta]);

  const navigate = useCallback((to, options = {}) => {
    if (typeof window === 'undefined' || typeof to !== 'string' || !to) return;
    const { replace = false, scroll = true } = options;

    // Pure in-page anchor navigation (#sec-kilometrage, #main-content, etc.)
    if (to.startsWith('#')) {
      const targetUrl = `${window.location.pathname}${window.location.search}${to}`;
      window.history.replaceState(null, '', targetUrl);
      setLoc((prev) => ({ ...prev, hash: to }));
      scrollToHashElement(to);
      return;
    }

    const url = new URL(to, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href);
      return;
    }

    const nextPathname = normalizePathname(url.pathname);
    const nextSearch = url.search || '';
    const nextHash = url.hash || '';
    const fullPath = `${nextPathname}${nextSearch}${nextHash}`;

    const samePath =
      nextPathname === normalizePathname(window.location.pathname) &&
      nextSearch === (window.location.search || '') &&
      nextHash === (window.location.hash || '');

    if (!samePath) {
      if (replace) {
        window.history.replaceState(null, '', fullPath);
      } else {
        window.history.pushState(null, '', fullPath);
      }
    }

    setMetaOverride(null);
    setLoc({ pathname: nextPathname, search: nextSearch, hash: nextHash });

    if (nextHash) {
      window.requestAnimationFrame(() => scrollToHashElement(nextHash));
    } else if (scroll) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  const replace = useCallback(
    (to, options = {}) => navigate(to, { ...options, replace: true }),
    [navigate]
  );

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/');
    }
  }, [navigate]);

  const setPageMeta = useCallback((nextMeta) => {
    if (!nextMeta) {
      setMetaOverride(null);
      return;
    }
    const currentPath =
      typeof window !== 'undefined' ? normalizePathname(window.location.pathname) : '/';
    setMetaOverride({ ...nextMeta, pathname: currentPath });
  }, []);

  const value = useMemo(
    () => ({
      pathname: loc.pathname,
      search: loc.search,
      hash: loc.hash,
      route,
      params: route.params,
      query,
      searchParams,
      navigate,
      replace,
      goBack,
      setPageMeta,
    }),
    [loc.pathname, loc.search, loc.hash, route, query, searchParams, navigate, replace, goBack, setPageMeta]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function Link({
  to,
  replace = false,
  className = '',
  activeClassName = '',
  exact = false,
  onClick,
  children,
  ...rest
}) {
  const { pathname, navigate } = useRouter();
  const isExternal = typeof to === 'string' && /^(https?:|mailto:|tel:)/i.test(to);
  const targetPath = useMemo(() => {
    if (isExternal || typeof to !== 'string' || to.startsWith('#')) return null;
    const [pathOnly] = to.split(/[?#]/);
    return normalizePathname(pathOnly || '/');
  }, [isExternal, to]);

  const isActive =
    targetPath !== null &&
    (exact || targetPath === '/'
      ? pathname === targetPath
      : pathname === targetPath || pathname.startsWith(`${targetPath}/`));

  const combinedClassName = [className, isActive && activeClassName ? activeClassName : '']
    .filter(Boolean)
    .join(' ');

  const handleClick = (e) => {
    if (onClick) onClick(e);
    if (
      e.defaultPrevented ||
      isExternal ||
      rest.target === '_blank' ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    navigate(to, { replace });
  };

  return (
    <a
      href={to}
      className={combinedClassName || undefined}
      aria-current={rest['aria-current'] ?? (isActive ? 'page' : undefined)}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </a>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter doit être utilisé à l’intérieur de RouterProvider.');
  }
  return ctx;
}
