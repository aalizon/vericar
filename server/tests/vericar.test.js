import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initDb, closeDb, resetDbForTests, getDb } from '../src/db/index.js';
import { getAppliedMigrations } from '../src/db/migrations.js';
import { listReports, getReportById, deleteReport } from '../src/db.js';
import { decodeVinLocal, validateVinCheckDigit } from '../src/providers/vinDecoder.js';
import { parseHistovecInput, SAMPLE_HISTOVEC_PAYLOAD, buildSellerRequestMessage } from '../src/providers/histovecParser.js';
import { lookupNetherlandsOpenData, isLikelyDutchPlate } from '../src/providers/rdwProvider.js';
import { fetchRappelConsoRecalls } from '../src/providers/recallsProvider.js';
import { getEuropeanRegistriesCatalog } from '../src/providers/euRegistries.js';
import {
  analyzeMileage,
  computeCritAir,
  detectQueryType,
  evaluateTrustAndAlerts,
  generateVehicleReport,
  generateReportFromHistovec,
} from '../src/services/reportAggregator.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockExternalFetch(tracker = { urls: [] }) {
  return async (url) => {
    const s = String(url);
    tracker.urls.push(s);

    // Dutch Open Data (5 datasets + batched metadata)
    if (s.includes('opendata.rdw.nl/resource/m9d7-ebf2.json')) {
      if (s.includes('21STVK')) {
        return jsonResponse([
          {
            kenteken: '21STVK',
            merk: 'VOLKSWAGEN',
            handelsbenaming: 'CADDY',
            inrichting: 'gesloten opbouw',
            eerste_kleur: 'WIT',
            datum_eerste_toelating: '20160415',
            datum_eerste_tenaamstelling_in_nederland: '20160415',
            datum_tenaamstelling: '20210901',
            catalogusprijs: '24500',
            tellerstandoordeel: 'Onlogisch',
            wam_verzekerd: 'Ja',
            export_indicator: 'Nee',
            taxi_indicator: 'Nee',
            wacht_op_keuren: 'Nee',
            openstaande_terugroepactie_indicator: 'Ja',
            vervaldatum_apk: '20260415',
          },
        ]);
      }
      if (s.includes('HSF60S')) {
        return jsonResponse([
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
      return jsonResponse([]);
    }
    if (s.includes('opendata.rdw.nl/resource/8ys7-d773.json')) {
      return jsonResponse([
        {
          brandstof_omschrijving: 'Diesel',
          co2_uitstoot_gecombineerd: '124',
          emissiecode_omschrijving: 'Euro 6',
          nettomaximumvermogen: '75',
        },
      ]);
    }
    if (s.includes('opendata.rdw.nl/resource/sgfe-77wx.json')) {
      return jsonResponse([
        { meld_datum_door_keuringsinstantie: '20250410', keuringsinstantie_erkenning_omschrijving: 'APK NL' },
      ]);
    }
    if (s.includes('opendata.rdw.nl/resource/a34c-vvps.json')) {
      return jsonResponse([
        { meld_datum_door_keuringsinstantie: '20250410', gebrek_identificatie: 'RA2' },
        { meld_datum_door_keuringsinstantie: '20250410', gebrek_identificatie: 'AB1' },
      ]);
    }
    if (s.includes('opendata.rdw.nl/resource/hx2c-gt7k.json')) {
      return jsonResponse([
        { gebrek_identificatie: 'RA2', gebrek_omschrijving: 'Uitlaatsysteem niet gasdicht' },
        { gebrek_identificatie: 'AB1', gebrek_omschrijving: 'Banden niet voldoende profiel' },
      ]);
    }
    if (s.includes('opendata.rdw.nl/resource/t49b-isb7.json')) {
      return jsonResponse([
        { referentiecode_rdw: 'MGP220401', code_status: 'O' },
      ]);
    }
    if (s.includes('opendata.rdw.nl/resource/j9yg-7rg9.json')) {
      return jsonResponse([
        {
          referentiecode_rdw: 'MGP220401',
          publicatiedatum_rdw: '20220601',
          omschrijving_defect: 'Airbag conducteur Takata',
          materiele_gevolgen: 'Déploiement défectueux',
          beschrijving_van_het_herstel: 'Remplacement gratuit en concession',
        },
      ]);
    }

    // NHTSA vPIC
    if (s.includes('vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/')) {
      return jsonResponse({
        Results: [
          {
            Make: 'BMW',
            Model: '328i',
            ModelYear: '2012',
            BodyClass: 'Sedan/Saloon',
            FuelTypePrimary: 'Gasoline',
            EngineHP: '240',
            PlantCountry: 'GERMANY',
            PlantCity: 'Munich',
          },
        ],
      });
    }

    // RappelConso v2 (gtin-espaces)
    if (s.includes('rappelconso-v2-gtin-espaces')) {
      return jsonResponse({
        results: [
          {
            numero_fiche: '2026-01-0042',
            date_publication: '2026-01-14',
            sous_categorie_produit: 'Automobiles',
            modeles_ou_references: 'Série 3 / Caddy / 308',
            motif_rappel: 'Contrôle airbag / système de freinage',
            risques_encourus: 'Blessures',
            conduites_a_tenir_par_le_consommateur: 'Contacter le concessionnaire',
            lien_vers_la_fiche_rappel: 'https://rappel.conso.gouv.fr/fiche-rappel/12345',
          },
        ],
      });
    }

    // NHTSA Recalls
    if (s.includes('api.nhtsa.gov/recalls/recallsByVehicle')) {
      return jsonResponse({
        results: [
          {
            NHTSACampaignNumber: '23V123000',
            ReportReceivedDate: '12/03/2023',
            Component: 'AIR BAGS',
            Summary: 'Driver front airbag inflator inspection.',
            Consequence: 'Risk of injury in crash.',
            Remedy: 'Free dealer replacement.',
          },
        ],
      });
    }

    return jsonResponse({}, 404);
  };
}

before(() => {
  resetDbForTests(':memory:');
});

after(() => {
  closeDb();
});

describe('ISO 3779 VIN Decoder & EU Query Auto-Detection', () => {
  it('decodes European Peugeot VIN with WMI, anatomy, and year', () => {
    const res = decodeVinLocal('VF3MCYHZRLL087341');
    assert.equal(res.validFormat, true);
    assert.equal(res.make, 'Peugeot');
    assert.equal(res.assemblyCountry, 'France');
    assert.equal(res.anatomy.wmi, 'VF3');
    assert.equal(res.estimatedYear, 2020);
  });

  it('normalizes lowercase/whitespace before ISO 3779 check-digit validation', () => {
    const check = validateVinCheckDigit(' wba3a5c57cf256987 ');
    assert.equal(check.valid, true);
    const invalid = validateVinCheckDigit('WBA3A5C50CF256987');
    assert.equal(invalid.valid, false);
  });

  it('rejects malformed VIN containing forbidden letter I/O/Q', () => {
    const res = decodeVinLocal('VF3MCYHZRLI087341');
    assert.equal(res.validFormat, false);
  });

  it('detects EU plates cleanly without falsely hyphenating Italian plates', () => {
    assert.equal(detectQueryType('aa-123-bb').detectedCountry, 'FR');
    assert.equal(detectQueryType('AA123BB', 'FR').formattedPlate, 'AA-123-BB');
    // Italian plate AB123CD with IT selected must NOT get French dashes
    assert.equal(detectQueryType('AB123CD', 'IT').detectedCountry, 'IT');
    assert.equal(detectQueryType('AB123CD', 'IT').formattedPlate, 'AB123CD');
    assert.equal(detectQueryType('21STVK').detectedCountry, 'NL');
    assert.equal(detectQueryType('AB12 CDE').detectedCountry, 'GB');
    assert.equal(detectQueryType('1-ABC-234').detectedCountry, 'BE');
    assert.equal(detectQueryType('1234 BCD').detectedCountry, 'ES');
    assert.equal(detectQueryType('B-AB 1234').detectedCountry, 'DE');
    assert.equal(detectQueryType('WBA3A5C57CF256987').queryType, 'vin');
  });

  it('enforces strict 14 Dutch sidecode patterns', () => {
    assert.equal(isLikelyDutchPlate('21STVK'), true);
    assert.equal(isLikelyDutchPlate('HSF60S'), true);
    assert.equal(isLikelyDutchPlate('ABCDEF'), false);
    assert.equal(isLikelyDutchPlate('123456'), false);
  });
});

describe('Mileage, Hybrid CritAir Fix & Trust Score Penalties', () => {
  it('flags odometer rollback and computes exact km drop', () => {
    const analysis = analyzeMileage([
      { date: '2021-01-10', km: 50000, country: 'DE' },
      { date: '2023-03-20', km: 168420, country: 'DE' },
      { date: '2024-02-19', km: 94200, country: 'FR' },
    ]);
    assert.equal(analysis.rollbackDetected, true);
    assert.equal(analysis.status, 'rollback');
    assert.equal(analysis.rollbackDropKm, 74220);
  });

  it('computes authentic French CritAir classes and NEVER grants CritAir 0 to hybrids', () => {
    assert.equal(computeCritAir({ fuelType: 'Électrique', year: 2022 }).level, 0);
    assert.equal(computeCritAir({ fuelType: 'Essence / Électrique', euroClass: 'Euro 6', year: 2023 }).level, 1);
    assert.equal(computeCritAir({ fuelType: 'Diesel / Électrique', euroClass: 'Euro 6', year: 2023 }).level, 2);
    assert.equal(computeCritAir({ fuelType: 'Hybride Rechargeable Essence', year: 2022 }).level, 1);
    assert.equal(computeCritAir({ fuelType: 'Essence', euroClass: 'Euro 6', year: 2020 }).level, 1);
    assert.equal(computeCritAir({ fuelType: 'Diesel', euroClass: 'Euro 6', year: 2020 }).level, 2);
    assert.equal(computeCritAir({ fuelType: 'Diesel', euroClass: 'Euro 4', year: 2008 }).level, 3);
  });

  it('penalizes WOK road-ban, uninsured WAM, exported, open recall, and failed inspection', () => {
    const baseline = evaluateTrustAndAlerts({
      mileage: analyzeMileage([]),
      administrative: { insuredWam: true },
      dataCompleteness: 'open_data',
    });
    const penalized = evaluateTrustAndAlerts({
      mileage: analyzeMileage([]),
      administrative: {
        hasActiveWok: true,
        insuredWam: false,
        exported: true,
        openRecallFlag: true,
      },
      inspections: [{ date: '2025-05-01', passed: false, defects: [] }],
      dataCompleteness: 'open_data',
    });
    assert.ok(penalized.trustScore < baseline.trustScore - 40);
    assert.equal(penalized.riskLevel, 'high');
    assert.ok(penalized.alerts.some((a) => a.title.includes('WOK')));
    assert.ok(penalized.alerts.some((a) => a.title.includes('WAM')));
    assert.ok(penalized.alerts.some((a) => a.title.includes('export')));
    assert.ok(penalized.alerts.some((a) => a.title.includes('défavorable')));
  });
});

describe('HistoVec Parser (Negation Scope, <1000km, Seller Message) & Fusion', () => {
  it('parses line-scoped negations without leaking across lines and handles <1000 km', () => {
    const text = `
      Rapport HistoVec officiel
      Plaque : AB-456-CD
      VIN : VF1RJB00265819432
      Marque : Renault
      Modèle : Clio V
      Date de mise en circulation : 12/03/2020
      2 titulaires
      15/06/2020 - Contrôle initial : 850 km
      10/03/2024 - Contrôle technique Favorable : 54 200 km
      05/03/2026 - Contrôle technique Favorable : 79,100 km
      Gage : aucun gage inscrit
      Vol : non volé
      Sinistre : Procédure VGE enregistrée suite choc avant
    `;
    const parsed = parseHistovecInput(text);
    assert.equal(parsed.plate, 'AB-456-CD');
    assert.equal(parsed.vin, 'VF1RJB00265819432');
    assert.equal(parsed.mileageReadings.length, 3);
    assert.equal(parsed.mileageReadings[0].km, 850);
    assert.equal(parsed.mileageReadings[2].km, 79100);
    assert.equal(parsed.administrative.pledge, false);
    assert.equal(parsed.administrative.stolen, false);
    // VGE on its own line without negation must remain true!
    assert.equal(parsed.administrative.vgeProcedure, true);
    assert.equal(parsed.administrative.insuredWam, null);
    assert.equal(parsed.administrative.verifiedFields.insuredWam, false);
  });

  it('includes plate when building seller request message', () => {
    const msg = buildSellerRequestMessage({ vehicleLabel: 'Peugeot 3008', plate: 'FQ-729-DM', country: 'FR' });
    assert.ok(msg.includes('Peugeot 3008'));
    assert.ok(msg.includes('FQ-729-DM'));
  });

  it('generates and persists a fused HistoVec report offline with mocked fetch', async () => {
    const mockFetch = createMockExternalFetch();
    const report = await generateReportFromHistovec(SAMPLE_HISTOVEC_PAYLOAD, { fetchImpl: mockFetch });
    assert.ok(report.id.startsWith('VR-'));
    assert.equal(report.dataOrigin, 'histovec_fused');
    assert.equal(report.mileage.status, 'verified');
    assert.equal(report.administrative.insuredWam, null);
    assert.ok(report.trustScore >= 80);

    const fetched = getReportById(report.id);
    assert.equal(fetched.id, report.id);
  });
});

describe('Deterministic Providers (Batched RDW, RappelConso v2, Cache, Consumer-Safe Catalog)', () => {
  it('batches RDW defect metadata via Socrata in(...) and caches subsequent lookups', async () => {
    const tracker = { urls: [] };
    const mockFetch = createMockExternalFetch(tracker);

    const first = await lookupNetherlandsOpenData('21STVK', mockFetch);
    assert.equal(first.found, true);
    assert.equal(first.vehicle.make, 'VOLKSWAGEN');
    assert.equal(first.odometerJudgement.status, 'rollback');
    assert.equal(first.inspections[0].defects.length, 2);

    // Ensure hx2c-gt7k was queried only ONCE in a batched `in(...)` call, not N+1!
    const defectMetaCalls = tracker.urls.filter((u) => u.includes('hx2c-gt7k'));
    assert.equal(defectMetaCalls.length, 1);

    // Second lookup must hit SQLite api_cache (zero additional HTTP requests)
    const countAfterFirst = tracker.urls.length;
    const second = await lookupNetherlandsOpenData('21STVK', mockFetch);
    assert.equal(second.found, true);
    assert.equal(tracker.urls.length, countAfterFirst);
  });

  it('queries rappelconso-v2-gtin-espaces dataset', async () => {
    const tracker = { urls: [] };
    const recalls = await fetchRappelConsoRecalls('BMW', 'Série 3', createMockExternalFetch(tracker));
    assert.ok(recalls.length >= 1);
    assert.ok(tracker.urls.some((u) => u.includes('rappelconso-v2-gtin-espaces')));
  });

  it('hides internal envVars from public registries catalog unless includeInternalMeta=true', () => {
    const pub = getEuropeanRegistriesCatalog({ includeInternalMeta: false });
    assert.equal(pub.length, 12);
    assert.equal(JSON.stringify(pub).includes('UK_MOT_API_KEY'), false);
    assert.equal(JSON.stringify(pub).includes('NO_VEGVESEN_API_KEY'), false);

    const admin = getEuropeanRegistriesCatalog({ includeInternalMeta: true });
    assert.equal(JSON.stringify(admin).includes('UK_MOT_API_KEY'), true);
  });

  it('runs deterministic offline demo, NL open data, and VIN report generation', async () => {
    const mockFetch = createMockExternalFetch();

    const demo = await generateVehicleReport({ query: 'WAUZZZF48KA042918', fetchImpl: mockFetch });
    assert.equal(demo.dataOrigin, 'demo_enriched');
    assert.equal(demo.riskLevel, 'high');
    assert.equal(demo.mileage.rollbackDetected, true);
    assert.equal(demo.damages.count, 2);

    const nl = await generateVehicleReport({ query: 'HSF60S', country: 'NL', fetchImpl: mockFetch });
    assert.equal(nl.dataOrigin, 'live_open_data');
    assert.equal(nl.vehicle.make, 'PEUGEOT');
    assert.ok(listReports(20).some((r) => r.id === nl.id));
    assert.equal(deleteReport(nl.id), true);

    const vin = await generateVehicleReport({ query: 'WBA3A5C57CF256987', fetchImpl: mockFetch });
    assert.equal(vin.dataOrigin, 'live_vin');
    assert.equal(vin.vehicle.make.toUpperCase(), 'BMW');
    assert.equal(vin.vehicle.vinCheckDigit.valid, true);
  });
});

describe('Legacy V1 SQLite Schema Upgrade Migration', () => {
  it('upgrades a V1 reports-only database cleanly without losing existing reports', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vericar-mig-'));
    const legacyDbPath = path.join(tmpDir, 'legacy.db');

    try {
      // Seed a legacy V1 schema without schema_migrations or SaaS columns
      const raw = new DatabaseSync(legacyDbPath);
      raw.exec(`
        CREATE TABLE reports (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL,
          query_type TEXT NOT NULL,
          country TEXT NOT NULL,
          vin TEXT,
          plate TEXT,
          make TEXT,
          model TEXT,
          year INTEGER,
          trust_score INTEGER NOT NULL,
          risk_level TEXT NOT NULL,
          data_origin TEXT NOT NULL,
          summary_json TEXT NOT NULL,
          report_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO reports VALUES (
          'VR-LEGACY01', '21STVK', 'plate', 'NL', NULL, '21STVK', 'VOLKSWAGEN', 'CADDY',
          2016, 40, 'high', 'live_open_data', '{"verdict":"Legacy"}', '{"id":"VR-LEGACY01"}',
          '2026-01-01T00:00:00.000Z'
        );
      `);
      raw.close();

      // Now boot SaaS initDb() on that legacy DB
      closeDb();
      initDb(legacyDbPath);
      const db = getDb();
      const migrations = getAppliedMigrations(db);
      assert.equal(migrations.length, 3);

      const legacyRow = db.prepare('SELECT id, credit_cost, is_shared FROM reports WHERE id = ?').get('VR-LEGACY01');
      assert.equal(legacyRow.id, 'VR-LEGACY01');
      assert.equal(legacyRow.credit_cost, 0);
      assert.equal(legacyRow.is_shared, 0);
    } finally {
      resetDbForTests(':memory:');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
