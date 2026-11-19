import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2EHarness } from '../helpers/harness.js';

describe('Smoke — Fast Production Bundle & Health Verification', () => {
  let harness;

  before(async () => {
    harness = await startE2EHarness();
  });

  after(async () => {
    await harness?.close();
  });

  it('serves compiled SPA and healthy API with zero browser errors', async () => {
    const session = await harness.newTrackedPage();
    await session.page.goto(`${harness.baseUrl}/`, { waitUntil: 'networkidle' });
    const title = await session.page.title();
    assert.ok(title.includes('VériCar Europe'));
    session.assertClean();
  });
});
