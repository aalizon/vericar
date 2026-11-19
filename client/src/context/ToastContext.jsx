import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);
const MAX_TOASTS = 4;

function normalizeToastType(rawType) {
  if (rawType === 'warn' || rawType === 'warning') return 'warning';
  if (rawType === 'success' || rawType === 'error' || rawType === 'info') return rawType;
  return 'info';
}

function ToastIcon({ type }) {
  if (type === 'success') return <CheckCircle2 size={18} aria-hidden="true" />;
  if (type === 'warning') return <AlertTriangle size={18} aria-hidden="true" />;
  if (type === 'error') return <AlertCircle size={18} aria-hidden="true" />;
  return <Info size={18} aria-hidden="true" />;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounterRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const addToast = useCallback(
    ({ type = 'info', title = '', message = '', duration } = {}) => {
      if (!message && !title) return null;
      const normalizedType = normalizeToastType(type);
      idCounterRef.current += 1;
      const id = `toast-${idCounterRef.current}`;
      const resolvedDuration = duration ?? (normalizedType === 'error' ? 6000 : 4500);

      setToasts((prev) => {
        const next = [...prev, { id, type: normalizedType, title, message }];
        if (next.length > MAX_TOASTS) {
          const dropped = next.shift();
          if (dropped) {
            const droppedTimer = timersRef.current.get(dropped.id);
            if (droppedTimer) {
              clearTimeout(droppedTimer);
              timersRef.current.delete(dropped.id);
            }
          }
        }
        return next;
      });

      if (resolvedDuration > 0) {
        const timer = setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((item) => item.id !== id));
        }, resolvedDuration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    []
  );

  // Supports both showToast({ type, title, message, duration }) and showToast(message, type)
  const showToast = useCallback(
    (msgOrOpts, typeArg = 'info', extraOpts = {}) => {
      if (msgOrOpts && typeof msgOrOpts === 'object') {
        return addToast(msgOrOpts);
      }
      return addToast({
        ...extraOpts,
        type: normalizeToastType(typeArg),
        message: typeof msgOrOpts === 'string' ? msgOrOpts : '',
      });
    },
    [addToast]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const success = useCallback(
    (message, opts = {}) => addToast({ ...opts, type: 'success', message }),
    [addToast]
  );
  const info = useCallback(
    (message, opts = {}) => addToast({ ...opts, type: 'info', message }),
    [addToast]
  );
  const warning = useCallback(
    (message, opts = {}) => addToast({ ...opts, type: 'warning', message }),
    [addToast]
  );
  const error = useCallback(
    (message, opts = {}) => addToast({ ...opts, type: 'error', message }),
    [addToast]
  );

  const value = useMemo(
    () => ({
      toasts,
      addToast,
      showToast,
      success,
      info,
      warning,
      error,
      dismiss,
      dismissToast: dismiss,
      clearAll,
    }),
    [toasts, addToast, showToast, success, info, warning, error, dismiss, clearAll]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toast-stack no-print"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`toast-item toast-${item.type}`}
            role={item.type === 'error' ? 'alert' : 'status'}
          >
            <span className="toast-icon">
              <ToastIcon type={item.type} />
            </span>
            <div className="toast-body">
              {item.title && <div className="toast-title">{item.title}</div>}
              {item.message && <div className="toast-message">{item.message}</div>}
            </div>
            <button
              type="button"
              className="toast-close"
              aria-label="Fermer la notification"
              onClick={() => dismiss(item.id)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast doit être utilisé à l’intérieur de ToastProvider.');
  }
  return ctx;
}
