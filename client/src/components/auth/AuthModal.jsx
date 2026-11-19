import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Gift,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Link, sanitizeReturnTo, useRouter } from '../../lib/router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function getPasswordStrength(password) {
  if (!password) {
    return { score: 0, label: 'Minimum 8 caractères requis', color: 'var(--ink-muted)', width: '0%' };
  }
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (password.length < 8) {
    return { score: 1, label: 'Trop court (8 car. min.)', color: 'var(--danger)', width: '25%' };
  }
  if (score <= 2) {
    return { score: 2, label: 'Mot de passe correct', color: 'var(--warn)', width: '55%' };
  }
  if (score <= 3) {
    return { score: 3, label: 'Mot de passe solide', color: 'var(--accent)', width: '78%' };
  }
  return { score: 4, label: 'Mot de passe très robuste', color: 'var(--ok)', width: '100%' };
}

function mapAuthError(err) {
  if (!err) return 'Une erreur est survenue. Veuillez réessayer.';
  if (err.status === 401 || err.code === 'INVALID_CREDENTIALS') {
    return 'Adresse e-mail ou mot de passe incorrect.';
  }
  if (err.status === 409 || err.code === 'EMAIL_EXISTS') {
    return 'Un compte existe déjà avec cette adresse e-mail. Essayez de vous connecter.';
  }
  if (err.status === 429 || err.code === 'RATE_LIMITED') {
    return 'Trop de tentatives récentes. Veuillez patienter quelques minutes avant de réessayer.';
  }
  if (err.status === 400 || err.code === 'VALIDATION_ERROR') {
    return err.message || 'Veuillez vérifier les informations saisies.';
  }
  return err.message || 'Une erreur est survenue. Veuillez réessayer.';
}

