import crypto from 'node:crypto';
import { CREDIT_PACKS, getCreditPackById, getConfig } from '../config.js';
import {
  createOrder,
  attachStripeSessionToOrder,
  markOrderFailed,
  getOrderById,
  getOrderByProviderSessionId,
  listOrdersByUser,
  listCreditLedgerByUser,
  getUserCreditsBalance,
  fulfillOrderAtomic,
  findUserById,
} from '../db/repositories.js';
import { AppError } from '../middleware/security.js';

export { CREDIT_PACKS, getCreditPackById };

export function getBillingModeInfo(configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  return {
    ...cfg.billing,
    signupBonusCredits: cfg.auth.signupBonusCredits,
  };
}

export function getPacksPayload(configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  return {
    billingMode: cfg.billing.billingMode,
    stripeConfigured: cfg.billing.stripeConfigured,
    signupBonusCredits: cfg.auth.signupBonusCredits,
    currency: cfg.billing.currency,
    packs: CREDIT_PACKS,
  };
}

export async function createCheckout(
  { user, packId, acceptedWaiver, baseUrl = null },
  configOverrides = {},
  fetchImpl = globalThis.fetch
) {
  const pack = getCreditPackById(packId);
  if (!pack) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Pack de crédits inconnu.', { field: 'packId' });
  }
  if (acceptedWaiver !== true) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Vous devez accepter l’exécution immédiate et renoncer au droit de rétractation (Art. L221-28 du Code de la consommation).',
      { field: 'acceptedWaiver' }
    );
  }

  const cfg = getConfig(configOverrides);
  const { stripeConfigured, stripeSecretKey, sandboxEnabled } = cfg.billing;

  if (!stripeConfigured && !sandboxEnabled) {
    throw new AppError(
      503,
      'BILLING_UNAVAILABLE',
      'Le service de paiement est temporairement indisponible.'
    );
  }

  const provider = stripeConfigured ? 'stripe' : 'sandbox';
  const acceptedWaiverAt = new Date().toISOString();

  const order = createOrder({
    userId: user.id,
    pack,
    provider,
    acceptedWaiverAt,
    metadata: {
      customerEmail: user.email,
      packId: pack.id,
      credits: pack.credits,
    },
  });

  if (provider === 'sandbox') {
    return {
      mode: 'sandbox',
      orderId: order.id,
      invoiceNumber: order.invoiceNumber,
      pack,
      amountCents: pack.amountCents,
      currency: pack.currency,
    };
  }

  // Stripe REST Checkout Session (native fetch, zero extra SDK dependency)
  const safeBaseUrl = String(baseUrl || cfg.appUrl || `http://localhost:${cfg.port}`).replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${safeBaseUrl}/compte?checkout=success&orderId=${encodeURIComponent(order.id)}`);
  params.set('cancel_url', `${safeBaseUrl}/tarifs?checkout=cancelled&orderId=${encodeURIComponent(order.id)}`);
  params.set('client_reference_id', order.id);
  params.set('customer_email', user.email);
  params.set('line_items[0][price_data][currency]', pack.currency.toLowerCase());
  params.set('line_items[0][price_data][unit_amount]', String(pack.amountCents));
  params.set(
    'line_items[0][price_data][product_data][name]',
    `VériCar Europe — ${pack.name} (${pack.credits} crédit${pack.credits > 1 ? 's' : ''})`
  );
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[orderId]', order.id);
  params.set('metadata[invoiceNumber]', order.invoiceNumber);
  params.set('metadata[userId]', user.id);
  params.set('metadata[packId]', pack.id);
  params.set('metadata[credits]', String(pack.credits));

  let response;
  let data;
  try {
    response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `checkout_${order.id}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    data = await response.json().catch(() => null);
  } catch {
    markOrderFailed(order.id, { stripeError: 'network_error' });
    throw new AppError(502, 'STRIPE_ERROR', 'Impossible de contacter Stripe pour initialiser le paiement.');
  }

  if (!response.ok || !data || typeof data.id !== 'string' || typeof data.url !== 'string') {
    markOrderFailed(order.id, { stripeStatus: response?.status || 0 });
    throw new AppError(502, 'STRIPE_ERROR', 'Erreur lors de la création de la session de paiement Stripe.');
  }

  attachStripeSessionToOrder(order.id, data.id, { stripeCheckoutSessionId: data.id });

  return {
    mode: 'stripe',
    orderId: order.id,
    invoiceNumber: order.invoiceNumber,
    checkoutUrl: data.url,
  };
}

