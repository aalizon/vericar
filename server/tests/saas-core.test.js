import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

import { createApp } from '../src/index.js';
import { closeDb, resetDbForTests } from '../src/db/index.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimit.js';
import { verifyStripeSignature } from '../src/services/billingService.js';
import { SAMPLE_HISTOVEC_PAYLOAD } from '../src/providers/histovecParser.js';

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockFetch({ failUpstream = false } = {}) {
  return async (url, init = {}) => {
    const s = String(url);

    // Mock Stripe Checkout Session creation
    if (s === 'https://api.stripe.com/v1/checkout/sessions' && init.method === 'POST') {
      return jsonRes({
        id: `cs_test_${crypto.randomBytes(6).toString('hex')}`,
        url: 'https://checkout.stripe.com/c/pay/cs_test_mock_session',
      });
    }

    if (failUpstream) {
      return jsonRes({ error: 'Upstream down' }, 503);
    }

    if (s.includes('opendata.rdw.nl/resource/m9d7-ebf2.json')) {
      if (s.includes('HSF60S')) {
        return jsonRes([
          {
            kenteken: 'HSF60S',
            merk: 'PEUGEOT',
            handelsbenaming: '308',
            inrichting: 'hatchback',
            eerste_kleur: 'BLAUW',
            datum_eerste_toelating: '20230510',
            datum_eerste_tenaamstelling_in_nederland: '20230510',
            catalogusprijs: '36400',
            tellerstandoordeel: 'Logisch',
            wam_verzekerd: 'Ja',
            export_indicator: 'Nee',
            taxi_indicator: 'Nee',
            wacht_op_keuren: 'Nee',
            openstaande_terugroepactie_indicator: 'Nee',
          },
        ]);
      }
      if (s.includes('21STVK')) {
        return jsonRes([
          {
            kenteken: '21STVK',
            merk: 'VOLKSWAGEN',
            handelsbenaming: 'CADDY',
            datum_eerste_toelating: '20160415',
            tellerstandoordeel: 'Onlogisch',
            wam_verzekerd: 'Ja',
            export_indicator: 'Nee',
            taxi_indicator: 'Nee',
            wacht_op_keuren: 'Nee',
            openstaande_terugroepactie_indicator: 'Nee',
          },
        ]);
      }
      return jsonResponseEmpty();
    }
    if (s.includes('opendata.rdw.nl/resource/')) {
      return jsonRes([]);
    }
    if (s.includes('vpic.nhtsa.dot.gov')) {
      return jsonRes({
        Results: [{ Make: 'BMW', Model: '328i', ModelYear: '2012', FuelTypePrimary: 'Gasoline', EngineHP: '240' }],
      });
    }
    if (s.includes('rappelconso-v2-gtin-espaces') || s.includes('api.nhtsa.gov/recalls')) {
      return jsonRes({ results: [] });
    }
    return jsonRes({}, 404);
  };
}

function jsonResponseEmpty() {
  return jsonRes([]);
}

function signStripePayload(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

class CookieClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  captureCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const first = raw.split(';')[0];
      const idx = first.indexOf('=');
      if (idx <= 0) continue;
      const name = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      if (!value || /Max-Age=0/i.test(raw)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  async req(method, pathname, { body = undefined, headers = {}, rawBody = undefined } = {}) {
    const h = { ...headers };
    const cookie = this.cookieHeader();
    if (cookie) h.Cookie = cookie;
    let payload;
    if (rawBody !== undefined) {
      payload = rawBody;
    } else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: h,
      body: payload,
    });
    this.captureCookies(res);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let json = null;
    if (contentType.includes('application/json') && text) {
      json = JSON.parse(text);
    }
    return { status: res.status, headers: res.headers, text, json };
  }
}

