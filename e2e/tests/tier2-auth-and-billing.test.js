import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2EHarness } from '../helpers/harness.js';

describe('Tier 2 — Registration, Session Persistence, Sandbox Pack Checkout & VAT Invoice', () => {
  let harness;

  before(async () => {
    harness = await startE2EHarness();
  });

  after(async () => {
    await harness?.close();
  });

  it('registers a user (+1 credit), purchases Pack Acheteur in sandbox (+2 credits), and renders VAT invoice', async () => {
    const session = await harness.newTrackedPage();
    const { page } = session;
    const email = `buyer-${Date.now()}@vericar-e2e.test`;

    await page.goto(`${harness.baseUrl}/`, { waitUntil: 'networkidle' });

    // Open Register modal from Header
    await page.locator('#header-register-btn').click();
    await page.locator('#auth-modal-dialog').waitFor({ state: 'visible' });

    await page.locator('#auth-modal-email').fill(email);
    await page.locator('#auth-modal-password').fill('BuyerSecure!2026');
    await page.locator('#auth-modal-fullname').fill('Jean Acheteur');
    await page.locator('#auth-modal-company').fill('Garage Horizon SARL');
    await page.locator('#auth-modal-terms').check();
    await page.locator('#auth-modal-submit-btn').click();

    await page.locator('#auth-modal-dialog').waitFor({ state: 'detached', timeout: 10000 });

    // Verify welcome credit pill shows 1 crédit
    const creditPill = page.locator('#header-credits-pill');
    await creditPill.waitFor({ state: 'visible' });
    assert.ok((await creditPill.innerText()).includes('1'));

    // Full page reload must preserve authenticated session
    await page.reload({ waitUntil: 'networkidle' });
    await creditPill.waitFor({ state: 'visible' });
    assert.ok((await creditPill.innerText()).includes('1'));

    // Navigate to /tarifs and buy Pack Acheteur (pack_2 -> +2 credits, 24,90 €)
    await page.locator('#nav-pricing').click();
    await page.waitForURL('**/tarifs');
    await page.locator('#pricing-sandbox-banner').waitFor({ state: 'visible' });

    // Waiver checkbox required (Art. L221-28)
    await page.locator('#pricing-waiver-checkbox').check();
    await page.locator('#btn-buy-pack_2').click();

    // Complete 1-click sandbox order
    await page.locator('#sandbox-checkout-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#btn-confirm-sandbox-order').click();
    await page.locator('#pricing-checkout-success').waitFor({ state: 'visible', timeout: 10000 });

    // Header pill must now show 3 crédits (1 welcome + 2 bought)
    await page.waitForFunction(
      () => document.querySelector('#header-credits-pill')?.textContent?.includes('3'),
      null,
      { timeout: 10000 }
    );

    // Go to /compte?tab=orders and open Invoice sheet
    await page.goto(`${harness.baseUrl}/compte?tab=orders`, { waitUntil: 'networkidle' });
    await page.locator('#account-panel-orders').waitFor({ state: 'visible' });
    const invoiceLink = page.locator('#account-panel-orders a[href^="/compte/factures/"]').first();
    await invoiceLink.click();

    await page.waitForURL('**/compte/factures/**');
    await page.locator('#invoice-sheet').waitFor({ state: 'visible', timeout: 10000 });
    const invoiceText = await page.locator('#invoice-sheet').innerText();
    assert.ok(invoiceText.includes('24,90 €'), 'Invoice must display 24,90 € TTC');
    assert.ok(invoiceText.includes('TVA') && invoiceText.includes('20'), 'Invoice must show 20% VAT');
    assert.ok(invoiceText.includes('Garage Horizon SARL'), 'Invoice must show buyer company name');

    session.assertClean();
  });
});