export function completeSandboxOrder({ userId, orderId }, configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  if (cfg.billing.stripeConfigured || !cfg.billing.sandboxEnabled) {
    throw new AppError(
      403,
      'SANDBOX_DISABLED',
      'Le mode sandbox est désactivé sur cet environnement.'
    );
  }

  if (typeof orderId !== 'string' || !orderId.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Identifiant de commande requis.', { field: 'orderId' });
  }

  try {
    const result = fulfillOrderAtomic({
      orderId: orderId.trim(),
      expectedProvider: 'sandbox',
      expectedUserId: userId,
      metadataPatch: { completedVia: 'sandbox_api' },
    });

    if (!result.found) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Commande introuvable.');
    }

    return {
      order: result.order,
      creditsBalance: result.creditsBalance,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.code === 'SANDBOX_DISABLED') {
      throw new AppError(403, 'SANDBOX_DISABLED', 'Le mode sandbox ne peut pas valider une commande Stripe.');
    }
    if (err?.code === 'ORDER_NOT_PAYABLE') {
      throw new AppError(409, 'ORDER_NOT_PENDING', 'Cette commande ne peut plus être validée.');
    }
    throw err;
  }
}

/**
 * Pure, unit-testable Stripe HMAC-SHA256 webhook signature verifier
 * with 300s timestamp replay tolerance and constant-time comparison.
 */
export function verifyStripeSignature(
  rawBody,
  sigHeader,
  webhookSecret,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000)
) {
  if (!webhookSecret || typeof webhookSecret !== 'string' || !webhookSecret.trim()) {
    throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Secret webhook Stripe non configuré.');
  }

  if (!sigHeader || typeof sigHeader !== 'string') {
    throw new AppError(400, 'INVALID_SIGNATURE', 'En-tête Stripe-Signature manquant.');
  }

  let payloadUtf8;
  if (Buffer.isBuffer(rawBody)) {
    payloadUtf8 = rawBody.toString('utf8');
  } else if (typeof rawBody === 'string') {
    payloadUtf8 = rawBody;
  } else {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Corps brut de webhook invalide.');
  }

  let timestamp = null;
  const v1Sigs = [];
  for (const token of sigHeader.split(',')) {
    const idx = token.indexOf('=');
    if (idx <= 0) continue;
    const key = token.slice(0, idx).trim();
    const val = token.slice(idx + 1).trim();
    if (key === 't' && /^\d+$/.test(val)) {
      timestamp = Number.parseInt(val, 10);
    } else if (key === 'v1' && val) {
      v1Sigs.push(val);
    }
  }

  if (timestamp === null || v1Sigs.length === 0) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Format de signature Stripe invalide.');
  }

  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Horodatage de signature Stripe expiré ou invalide.');
  }

  const expectedBuf = crypto
    .createHmac('sha256', webhookSecret.trim())
    .update(`${timestamp}.${payloadUtf8}`, 'utf8')
    .digest();

  let matched = false;
  for (const sig of v1Sigs) {
    if (!/^[0-9a-f]{64}$/i.test(sig)) continue;
    const sigBuf = Buffer.from(sig, 'hex');
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Signature Stripe invalide.');
  }

  return { timestamp, payloadUtf8 };
}