async function startTestServer({ configOverrides = {}, rateLimitOverrides = {}, fetchImpl = createMockFetch() } = {}) {
  resetAllRateLimiters();
  resetDbForTests(':memory:');
  const app = createApp({
    configOverrides: {
      nodeEnv: 'test',
      logLevel: 'silent',
      dbPath: ':memory:',
      signupBonusCredits: 1,
      adminEmail: 'admin@vericar-test.eu',
      adminPassword: 'AdminPassword!123',
      ...configOverrides,
    },
    rateLimitOverrides: {
      general: { max: 500, windowMs: 60_000 },
      auth: { max: 100, windowMs: 60_000 },
      billing: { max: 100, windowMs: 60_000 },
      lookup: { max: 100, windowMs: 60_000 },
      precheck: { max: 100, windowMs: 60_000 },
      ...rateLimitOverrides,
    },
    fetchImpl,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe('SaaS Core API — Security, Auth, Credits, Billing, Reports, Sharing, Admin & RGPD', () => {
  let srv;
  let alice;
  let bob;
  let admin;
  let guest;

  before(async () => {
    srv = await startTestServer();
    alice = new CookieClient(srv.baseUrl);
    bob = new CookieClient(srv.baseUrl);
    admin = new CookieClient(srv.baseUrl);
    guest = new CookieClient(srv.baseUrl);
  });

  after(async () => {
    await srv.close();
    closeDb();
  });

  it('serves health, readiness, public config, security headers, and strict JSON 404 on unknown /api/*', async () => {
    const health = await guest.req('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.equal(health.headers.get('x-powered-by'), null);

    const ready = await guest.req('GET', '/api/ready');
    assert.equal(ready.status, 200);
    assert.equal(ready.json.db, 'ok');

    const cfg = await guest.req('GET', '/api/config/public');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.billingMode, 'sandbox');
    assert.equal(cfg.json.signupBonusCredits, 1);
    assert.ok(cfg.json.legal.publisherName);

    const missing = await guest.req('GET', '/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, 'NOT_FOUND');

    // Public registries must never expose .env key names
    const regs = await guest.req('GET', '/api/registries');
    assert.equal(regs.status, 200);
    assert.equal(regs.json.registries.length, 12);
    assert.equal(JSON.stringify(regs.json).includes('UK_MOT_API_KEY'), false);
  });

  it('registers users with welcome bonus credit, HttpOnly cookie, duplicate 409, login/logout, profile & password change', async () => {
    // Reject registration without terms
    const badTerms = await alice.req('POST', '/api/auth/register', {
      body: { email: 'alice@example.com', password: 'Password123!', acceptedTerms: false },
    });
    assert.equal(badTerms.status, 400);

    // Valid registration -> 201 + 1 welcome credit + vericar_session cookie
    const reg = await alice.req('POST', '/api/auth/register', {
      body: {
        email: 'Alice@Example.com',
        password: 'Password123!',
        fullName: 'Alice Martin',
        companyName: 'Garage Martin',
        acceptedTerms: true,
      },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.user.email, 'alice@example.com');
    assert.equal(reg.json.user.creditsBalance, 1);
    assert.equal(reg.json.signupBonusCredits, 1);
    assert.equal(reg.json.user.passwordHash, undefined);
    assert.ok(alice.cookies.has('vericar_session'));

    // Duplicate email -> 409
    const dup = await bob.req('POST', '/api/auth/register', {
      body: { email: 'alice@example.com', password: 'Password123!', acceptedTerms: true },
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, 'EMAIL_EXISTS');

    // Register Bob
    const regBob = await bob.req('POST', '/api/auth/register', {
      body: { email: 'bob@example.com', password: 'BobPassword123!', fullName: 'Bob Dupont', acceptedTerms: true },
    });
    assert.equal(regBob.status, 201);

    // CSRF origin mismatch -> 403
    const csrfBlocked = await alice.req('PATCH', '/api/auth/profile', {
      headers: { Origin: 'https://evil-attacker.example' },
      body: { fullName: 'Hacked' },
    });
    assert.equal(csrfBlocked.status, 403);
    assert.equal(csrfBlocked.json.code, 'CSRF_ORIGIN_MISMATCH');

    // Profile update
    const patch = await alice.req('PATCH', '/api/auth/profile', {
      body: { fullName: 'Alice M. Pro', companyName: 'AutoSelect Lyon' },
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.json.user.fullName, 'Alice M. Pro');

    // Password change revokes other sessions while keeping current session valid
    const aliceOtherDevice = new CookieClient(srv.baseUrl);
    const secondLogin = await aliceOtherDevice.req('POST', '/api/auth/login', {
      body: { email: 'alice@example.com', password: 'Password123!' },
    });
    assert.equal(secondLogin.status, 200);

    const chg = await alice.req('POST', '/api/auth/password', {
      body: { currentPassword: 'Password123!', newPassword: 'NewPassword456!' },
    });
    assert.equal(chg.status, 200);

    const otherMe = await aliceOtherDevice.req('GET', '/api/auth/me');
    assert.equal(otherMe.status, 401);

    const currentMe = await alice.req('GET', '/api/auth/me');
    assert.equal(currentMe.status, 200);
    assert.equal(currentMe.json.user.email, 'alice@example.com');
  });

  it('enforces 2-step Pre-Check, 0-credit demo, 401 guest / 1-credit debit / idempotent reopen / 402 insufficient credits', async () => {
    // 1. Free precheck for guest (0 credits)
    const preGuest = await guest.req('POST', '/api/precheck', {
      body: { query: 'HSF60S', country: 'NL' },
    });
    assert.equal(preGuest.status, 200);
    assert.equal(preGuest.json.requiresCredit, true);
    assert.equal(preGuest.json.creditCost, 1);

    // 2. Guest demo lookup -> 0 credits, ephemeral=true
    const demoGuest = await guest.req('POST', '/api/reports/lookup', {
      body: { query: 'WAUZZZF48KA042918', country: 'AUTO' },
    });
    assert.equal(demoGuest.status, 201);
    assert.equal(demoGuest.json.creditCost, 0);
    assert.equal(demoGuest.json.ephemeral, true);

    // 3. Guest live lookup -> 401 AUTH_REQUIRED
    const liveGuest = await guest.req('POST', '/api/reports/lookup', {
      body: { query: 'HSF60S', country: 'NL' },
    });
    assert.equal(liveGuest.status, 401);
    assert.equal(liveGuest.json.code, 'AUTH_REQUIRED');

    // 4. Alice unlocks live NL report HSF60S -> consumes her 1 welcome credit (balance 1 -> 0)
    const unlock1 = await alice.req('POST', '/api/reports/lookup', {
      body: { query: 'HSF60S', country: 'NL' },
    });
    assert.equal(unlock1.status, 201);
    assert.equal(unlock1.json.creditCost, 1);
    assert.equal(unlock1.json.alreadyUnlocked, false);
    assert.equal(unlock1.json.creditsBalance, 0);
    const aliceReportId = unlock1.json.report.id;

    // 5. Alice re-opens SAME vehicle -> idempotent 200, 0 credits!
    const reopen = await alice.req('POST', '/api/reports/lookup', {
      body: { query: 'HSF60S', country: 'NL' },
    });
    assert.equal(reopen.status, 200);
    assert.equal(reopen.json.alreadyUnlocked, true);
    assert.equal(reopen.json.creditCost, 0);
    assert.equal(reopen.json.report.id, aliceReportId);

    // 6. Alice tries a DIFFERENT live vehicle with 0 credits -> 402 INSUFFICIENT_CREDITS
    const noCreds = await alice.req('POST', '/api/reports/lookup', {
      body: { query: '21STVK', country: 'NL' },
    });
    assert.equal(noCreds.status, 402);
    assert.equal(noCreds.json.code, 'INSUFFICIENT_CREDITS');

    // 7. Tenant isolation: Bob cannot read or delete Alice's report (404)
    const bobPeek = await bob.req('GET', `/api/reports/${aliceReportId}`);
    assert.equal(bobPeek.status, 404);
    const bobDelete = await bob.req('DELETE', `/api/reports/${aliceReportId}`);
    assert.equal(bobDelete.status, 404);

    // 8. HistoVec import is 0 credits for authenticated user (even with 0 balance!)
    const hv = await alice.req('POST', '/api/reports/import-histovec', {
      body: { payload: SAMPLE_HISTOVEC_PAYLOAD },
    });
    assert.equal(hv.status, 201);
    assert.equal(hv.json.creditCost, 0);
    assert.equal(hv.json.report.dataOrigin, 'histovec_fused');

    // 9. Verified Share Link: enable -> public read (no PII) -> revoke -> 404
    const enableShare = await alice.req('POST', `/api/reports/${aliceReportId}/share`, { body: {} });
    assert.equal(enableShare.status, 200);
    assert.equal(enableShare.json.isShared, true);
    assert.ok(enableShare.json.shareToken);

    const pubShare = await guest.req('GET', `/api/share/${enableShare.json.shareToken}`);
    assert.equal(pubShare.status, 200);
    assert.equal(pubShare.json.verifiedShare, true);
    assert.equal(pubShare.json.report.id, aliceReportId);
    assert.equal(JSON.stringify(pubShare.json).includes('alice@example.com'), false);

    const revoke = await alice.req('DELETE', `/api/reports/${aliceReportId}/share`);
    assert.equal(revoke.status, 200);
    assert.equal(revoke.json.isShared, false);

    const afterRevoke = await guest.req('GET', `/api/share/${enableShare.json.shareToken}`);
    assert.equal(afterRevoke.status, 404);
  });

  it('completes sandbox checkout idempotently, generates printable HTML/JSON invoices, and enforces ownership', async () => {
    const packs = await alice.req('GET', '/api/billing/packs');
    assert.equal(packs.status, 200);
    assert.equal(packs.json.packs.length, 4);

    // Waiver required
    const noWaiver = await alice.req('POST', '/api/billing/checkout', {
      body: { packId: 'pack_2', acceptedWaiver: false },
    });
    assert.equal(noWaiver.status, 400);

    // Create sandbox order
    const checkout = await alice.req('POST', '/api/billing/checkout', {
      body: { packId: 'pack_2', acceptedWaiver: true },
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.json.mode, 'sandbox');
    const orderId = checkout.json.orderId;

    // Complete sandbox order -> +2 credits
    const done1 = await alice.req('POST', '/api/billing/sandbox/complete', {
      body: { orderId },
    });
    assert.equal(done1.status, 200);
    assert.equal(done1.json.creditsBalance, 2);
    assert.equal(done1.json.order.status, 'paid');

    // Idempotent second completion -> STILL 2 credits (never double-credited!)
    const done2 = await alice.req('POST', '/api/billing/sandbox/complete', {
      body: { orderId },
    });
    assert.equal(done2.status, 200);
    assert.equal(done2.json.creditsBalance, 2);

    // Orders list shape check (fixed double-wrapping!)
    const ordersRes = await alice.req('GET', '/api/billing/orders');
    assert.equal(ordersRes.status, 200);
    assert.ok(Array.isArray(ordersRes.json.orders));
    assert.equal(ordersRes.json.orders.length, 1);

    // JSON & HTML invoices + XSS/CSP safety
    const receiptJson = await alice.req('GET', `/api/billing/orders/${orderId}/receipt?format=json`);
    assert.equal(receiptJson.status, 200);
    assert.equal(receiptJson.json.receipt.totalCents, 2490);
    assert.equal(receiptJson.json.receipt.vatRate, 20);
    assert.ok(receiptJson.json.receipt.sandboxNotice);

    const receiptHtml = await alice.req('GET', `/api/billing/orders/${orderId}/receipt?format=html`);
    assert.equal(receiptHtml.status, 200);
    assert.ok(receiptHtml.text.includes(checkout.json.invoiceNumber));
    assert.equal(receiptHtml.text.includes('<script'), false);

    // Bob cannot view Alice's invoice
    const bobReceipt = await bob.req('GET', `/api/billing/orders/${orderId}/receipt`);
    assert.equal(bobReceipt.status, 404);
  });

  it('enforces admin RBAC, overview KPIs, and atomic admin credit adjustments', async () => {
    const forbidden = await alice.req('GET', '/api/admin/overview');
    assert.equal(forbidden.status, 403);

    const adminLogin = await admin.req('POST', '/api/auth/login', {
      body: { email: 'admin@vericar-test.eu', password: 'AdminPassword!123' },
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.json.user.role, 'admin');

    const overview = await admin.req('GET', '/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.ok(overview.json.kpis.usersTotal >= 3);
    assert.equal(overview.json.kpis.revenueSandboxCents, 2490);
    assert.equal(overview.json.kpis.revenueLiveCents, 0);
    assert.equal(JSON.stringify(overview.json.connectors.registries).includes('UK_MOT_API_KEY'), true);

    const usersRes = await admin.req('GET', '/api/admin/users?q=bob@example.com');
    assert.equal(usersRes.status, 200);
    assert.equal(usersRes.json.users.length, 1);
    const bobId = usersRes.json.users[0].id;

    // Grant +5 credits to Bob
    const grant = await admin.req('POST', `/api/admin/users/${bobId}/credits`, {
      body: { delta: 5, description: 'Geste commercial SAV' },
    });
    assert.equal(grant.status, 200);
    assert.equal(grant.json.user.creditsBalance, 6);

    // Reject over-debit that would go negative
    const overDebit = await admin.req('POST', `/api/admin/users/${bobId}/credits`, {
      body: { delta: -99, description: 'Test negatif' },
    });
    assert.equal(overDebit.status, 400);
  });

  it('supports RGPD account JSON export and password-confirmed cascade account deletion', async () => {
    const exp = await alice.req('GET', '/api/account/export');
    assert.equal(exp.status, 200);
    assert.equal(exp.json.user.email, 'alice@example.com');
    assert.equal(exp.json.user.passwordHash, undefined);
    assert.ok(exp.json.orders.length >= 1);
    assert.ok(exp.json.reports.length >= 2);

    // Wrong confirmation string -> 400
    const badConfirm = await alice.req('DELETE', '/api/account', {
      body: { password: 'NewPassword456!', confirmation: 'DELETE' },
    });
    assert.equal(badConfirm.status, 400);

    // Wrong password -> 401
    const badPwd = await alice.req('DELETE', '/api/account', {
      body: { password: 'WrongPassword!', confirmation: 'SUPPRIMER' },
    });
    assert.equal(badPwd.status, 401);

    // Valid cascade delete -> 200 and session immediately invalidated
    const del = await alice.req('DELETE', '/api/account', {
      body: { password: 'NewPassword456!', confirmation: 'SUPPRIMER' },
    });
    assert.equal(del.status, 200);
    assert.equal(del.json.deleted, true);

    const afterMe = await alice.req('GET', '/api/auth/me');
    assert.equal(afterMe.status, 401);
  });
});

describe('SaaS Edge Guarantees — Fetch-Before-Charge, Stripe Mode & Rate Limiting', () => {
  it('never debits credits when an upstream Open Data provider returns 503', async () => {
    const srv = await startTestServer({ fetchImpl: createMockFetch({ failUpstream: true }) });
    try {
      const user = new CookieClient(srv.baseUrl);
      const reg = await user.req('POST', '/api/auth/register', {
        body: { email: 'upstream@example.com', password: 'Password123!', acceptedTerms: true },
      });
      assert.equal(reg.json.user.creditsBalance, 1);

      const lookup = await user.req('POST', '/api/reports/lookup', {
        body: { query: 'HSF60S', country: 'NL' },
      });
      assert.equal(lookup.status, 502);
      assert.equal(lookup.json.code, 'UPSTREAM_ERROR');

      // Credit balance must still be 1!
      const me = await user.req('GET', '/api/auth/me');
      assert.equal(me.json.user.creditsBalance, 1);
    } finally {
      await srv.close();
      closeDb();
    }
  });

  it('disables sandbox endpoint in Stripe mode and verifies raw-body HMAC-SHA256 webhooks idempotently', async () => {
    const webhookSecret = 'whsec_test_vericar_secret_123456';
    const srv = await startTestServer({
      configOverrides: {
        stripeSecretKey: 'sk_test_mock_key',
        stripeWebhookSecret: webhookSecret,
      },
    });
    try {
      const user = new CookieClient(srv.baseUrl);
      const reg = await user.req('POST', '/api/auth/register', {
        body: { email: 'stripebuyer@example.com', password: 'Password123!', acceptedTerms: true },
      });
      assert.equal(reg.status, 201);
      const userId = reg.json.user.id;

      // Checkout uses Stripe mode
      const checkout = await user.req('POST', '/api/billing/checkout', {
        body: { packId: 'pack_3', acceptedWaiver: true },
      });
      assert.equal(checkout.status, 201);
      assert.equal(checkout.json.mode, 'stripe');
      assert.ok(checkout.json.checkoutUrl.startsWith('https://checkout.stripe.com/'));

      // Sandbox completion is hard-disabled (403 SANDBOX_DISABLED)
      const sandboxAttempt = await user.req('POST', '/api/billing/sandbox/complete', {
        body: { orderId: checkout.json.orderId },
      });
      assert.equal(sandboxAttempt.status, 403);
      assert.equal(sandboxAttempt.json.code, 'SANDBOX_DISABLED');

      // Pure unit check on expired webhook timestamp
      assert.throws(
        () => verifyStripeSignature('{}', signStripePayload('{}', webhookSecret, 1000), webhookSecret, 300, 2000),
        (err) => err.code === 'INVALID_SIGNATURE'
      );

      // Invalid signature rejected with 400
      const rawEvent = JSON.stringify({
        id: 'evt_test_001',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_webhook_001',
            payment_status: 'paid',
            amount_total: 3290,
            client_reference_id: checkout.json.orderId,
            metadata: { orderId: checkout.json.orderId, userId },
          },
        },
      });

      const badWebhook = await user.req('POST', '/api/billing/stripe/webhook', {
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=12345,v1=deadbeef' },
        rawBody: rawEvent,
      });
      assert.equal(badWebhook.status, 400);

      // Valid signed webhook fulfills order atomically (1 welcome + 3 pack = 4 credits)
      const validSig = signStripePayload(rawEvent, webhookSecret);
      const okWebhook1 = await user.req('POST', '/api/billing/stripe/webhook', {
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': validSig },
        rawBody: rawEvent,
      });
      assert.equal(okWebhook1.status, 200);
      assert.equal(okWebhook1.json.received, true);

      const me1 = await user.req('GET', '/api/auth/me');
      assert.equal(me1.json.user.creditsBalance, 4);

      // Replaying the exact same webhook must be idempotent (still 4 credits!)
      const okWebhook2 = await user.req('POST', '/api/billing/stripe/webhook', {
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': validSig },
        rawBody: rawEvent,
      });
      assert.equal(okWebhook2.status, 200);

      const me2 = await user.req('GET', '/api/auth/me');
      assert.equal(me2.json.user.creditsBalance, 4);
    } finally {
      await srv.close();
      closeDb();
    }
  });

  it('enforces per-endpoint rate limiting with HTTP 429 and Retry-After', async () => {
    const srv = await startTestServer({
      rateLimitOverrides: { auth: { max: 2, windowMs: 60_000 } },
    });
    try {
      const client = new CookieClient(srv.baseUrl);
      const r1 = await client.req('POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'x' } });
      const r2 = await client.req('POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'x' } });
      const r3 = await client.req('POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'x' } });
      assert.equal(r1.status, 401);
      assert.equal(r2.status, 401);
      assert.equal(r3.status, 429);
      assert.equal(r3.json.code, 'RATE_LIMITED');
      assert.ok(r3.headers.get('retry-after'));
    } finally {
      await srv.close();
      closeDb();
    }
  });
});
