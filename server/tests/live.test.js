import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { resetDbForTests, closeDb } from '../src/db/index.js';
import { lookupNetherlandsOpenData } from '../src/providers/rdwProvider.js';
import { decodeVinEnriched } from '../src/providers/vinDecoder.js';
import { fetchRappelConsoRecalls } from '../src/providers/recallsProvider.js';

const SKIP_LIVE = process.env.RUN_LIVE_TESTS !== '1';

describe('Live Open Data Smoke Tests (Opt-In: RUN_LIVE_TESTS=1)', { skip: SKIP_LIVE }, () => {
  before(() => {
    resetDbForTests(':memory:');
  });

  after(() => {
    closeDb();
  });

  it('queries real Dutch Open Data (5 datasets) for VW Caddy 21STVK', async () => {
    const res = await lookupNetherlandsOpenData('21STVK');
    assert.equal(res.found, true);
    assert.equal(res.vehicle.make, 'VOLKSWAGEN');
    assert.equal(res.odometerJudgement.status, 'rollback');
  });

  it('queries real Dutch Open Data for Peugeot 308 HSF60S', async () => {
    const res = await lookupNetherlandsOpenData('HSF60S');
    assert.equal(res.found, true);
    assert.equal(res.vehicle.make, 'PEUGEOT');
  });

  it('decodes real BMW VIN WBA3A5C57CF256987 via NHTSA vPIC', async () => {
    const res = await decodeVinEnriched('WBA3A5C57CF256987');
    assert.equal(res.validFormat, true);
    assert.equal(res.make.toUpperCase(), 'BMW');
    assert.equal(res.checkDigit.valid, true);
  });

  it('fetches real French vehicle recalls from RappelConso rappelconso-v2-gtin-espaces', async () => {
    const recalls = await fetchRappelConsoRecalls('BMW', 'Série 3');
    assert.ok(Array.isArray(recalls));
    assert.ok(recalls.length >= 1, 'Expected at least 1 real automotive recall from RappelConso');
  });
});