export function handleStripeWebhook(rawBody, sigHeader, configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  const { payloadUtf8 } = verifyStripeSignature(rawBody, sigHeader, cfg.billing.stripeWebhookSecret, 300);

  let event;
  try {
    event = JSON.parse(payloadUtf8);
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Payload JSON webhook Stripe invalide.');
  }

  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Événement Stripe malformé.');
  }

  const session = event.data?.object;

  if (
    (event.type === 'checkout.session.completed' && session?.payment_status !== 'unpaid') ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const orderId = session?.metadata?.orderId || session?.client_reference_id || null;
    const providerSessionId = session?.id || null;

    if (orderId || providerSessionId) {
      try {
        fulfillOrderAtomic({
          orderId,
          providerSessionId,
          expectedProvider: 'stripe',
          expectedUserId: session?.metadata?.userId || null,
          expectedAmountCents:
            session?.amount_total !== undefined && session?.amount_total !== null
              ? Number(session.amount_total)
              : null,
          metadataPatch: {
            stripeEventId: event.id || null,
            stripePaymentStatus: session?.payment_status || 'paid',
          },
        });
      } catch (err) {
        if (err?.code === 'AMOUNT_MISMATCH') {
          throw new AppError(400, 'AMOUNT_MISMATCH', 'Montant webhook Stripe incohérent.');
        }
        if (err?.code === 'PROVIDER_MISMATCH') {
          throw new AppError(400, 'VALIDATION_ERROR', 'Fournisseur de commande incohérent.');
        }
        if (err?.code !== 'ORDER_NOT_PAYABLE') {
          throw err;
        }
      }
    }
  } else if (
    event.type === 'checkout.session.expired' ||
    event.type === 'checkout.session.async_payment_failed'
  ) {
    const orderId = session?.metadata?.orderId || session?.client_reference_id || null;
    let targetOrderId = orderId;
    if (!targetOrderId && session?.id) {
      const found = getOrderByProviderSessionId(session.id);
      targetOrderId = found?.id || null;
    }
    if (targetOrderId) {
      markOrderFailed(targetOrderId, { stripeEventType: event.type });
    }
  }

  return { received: true };
}

export function getBillingSummary(userId) {
  return {
    creditsBalance: getUserCreditsBalance(userId),
    ledger: listCreditLedgerByUser(userId, 100),
    orders: listOrdersByUser(userId, 50),
  };
}

export function getUserOrders(userId) {
  return {
    orders: listOrdersByUser(userId, 50),
  };
}

export function buildReceipt(order, customerUser, configOverrides = {}) {
  const cfg = getConfig(configOverrides);
  const totalCents = Number(order.amountCents);
  const vatRate = cfg.billing.vatRate;
  const subtotalCents = Math.round(totalCents / (1 + vatRate / 100));
  const vatCents = totalCents - subtotalCents;

  return {
    invoiceNumber: order.invoiceNumber,
    orderId: order.id,
    status: order.status,
    issuedAt: order.createdAt,
    paidAt: order.paidAt,
    provider: order.provider,
    sandboxNotice:
      order.provider === 'sandbox'
        ? 'FACTURE DE DÉMONSTRATION (MODE SANDBOX) — Aucun débit bancaire réel n’a été effectué.'
        : null,
    issuer: {
      name: cfg.legal.publisherName,
      contactEmail: cfg.legal.contactEmail,
    },
    customer: {
      id: customerUser?.id || order.userId,
      email: customerUser?.email || order.metadata?.customerEmail || '',
      fullName: customerUser?.fullName || null,
      companyName: customerUser?.companyName || null,
    },
    lineItem: {
      packId: order.packId,
      description: `${order.packName} — ${order.credits} crédit${order.credits > 1 ? 's' : ''} rapport VériCar Europe`,
      credits: order.credits,
      quantity: 1,
    },
    currency: order.currency || 'EUR',
    subtotalCents,
    vatRate,
    vatCents,
    totalCents,
  };
}

export function getOrderWithReceipt(orderId, requester, configOverrides = {}) {
  const order = getOrderById(orderId);
  if (!order) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Commande introuvable.');
  }
  const isAdmin = requester?.role === 'admin';
  if (!isAdmin && order.userId !== requester?.id) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Commande introuvable.');
  }

  const owner = findUserById(order.userId);
  const receipt = buildReceipt(order, owner, configOverrides);
  return { order, receipt };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCentsEur(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDateFr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 10);
}

/**
 * Renders a standalone printable HTML invoice.
 * Strictly CSP-compliant: zero inline <script>, zero onclick handlers, every interpolated string escaped.
 */
