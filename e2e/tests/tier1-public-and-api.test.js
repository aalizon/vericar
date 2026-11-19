import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2EHarness } from '../helpers/harness.js';

describe('Tier 1 — Public API Security, Marketing Funnel, Legal & Guest Demo Pre-Check', () => {
  let harness;

  before(async () => {
    harness = await startE2EHarness();
  });

  after(async () => {
    await harness?.close();
  });

  it('exposes healthy /api/health, /api/ready, security headers, and consumer-safe /api/registries', async () => {
    const healthRes = await fetch(`${harness.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.ok(healthRes.headers.get('content-security-policy'));
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');

    const readyRes = await fetch(`${harness.baseUrl}/api/ready`);
    assert.equal(readyRes.status, 200);
    const ready = await readyRes.json();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.db, 'ok');

    const regRes = await fetch(`${harness.baseUrl}/api/registries`);
    assert.equal(regRes.status, 200);
    const regText = await regRes.text();
    assert.ok(!regText.includes('UK_MOT_API_KEY'), 'Public /api/registries must never leak env var names');
    assert.ok(!regText.includes('envVars'), 'Public /api/registries must omit envVars metadata');
  });

  it('renders landing page, FAQ accordion, coverage directory, legal pages, and 404 cleanly', async () => {
    const session = await harness.newTrackedPage();
    const { page } = session;

    await page.goto(`${harness.baseUrl}/`, { waitUntil: 'networkidle' });

    const bodyText = await page.locator('body').innerText();
    assert.ok(bodyText.includes('VériCar'), 'Brand must render on landing');
    assert.ok(bodyText.includes('14,90 €'), 'Canonical Pack 1 price must appear');
    assert.ok(bodyText.includes('24,90 €'), 'Canonical Pack 2 price must appear');
    assert.ok(bodyText.includes('79,90 €'), 'Canonical Pack 10 price must appear');
    assert.ok(!bodyText.includes('SQLite'), 'Consumer landing must not expose SQLite internals');

    // Cookie notice can be dismissed cleanly
    await page.locator('#cookie-notice-dismiss').click();
    await page.locator('#cookie-notice-banner').waitFor({ state: 'detached' });

    // Interactive FAQ accordion
    const faqTrigger1 = page.locator('#faq-trigger-1');
    assert.equal(await faqTrigger1.getAttribute('aria-expanded'), 'false');
    await faqTrigger1.click();
    assert.equal(await faqTrigger1.getAttribute('aria-expanded'), 'true');
    await page.locator('#faq-panel-1').waitFor({ state: 'visible' });

    // Coverage directory (/couverture) — zero .env leakage
    await page.locator('#nav-registries').click();
    await page.waitForURL('**/couverture');
    const covText = await page.locator('main').innerText();
    assert.ok(covText.includes('12 registres européens'));
    assert.ok(!covText.includes('.env'));
    assert.ok(!covText.includes('UK_MOT_API_KEY'));

    // Legal pages
    for (const legalPath of ['/mentions-legales', '/cgu', '/confidentialite']) {
      await page.goto(`${harness.baseUrl}${legalPath}`, { waitUntil: 'networkidle' });
      const heading = await page.locator('main h1').innerText();
      assert.ok(heading.length > 5, `Expected legal heading on ${legalPath}`);
    }

    // 404 route
    await page.goto(`${harness.baseUrl}/page-inexistante-e2e`, { waitUntil: 'networkidle' });
    const notFoundText = await page.locator('main').innerText();
    assert.ok(notFoundText.includes('404') || notFoundText.includes('introuvable'));

    session.assertClean();
  });

  it('completes guest 2-step precheck -> 0-credit demo unlock -> interactive DamageDiagram & MileageChart', async () => {
    const session = await harness.newTrackedPage();
    const { page } = session;

    await page.goto(`${harness.baseUrl}/`, { waitUntil: 'networkidle' });
    await page.locator('#search-vehicle-input').fill('WAUZZZF48KA042918');
    await page.locator('#search-submit-btn').click();

    await page.waitForURL('**/verifier?q=WAUZZZF48KA042918**');
    await page.locator('#precheck-result-card').waitFor({ state: 'visible', timeout: 10000 });

    const precheckText = await page.locator('#precheck-result-card').innerText();
    assert.ok(precheckText.includes('0 crédit'), 'Demo precheck must display 0 credit');

    await page.locator('#btn-unlock-free-report').click();
    await page.waitForURL('**/rapport/DEMO-**', { timeout: 15000 });

    // Verify all 9 sections rendered
    for (const secId of [
      '#sec-synthese',
      '#sec-kilometrage',
      '#sec-sinistres',
      '#sec-admin',
      '#sec-ct',
      '#sec-rappels',
      '#sec-parcours',
      '#sec-specs',
      '#sec-cote',
    ]) {
      await page.locator(secId).waitFor({ state: 'visible' });
    }

    // Interact with MileageChart point
    const firstChartPoint = page.locator('#sec-kilometrage svg g[role="button"]').first();
    await firstChartPoint.click();
    await page.locator('#mileage-chart-detail').waitFor({ state: 'visible' });

    // Interact with DamageDiagram hotspot
    const hotspot = page.locator('.damage-hotspot').first();
    await hotspot.click();
    assert.equal(await hotspot.getAttribute('aria-pressed'), 'true');

    session.assertClean();
  });
});
