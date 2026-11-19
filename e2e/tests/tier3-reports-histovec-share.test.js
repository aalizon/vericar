import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2EHarness } from '../helpers/harness.js';

describe('Tier 3 — HistoVec 0-Credit Fusion, Public Share Lifecycle (Zero PII) & Report Comparator', () => {
  let harness;

  before(async () => {
    harness = await startE2EHarness();
  });

  after(async () => {
    await harness?.close();
  });

  it('imports HistoVec for 0 credits, shares and revokes cleanly without PII, and compares 2 reports', async () => {
    const ownerSession = await harness.newTrackedPage();
    const { page } = ownerSession;
    const ownerEmail = `owner-${Date.now()}@vericar-e2e.test`;

    // Register via dedicated /inscription page
    await page.goto(`${harness.baseUrl}/inscription`, { waitUntil: 'networkidle' });
    await page.locator('#auth-page-email').fill(ownerEmail);
    await page.locator('#auth-page-password').fill('OwnerPass!2026');
    await page.locator('#auth-page-fullname').fill('Marie Vendeuse');
    await page.locator('#auth-page-terms').check();
    await page.locator('#auth-page-submit-btn').click();
    await page.waitForURL('**/compte', { timeout: 10000 });

    // Import HistoVec sample (0 credit)
    await page.locator('#nav-histovec').click();
    await page.waitForURL('**/histovec');
    await page.locator('#btn-load-histovec-sample').click();
    await page.locator('#btn-submit-histovec').click();

    await page.waitForURL('**/rapport/VR-**', { timeout: 25000 });
    await page.locator('#sec-synthese').waitFor({ state: 'visible' });

    // Balance must still be 1 credit (0 credit spent)
    assert.ok((await page.locator('#header-credits-pill').innerText()).includes('1'));

    // Activate verified public share link
    await page.locator('#btn-enable-share').click();
    await page.locator('#report-share-bar').waitFor({ state: 'visible', timeout: 10000 });
    const shareUrl = (await page.locator('#report-share-url').innerText()).trim();
    assert.ok(shareUrl.includes('/r/'), `Expected /r/ token URL, got: ${shareUrl}`);

    // Open share URL in a separate unauthenticated incognito context
    const guestSession = await harness.newTrackedPage();
    await guestSession.page.goto(shareUrl, { waitUntil: 'networkidle' });
    await guestSession.page.locator('#public-share-banner').waitFor({ state: 'visible', timeout: 10000 });
    await guestSession.page.locator('#sec-synthese').waitFor({ state: 'visible' });

    // Confirm readOnly mode & ZERO owner PII exposure
    assert.equal(await guestSession.page.locator('#btn-revoke-share').count(), 0);
    assert.equal(await guestSession.page.locator('#btn-histovec-fusion').count(), 0);
    const guestHtml = await guestSession.page.content();
    assert.ok(!guestHtml.includes(ownerEmail), 'Public share page must NEVER expose owner email');
    assert.ok(!guestHtml.includes('Marie Vendeuse'), 'Public share page must NEVER expose owner full name');

    // Revoke share link as owner -> incognito refresh must show share-not-found
    await page.locator('#btn-revoke-share').click();
    await page.locator('#report-share-bar').waitFor({ state: 'detached', timeout: 10000 });

    await guestSession.page.reload({ waitUntil: 'networkidle' });
    await guestSession.page.locator('#share-not-found').waitFor({ state: 'visible', timeout: 10000 });
    guestSession.assertClean({ allowExpectedHttp404: true });

    // Unlock a 2nd report (demo dossier while logged in -> 0 credit & saved to library)
    await page.goto(`${harness.baseUrl}/verifier?q=VF3MCYHZRLL087341&country=FR`, {
      waitUntil: 'networkidle',
    });
    await page.locator('#btn-unlock-free-report').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#btn-unlock-free-report').click();
    await page.waitForURL('**/rapport/VR-**', { timeout: 15000 });

    // Open /mes-rapports library, select 2 reports, and compare side by side
    await page.locator('#nav-history').click();
    await page.waitForURL('**/mes-rapports');
    const checkboxes = page.locator('input[type="checkbox"][aria-label^="Sélectionner"]');
    await checkboxes.nth(1).waitFor({ state: 'visible', timeout: 10000 });
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    await page.locator('#btn-compare-selected').click();
    await page.locator('#compare-panel').waitFor({ state: 'visible', timeout: 10000 });
    const compareText = await page.locator('#compare-panel').innerText();
    assert.ok(compareText.includes('Comparaison côte à côte'), 'Comparator heading must render');
    assert.ok(compareText.includes('/100'), 'Comparator must display /100 trust scores');
    assert.ok(compareText.includes('Compteur') && compareText.includes('Sinistres'));

    ownerSession.assertClean();
  });
});