export function renderReceiptHtml(receipt) {
  const safeInvoice = escapeHtml(receipt.invoiceNumber);
  const safeOrderId = escapeHtml(receipt.orderId);
  const safeIssuerName = escapeHtml(receipt.issuer?.name || 'VériCar Europe SAS');
  const safeIssuerEmail = escapeHtml(receipt.issuer?.contactEmail || '');
  const safeCustomerName = escapeHtml(receipt.customer?.fullName || receipt.customer?.email || 'Client');
  const safeCustomerCompany = receipt.customer?.companyName ? escapeHtml(receipt.customer.companyName) : '';
  const safeCustomerEmail = escapeHtml(receipt.customer?.email || '');
  const safeDescription = escapeHtml(receipt.lineItem?.description || 'Crédits VériCar Europe');
  const safeStatus =
    receipt.status === 'paid' ? 'Payée' : receipt.status === 'pending' ? 'En attente' : escapeHtml(receipt.status);
  const safeProvider = receipt.provider === 'stripe' ? 'Carte bancaire (Stripe)' : 'Mode Test / Sandbox';
  const safeIssuedDate = escapeHtml(formatDateFr(receipt.issuedAt));
  const safePaidDate = escapeHtml(formatDateFr(receipt.paidAt));

  const sandboxBanner = receipt.sandboxNotice
    ? `<div class="sandbox-banner" role="alert">${escapeHtml(receipt.sandboxNotice)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Facture ${safeInvoice} — ${safeIssuerName}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 32px 16px; }
    .invoice { max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 36px; }
    .sandbox-banner { background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-weight: 600; font-size: 14px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0 0 6px; }
    .muted { color: #475569; font-size: 13px; margin: 2px 0; }
    .meta { text-align: right; }
    .meta h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: 0.02em; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
    .party h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; color: #475569; border-bottom: 1px solid #cbd5e1; padding: 10px 8px; }
    td { padding: 14px 8px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .totals-row.grand { border-top: 2px solid #0f172a; margin-top: 8px; padding-top: 10px; font-size: 16px; font-weight: 700; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .invoice { border: none; border-radius: 0; padding: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <article class="invoice">
    ${sandboxBanner}
    <header class="header">
      <div>
        <p class="brand">${safeIssuerName}</p>
        <p class="muted">${safeIssuerEmail}</p>
      </div>
      <div class="meta">
        <h1>FACTURE ${safeInvoice}</h1>
        <p class="muted">Commande : ${safeOrderId}</p>
        <p class="muted">Émise le : ${safeIssuedDate}</p>
        <p class="muted">Statut : ${safeStatus} (Payée le : ${safePaidDate})</p>
      </div>
    </header>

    <section class="parties">
      <div class="party">
        <h2>Émetteur</h2>
        <p><strong>${safeIssuerName}</strong></p>
        <p class="muted">${safeIssuerEmail}</p>
      </div>
      <div class="party">
        <h2>Facturé à</h2>
        <p><strong>${safeCustomerName}</strong></p>
        ${safeCustomerCompany ? `<p class="muted">${safeCustomerCompany}</p>` : ''}
        <p class="muted">${safeCustomerEmail}</p>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>Désignation</th>
          <th class="num">Qté</th>
          <th class="num">Montant HT</th>
          <th class="num">TVA (${escapeHtml(receipt.vatRate)} %)</th>
          <th class="num">Total TTC</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${safeDescription}</td>
          <td class="num">1</td>
          <td class="num">${escapeHtml(formatCentsEur(receipt.subtotalCents))}</td>
          <td class="num">${escapeHtml(formatCentsEur(receipt.vatCents))}</td>
          <td class="num">${escapeHtml(formatCentsEur(receipt.totalCents))}</td>
        </tr>
      </tbody>
    </table>

    <section class="totals">
      <div class="totals-row"><span>Sous-total HT</span><span>${escapeHtml(formatCentsEur(receipt.subtotalCents))}</span></div>
      <div class="totals-row"><span>TVA (${escapeHtml(receipt.vatRate)} %)</span><span>${escapeHtml(formatCentsEur(receipt.vatCents))}</span></div>
      <div class="totals-row grand"><span>Total TTC</span><span>${escapeHtml(formatCentsEur(receipt.totalCents))}</span></div>
    </section>

    <footer class="footer">
      <p>Moyen de règlement : ${safeProvider}. Service numérique fourni immédiatement à la demande du client (Art. L221-28 du Code de la consommation). Utilisez la fonction d’impression de votre navigateur (Ctrl+P / Cmd+P) pour enregistrer en PDF.</p>
    </footer>
  </article>
</body>
</html>`;
}