export function AuthForm({
  initialMode = 'login',
  reason = '',
  onSuccess,
  onModeChange,
  autoFocusEmail = false,
  idPrefix = 'auth',
}) {
  const { login, register, publicConfig } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState(initialMode === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef(null);

  useEffect(() => {
    if (autoFocusEmail) {
      emailRef.current?.focus();
    }
  }, [autoFocusEmail]);

  const bonusCredits = Number(publicConfig?.signupBonusCredits ?? 0);
  const pwdStrength = getPasswordStrength(password);

  const handleSwitchMode = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setFieldErrors({});
    setServerError('');
    onModeChange?.(nextMode);
  };

  const validate = () => {
    const errors = {};
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      errors.email = 'Veuillez saisir votre adresse e-mail.';
    } else if (!EMAIL_RE.test(cleanEmail)) {
      errors.email = 'Veuillez saisir une adresse e-mail valide.';
    }

    if (!password) {
      errors.password = 'Veuillez saisir votre mot de passe.';
    } else if (password.length < 8) {
      errors.password = 'Le mot de passe doit contenir au moins 8 caractères.';
    }

    if (mode === 'register' && !acceptedTerms) {
      errors.terms =
        'Vous devez accepter les CGU / CGV et la Politique de confidentialité pour créer un compte.';
    }
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const result = await login({ email: email.trim(), password });
        showToast({ type: 'success', message: 'Connexion réussie. Bon retour sur VériCar Europe !' });
        onSuccess?.(result);
      } else {
        const result = await register({
          email: email.trim(),
          password,
          fullName: fullName.trim() || undefined,
          companyName: companyName.trim() || undefined,
          acceptedTerms: true,
        });
        const granted = Number(result?.signupBonusCredits ?? bonusCredits);
        showToast({
          type: 'success',
          title: 'Compte créé avec succès',
          message:
            granted > 0
              ? `${granted} crédit${granted > 1 ? 's' : ''} de bienvenue ajouté${granted > 1 ? 's' : ''} à votre solde.`
              : 'Bienvenue sur VériCar Europe.',
        });
        onSuccess?.(result);
      }
    } catch (err) {
      setServerError(mapAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="auth-tabs" role="tablist" aria-label="Mode d’authentification">
        <button
          id={`${idPrefix}-tab-login`}
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
          onClick={() => handleSwitchMode('login')}
        >
          Connexion
        </button>
        <button
          id={`${idPrefix}-tab-register`}
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
          onClick={() => handleSwitchMode('register')}
        >
          Créer un compte
        </button>
      </div>

      {reason && (
        <div className="auth-reason-banner" role="status">
          <Info size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{reason}</span>
        </div>
      )}

      {mode === 'register' && bonusCredits > 0 && (
        <div className="auth-bonus-callout" role="note">
          <Gift size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            Offre de bienvenue : {bonusCredits} crédit{bonusCredits > 1 ? 's' : ''} offert
            {bonusCredits > 1 ? 's' : ''} dès l’inscription.
          </span>
        </div>
      )}

      {serverError && (
        <div className="form-alert error" role="alert" style={{ marginBottom: 14 }}>
          <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{serverError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form-stack" noValidate>
        <div className="form-group">
          <label htmlFor={`${idPrefix}-email`} className="field-label">
            Adresse e-mail
          </label>
          <input
            ref={emailRef}
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            className="text-input"
            autoComplete="email"
            placeholder="prenom.nom@exemple.fr"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
            }}
            aria-invalid={Boolean(fieldErrors.email)}
            required
          />
          {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
        </div>

        <div className="form-group">
          <label htmlFor={`${idPrefix}-password`} className="field-label">
            Mot de passe
          </label>
          <div className="input-with-action">
            <input
              id={`${idPrefix}-password`}
              name="password"
              type={showPassword ? 'text' : 'password'}
              className="text-input"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Minimum 8 caractères"
              minLength={8}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: '' }));
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              required
            />
            <button
              type="button"
              className="input-action-btn"
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
          {fieldErrors.password && <span className="field-error">{fieldErrors.password}</span>}

          {mode === 'register' && (
            <div className="password-meter">
              <div className="password-meter-bar" aria-hidden="true">
                <div
                  className="password-meter-fill"
                  style={{ width: pwdStrength.width, backgroundColor: pwdStrength.color }}
                />
              </div>
              <div className="password-meter-label">
                <span>{pwdStrength.label}</span>
                <span>Min. 8 caractères</span>
              </div>
            </div>
          )}
        </div>

        {mode === 'register' && (
          <>
            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor={`${idPrefix}-fullname`} className="field-label">
                  Nom complet <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>(optionnel)</span>
                </label>
                <input
                  id={`${idPrefix}-fullname`}
                  name="fullName"
                  type="text"
                  className="text-input"
                  autoComplete="name"
                  placeholder="Camille Martin"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor={`${idPrefix}-company`} className="field-label">
                  Société / garage{' '}
                  <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>(optionnel)</span>
                </label>
                <input
                  id={`${idPrefix}-company`}
                  name="companyName"
                  type="text"
                  className="text-input"
                  autoComplete="organization"
                  placeholder="Auto Sélection Lyon"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-row" htmlFor={`${idPrefix}-terms`}>
                <input
                  id={`${idPrefix}-terms`}
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked);
                    if (fieldErrors.terms) setFieldErrors((prev) => ({ ...prev, terms: '' }));
                  }}
                />
                <span>
                  J’accepte les{' '}
                  <Link to="/cgu" target="_blank" rel="noreferrer" aria-current={undefined}>
                    CGU / CGV
                  </Link>{' '}
                  et la{' '}
                  <Link
                    to="/confidentialite"
                    target="_blank"
                    rel="noreferrer"
                    aria-current={undefined}
                  >
                    Politique de confidentialité
                  </Link>
                  .
                </span>
              </label>
              {fieldErrors.terms && <span className="field-error">{fieldErrors.terms}</span>}
            </div>
          </>
        )}

        <button
          id={`${idPrefix}-submit-btn`}
          type="submit"
          className="btn btn-primary btn-block"
          disabled={submitting}
          style={{ marginTop: 4 }}
        >
          {submitting ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <Lock size={15} aria-hidden="true" />
          )}
          {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
        </button>
      </form>
    </div>
  );
}

export default function AuthModal() {
  const { authModal, closeAuthModal } = useAuth();
  const { navigate } = useRouter();
  const dialogRef = useRef(null);

  const isOpen = Boolean(authModal?.open);

  // Body scroll lock, focus trap, Escape close & focus restoration
  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAuthModal();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try {
          previouslyFocused.focus();
        } catch {
          // Ignore focus restore error
        }
      }
    };
  }, [isOpen, closeAuthModal]);

  if (!isOpen) return null;

  const handleSuccess = (result) => {
    const { onSuccess, returnTo } = authModal;
    closeAuthModal();
    if (typeof onSuccess === 'function') {
      onSuccess(result);
      return;
    }
    if (returnTo) {
      const safeTarget = sanitizeReturnTo(returnTo, '');
      if (safeTarget) {
        navigate(safeTarget);
      }
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAuthModal();
      }}
    >
      <div
        ref={dialogRef}
        id="auth-modal-dialog"
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="brand-mark" aria-hidden="true" style={{ width: 28, height: 28 }}>
              <ShieldCheck size={16} strokeWidth={2.3} />
            </span>
            <h2 id="auth-modal-title" className="modal-title">
              Espace client VériCar Europe
            </h2>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="Fermer la fenêtre de connexion"
            onClick={closeAuthModal}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">
          <AuthForm
            key={`${authModal.mode}:${authModal.reason || ''}`}
            initialMode={authModal.mode}
            reason={authModal.reason || ''}
            onSuccess={handleSuccess}
            autoFocusEmail
            idPrefix="auth-modal"
          />
        </div>
      </div>
    </div>
  );
}
