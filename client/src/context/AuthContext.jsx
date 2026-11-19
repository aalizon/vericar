import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);

const PENDING_PRECHECK_KEY = 'vericar_pending_precheck_v1';
const PENDING_PRECHECK_TTL_MS = 30 * 60 * 1000;

const DEFAULT_PUBLIC_CONFIG = {
  appName: 'VériCar Europe',
  billingMode: 'sandbox',
  stripeConfigured: false,
  signupBonusCredits: 1,
  legal: {
    publisherName: 'VériCar Europe',
    contactEmail: 'contact@vericar-europe.app',
    hostProvider: 'Infrastructure cloud européenne',
  },
};

const CLOSED_AUTH_MODAL = {
  open: false,
  mode: 'login',
  returnTo: null,
  onSuccess: null,
  reason: null,
};

// oxlint-disable-next-line react/only-export-components
export function savePendingPrecheck({ query, country = 'AUTO', autoUnlock = false } = {}) {
  if (!query || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      PENDING_PRECHECK_KEY,
      JSON.stringify({
        query: String(query).trim(),
        country: country || 'AUTO',
        autoUnlock: Boolean(autoUnlock),
        savedAt: Date.now(),
      })
    );
  } catch {
    // Ignore storage quota or private-mode SecurityError
  }
}

// oxlint-disable-next-line react/only-export-components
export function loadPendingPrecheck() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_PRECHECK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.query) return null;
    if (parsed.savedAt && Date.now() - Number(parsed.savedAt) > PENDING_PRECHECK_TTL_MS) {
      window.sessionStorage.removeItem(PENDING_PRECHECK_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// oxlint-disable-next-line react/only-export-components
export function clearPendingPrecheck() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_PRECHECK_KEY);
  } catch {
    // Ignore
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [publicConfig, setPublicConfig] = useState(DEFAULT_PUBLIC_CONFIG);
  const [authModal, setAuthModal] = useState(CLOSED_AUTH_MODAL);

  // Hydrate current session & public SaaS config on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [meRes, cfgRes] = await Promise.allSettled([api.getSession(), api.getPublicConfig()]);
      if (cancelled) return;

      if (meRes.status === 'fulfilled' && meRes.value?.user) {
        setUser(meRes.value.user);
      } else {
        setUser(null);
      }

      if (cfgRes.status === 'fulfilled' && cfgRes.value) {
        setPublicConfig((prev) => ({
          ...prev,
          ...cfgRes.value,
          legal: {
            ...prev.legal,
            ...(cfgRes.value.legal || {}),
          },
        }));
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const res = await api.getMe();
      const nextUser = res?.user ?? null;
      setUser(nextUser);
      return nextUser;
    } catch (err) {
      if (err && err.status === 401) {
        setUser(null);
        return null;
      }
      throw err;
    }
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const res = await api.login({ email, password });
    const nextUser = res?.user ?? null;
    setUser(nextUser);
    return res?.user ? res : { user: nextUser };
  }, []);

  const register = useCallback(async ({ email, password, fullName, companyName, acceptedTerms }) => {
    const res = await api.register({ email, password, fullName, companyName, acceptedTerms });
    const nextUser = res?.user ?? null;
    setUser(nextUser);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const clearUser = useCallback(() => {
    setUser(null);
  }, []);

  const setCreditsBalance = useCallback((nextBalance) => {
    const parsed = Number(nextBalance);
    if (!Number.isFinite(parsed)) return;
    setUser((prev) => (prev ? { ...prev, creditsBalance: parsed } : prev));
  }, []);

  const updateUser = useCallback((nextUserOrUpdater) => {
    setUser(nextUserOrUpdater);
  }, []);

  // Supports both openAuthModal({ mode, returnTo, onSuccess, reason })
  // and openAuthModal('login' | 'register', { returnTo, onSuccess, reason })
  const openAuthModal = useCallback((modeOrOpts = {}, maybeOpts = {}) => {
    const opts =
      typeof modeOrOpts === 'string'
        ? { ...maybeOpts, mode: modeOrOpts }
        : modeOrOpts && typeof modeOrOpts === 'object'
          ? modeOrOpts
          : {};
    const { mode = 'login', returnTo = null, onSuccess = null, reason = null } = opts;
    setAuthModal({
      open: true,
      mode: mode === 'register' ? 'register' : 'login',
      returnTo,
      onSuccess,
      reason,
    });
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModal(CLOSED_AUTH_MODAL);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      creditsBalance: typeof user?.creditsBalance === 'number' ? user.creditsBalance : 0,
      isAdmin: user?.role === 'admin',
      loading,
      publicConfig,
      authModal,
      openAuthModal,
      closeAuthModal,
      refreshMe,
      login,
      register,
      logout,
      clearUser,
      setCreditsBalance,
      updateUser,
      savePendingPrecheck,
      loadPendingPrecheck,
      clearPendingPrecheck,
    }),
    [
      user,
      loading,
      publicConfig,
      authModal,
      openAuthModal,
      closeAuthModal,
      refreshMe,
      login,
      register,
      logout,
      clearUser,
      setCreditsBalance,
      updateUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé à l’intérieur de AuthProvider.');
  }
  return ctx;
}
