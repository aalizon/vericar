import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_EMAIL, ADMIN_PASSWORD, startE2EHarness } from '../helpers/harness.js';

describe('Tier 4 — Profile, RGPD Export/Delete, Admin RBAC & Admin Credit Adjustment', () => {
  let harness;

  before(async () => {
    harness = await startE2EHarness();
  });

  after(async () => {
    await harness?.close();
  });

  it('blocks standard user on /admin (403), updates profile, exports & deletes RGPD account, then runs Admin dashboard', async () => {
    const userSession = await harness.newTrackedPage();
    const { page } = userSession;
    const userEmail = `rgpd-${Date.now()}@vericar-e2e.test`;
    const userPwd = 'RgpdSecure!2026';

    // Register normal user
    await page.goto(`${harness.baseUrl}/inscription`, { waitUntil: 'networkidle' });
    await page.locator('#auth-page-email').fill(userEmail);
    await page.locator('#auth-page-password').fill(userPwd);
    await page.locator('#auth-page-fullname').fill('Lucie Test');
    await page.locator('#auth-page-terms').check();
    await page.locator('#auth-page-submit-btn').click();
    await page.waitForURL('**/compte', { timeout: 10000 });

    // Non-admin visiting /admin sees explicit 403 RBAC guard
    await page.goto(`${harness.baseUrl}/admin`, { waitUntil: 'networkidle' });
    const guardText = await page.locator('main').innerText();
    assert.ok(guardText.includes('Accès refusé (403)'));

    // Profile update on /compte?tab=profile
    await page.goto(`${harness.baseUrl}/compte?tab=profile`, { waitUntil: 'networkidle' });
    await page.locator('#profile-fullname').fill('Lucie Martin');
    await page.locator('#profile-company').fill('Auto Conseil SAS');
    await page.locator('#btn-save-profile').click();
    await page.waitForTimeout(300);

    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#profile-fullname').inputValue(), 'Lucie Martin');
    assert.equal(await page.locator('#profile-company').inputValue(), 'Auto Conseil SAS');

    // Verify RGPD JSON export via authenticated browser context
    const exportStatus = await page.evaluate(async () => {
      const res = await fetch('/api/account/export', { credentials: 'include' });
      const json = await res.json();
      return { status: res.status, email: json.user?.email };
    });
    assert.equal(exportStatus.status, 200);
    assert.equal(exportStatus.email, userEmail);

    // Delete account via Danger Zone
    await page.locator('#delete-account-confirm').fill('SUPPRIMER');
    await page.locator('#delete-account-password').fill(userPwd);
    await page.locator('#btn-delete-account').click();
    await page.waitForURL(`${harness.baseUrl}/`, { timeout: 10000 });
    await page.locator('#header-login-btn').waitFor({ state: 'visible' });
    userSession.assertClean();

    // Create a fresh target user so admin has a user to credit
    const targetEmail = `target-${Date.now()}@vericar-e2e.test`;
    const regRes = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: harness.baseUrl },
      body: JSON.stringify({
        email: targetEmail,
        password: 'TargetUser!2026',
        fullName: 'Client Support',
        acceptedTerms: true,
      }),
    });
    assert.equal(regRes.status, 201);
    const { user: targetUser } = await regRes.json();

    // Sign in as bootstrapped Admin in fresh context
    const adminSession = await harness.newTrackedPage();
    await adminSession.page.goto(`${harness.baseUrl}/connexion`, { waitUntil: 'networkidle' });
    await adminSession.page.locator('#auth-page-email').fill(ADMIN_EMAIL);
    await adminSession.page.locator('#auth-page-password').fill(ADMIN_PASSWORD);
    await adminSession.page.locator('#auth-page-submit-btn').click();
    await adminSession.page.waitForURL('**/compte', { timeout: 10000 });

    // Open Admin console via Header badge
    await adminSession.page.locator('#header-admin-link').click();
    await adminSession.page.waitForURL('**/admin');
    await adminSession.page.locator('#admin-dashboard').waitFor({ state: 'visible', timeout: 10000 });

    const adminText = await adminSession.page.locator('#admin-dashboard').innerText();
    assert.ok(adminText.includes(targetEmail), 'Admin users table must list target user');

    // Grant +5 credits to target user
    await adminSession.page.locator('#admin-user-select').selectOption(targetUser.id);
    await adminSession.page.locator('#admin-delta-input').fill('5');
    await adminSession.page.locator('#admin-desc-input').fill('Bonus E2E support');
    await adminSession.page.locator('#btn-admin-adjust-credits').click();

    await adminSession.page.waitForFunction(
      (email) => {
        const rows = Array.from(document.querySelectorAll('#admin-dashboard tbody tr'));
        const row = rows.find((r) => r.textContent?.includes(email));
        return Boolean(row && row.textContent?.includes('6'));
      },
      targetEmail,
      { timeout: 10000 }
    );

    adminSession.assertClean();
  });
});
