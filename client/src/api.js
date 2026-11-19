export const API_BASE = '/api';
const DEFAULT_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(message, status = 0, code = 'API_ERROR', details = null, data = null) {
    super(message || 'Une erreur est survenue.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'API_ERROR';
    this.details = details ?? null;
    this.data = data ?? null;
  }
}

function defaultMessageForStatus(status) {
  if (status === 400) return 'Requête invalide. Vérifiez les informations saisies.';
  if (status === 401) return 'Connexion requise pour accéder à cette ressource.';
  if (status === 402) return 'Solde de crédits insuffisant pour débloquer ce rapport.';
  if (status === 403) return 'Accès refusé.';
  if (status === 404) return 'Ressource introuvable.';
  if (status === 409) return 'Un conflit a été détecté avec une ressource existante.';
  if (status === 429) return 'Trop de tentatives. Veuillez patienter quelques instants.';
  if (status >= 500) return 'Le serveur rencontre une erreur temporaire. Veuillez réessayer.';
  return `Erreur serveur (${status})`;
}

function defaultCodeForStatus(status) {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 402) return 'INSUFFICIENT_CREDITS';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return 'SERVER_ERROR';
}

async function request(path, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    responseType = 'json',
    headers: customHeaders = {},
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const controller = new AbortController();
  let timedOut = false;
  const timerId =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const headers = {
    Accept: responseType === 'text' ? 'text/html, text/plain, */*' : 'application/json',
    ...customHeaders,
  };
  if (
    fetchOptions.body !== undefined &&
    !(fetchOptions.body instanceof FormData) &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw new ApiError('La requête a expiré. Veuillez réessayer.', 0, 'TIMEOUT');
    }
    if (err && err.name === 'AbortError') {
      throw new ApiError('Requête annulée.', 0, 'ABORTED');
    }
    throw new ApiError(
      'Impossible de joindre le serveur VériCar. Vérifiez votre connexion.',
      0,
      'NETWORK_ERROR'
    );
  } finally {
    if (timerId !== null) clearTimeout(timerId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data = null;
  if (res.status !== 204) {
    if (responseType === 'text' && res.ok && !isJson) {
      data = await res.text().catch(() => '');
    } else if (isJson) {
      data = await res.json().catch(() => null);
    } else {
      const rawText = await res.text().catch(() => '');
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = rawText ? { rawText } : null;
      }
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && (data.error || data.message)) ||
      defaultMessageForStatus(res.status);
    const code =
      (data && typeof data === 'object' && data.code) || defaultCodeForStatus(res.status);
    const details = data && typeof data === 'object' ? data.details ?? null : null;
    throw new ApiError(message, res.status, code, details, data);
  }

  return data;
}

const listOrdersReq = () => request('/billing/orders');
const enableShareReq = (id) =>
  request(`/reports/${encodeURIComponent(id)}/share`, { method: 'POST' });
const disableShareReq = (id) =>
  request(`/reports/${encodeURIComponent(id)}/share`, { method: 'DELETE' });
const adjustCreditsReq = (userId, { delta, description }) =>
  request(`/admin/users/${encodeURIComponent(userId)}/credits`, {
    method: 'POST',
    body: JSON.stringify({ delta, description }),
  });

export const api = {
  // --- System & Public Config ---
  getHealth: () => request('/health'),
  getReady: () => request('/ready'),
  getPublicConfig: () => request('/config/public'),

  // --- Auth & GDPR Account ---
  register: ({ email, password, fullName, companyName, acceptedTerms }) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, fullName, companyName, acceptedTerms }),
    }),
  login: ({ email, password }) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getSession: () => request('/auth/session'),
  getMe: () => request('/auth/me'),
  updateProfile: ({ fullName, companyName }) =>
    request('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ fullName, companyName }),
    }),
  changePassword: ({ currentPassword, newPassword }) =>
    request('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  exportAccountData: () => request('/account/export'),
  getAccountExportUrl: () => `${API_BASE}/account/export`,
  deleteAccount: ({ password, confirmation }) =>
    request('/account', {
      method: 'DELETE',
      body: JSON.stringify({ password, confirmation }),
    }),

  // --- Billing, Credit Packs, Stripe, Sandbox & Invoices ---
  getBillingPacks: () => request('/billing/packs'),
  createCheckout: ({ packId, acceptedWaiver }) =>
    request('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ packId, acceptedWaiver }),
    }),
  completeSandboxOrder: ({ orderId }) =>
    request('/billing/sandbox/complete', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    }),
  getBillingSummary: () => request('/billing/summary'),
  listOrders: listOrdersReq,
  getOrders: listOrdersReq,
  getOrder: (id) => request(`/billing/orders/${encodeURIComponent(id)}`),
  getOrderReceipt: (id, format = 'json') =>
    request(
      `/billing/orders/${encodeURIComponent(id)}/receipt?format=${encodeURIComponent(format)}`,
      {
        responseType: format === 'html' ? 'text' : 'json',
      }
    ),
  getOrderReceiptHtmlUrl: (id) =>
    `${API_BASE}/billing/orders/${encodeURIComponent(id)}/receipt?format=html`,

  // --- Vehicle Pre-Check, Reports & Sharing ---
  precheckVehicle: ({ query, country = 'AUTO' }) =>
    request('/precheck', {
      method: 'POST',
      body: JSON.stringify({ query, country }),
    }),
  async lookupVehicle({ query, country = 'AUTO', forceRefresh = false }) {
    const data = await request('/reports/lookup', {
      method: 'POST',
      body: JSON.stringify({
        query,
        country,
        ...(forceRefresh ? { forceRefresh: true } : {}),
      }),
    });
    if (data && data.report) {
      return data;
    }
    return { report: data, alreadyUnlocked: false, creditCost: 0 };
  },
  async importHistovec(payloadOrParams) {
    const body =
      typeof payloadOrParams === 'string'
        ? { payload: payloadOrParams }
        : {
            payload: payloadOrParams?.payload ?? payloadOrParams?.input ?? '',
            ...(payloadOrParams?.query ? { query: payloadOrParams.query } : {}),
          };
    const data = await request('/reports/import-histovec', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (data && data.report) {
      return data;
    }
    return { report: data, creditCost: 0 };
  },
  listReports: ({ q, limit } = {}) => {
    const qs = new URLSearchParams();
    const trimmed = typeof q === 'string' ? q.trim() : '';
    if (trimmed) qs.set('q', trimmed);
    if (limit !== undefined && limit !== null) qs.set('limit', String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/reports${suffix}`);
  },
  async getReport(id) {
    const data = await request(`/reports/${encodeURIComponent(id)}`);
    return data && data.report ? data.report : data;
  },
  deleteReport: (id) => request(`/reports/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  enableReportShare: enableShareReq,
  shareReport: enableShareReq,
  disableReportShare: disableShareReq,
  unshareReport: disableShareReq,
  getSharedReport: (token) => request(`/share/${encodeURIComponent(token)}`),

  // --- Samples, Registries & Tools ---
  async getSamples() {
    const data = (await request('/samples')) || {};
    const demos = data.demoCases || data.demoDossiers || [];
    const histovec = data.sampleHistovec || data.histovecSample || null;
    return {
      ...data,
      liveExamples: data.liveExamples || [],
      demoCases: demos,
      demoDossiers: demos,
      sampleHistovec: histovec,
      histovecSample: histovec,
    };
  },
  async getRegistries() {
    const data = (await request('/registries')) || {};
    return {
      registries: data.registries || [],
      telemetry: data.telemetry || [],
    };
  },
  generateSellerMessage: ({ vehicleLabel, plate, country } = {}) =>
    request('/tools/seller-message', {
      method: 'POST',
      body: JSON.stringify({ vehicleLabel, plate, country }),
    }),

  // --- Admin Operations ---
  getAdminOverview: () => request('/admin/overview'),
  getAdminUsers: () => request('/admin/users'),
  adjustAdminUserCredits: adjustCreditsReq,
  adjustUserCredits: adjustCreditsReq,
};
