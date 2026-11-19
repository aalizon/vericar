import { recordConnectorMetric } from '../db/repositories.js';
import { getCachedOrFetch, CACHE_TTLS } from '../services/apiCache.js';

const RDW_BASE = 'https://opendata.rdw.nl/resource';

const NL_COLOR_MAP = {
  WIT: 'Blanc',
  ZWART: 'Noir',
  GRIJS: 'Gris',
  BLAUW: 'Bleu',
  ROOD: 'Rouge',
  GROEN: 'Vert',
  GEEL: 'Jaune',
  ORANJE: 'Orange',
  BRUIN: 'Marron',
  BEIGE: 'Beige',
  PAARS: 'Violet',
  DIVERSEN: 'Multicolore',
};

const NL_BODY_MAP = {
  hatchback: 'Berline compacte / Hayon',
  sedan: 'Berline 4 portes',
  stationwagen: 'Break / Familiale',
  MPV: 'Monospace',
  cabriolet: 'Cabriolet',
  coupe: 'Coupé',
  'gesloten opbouw': 'Fourgon tôlé',
  kampeerwagen: 'Camping-car',
  terreinwagen: 'SUV / Tout-terrain',
};

const NL_FUEL_MAP = {
  Benzine: 'Essence',
  Diesel: 'Diesel',
  Elektriciteit: 'Électrique',
  LPG: 'GPL',
  CNG: 'GNV',
  Waterstof: 'Hydrogène',
  Alcohol: 'Éthanol',
};

// Official Dutch kenteken sidecodes (Sidecodes 1 through 14)
const NL_SIDECODE_PATTERNS = [
  /^[A-Z]{2}\d{4}$/,     // 1: XX-99-99
  /^\d{4}[A-Z]{2}$/,     // 2: 99-99-XX
  /^\d{2}[A-Z]{2}\d{2}$/,// 3: 99-XX-99
  /^[A-Z]{2}\d{2}[A-Z]{2}$/, // 4: XX-99-XX
  /^[A-Z]{4}\d{2}$/,     // 5: XX-XX-99
  /^\d{2}[A-Z]{4}$/,     // 6: 99-XX-XX
  /^\d{2}[A-Z]{3}\d$/,   // 7: 99-XXX-9
  /^\d[A-Z]{3}\d{2}$/,   // 8: 9-XXX-99
  /^[A-Z]{2}\d{3}[A-Z]$/,// 9: XX-999-X
  /^[A-Z]\d{3}[A-Z]{2}$/,// 10: X-999-XX
  /^[A-Z]{3}\d{2}[A-Z]$/,// 11: XXX-99-X
  /^[A-Z]\d{2}[A-Z]{3}$/,// 12: X-99-XXX
  /^\d[A-Z]{2}\d{3}$/,   // 13: 9-XX-999
  /^\d{3}[A-Z]{2}\d$/,   // 14: 999-XX-9
];

function formatRdwDate(yyyymmdd) {
  if (!yyyymmdd || String(yyyymmdd).length < 8) return null;
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function normalizeDutchPlate(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isLikelyDutchPlate(raw) {
  const plate = normalizeDutchPlate(raw);
  if (plate.length !== 6) return false;
  return NL_SIDECODE_PATTERNS.some((rx) => rx.test(plate));
}

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function escapeSoql(val) {
  return String(val || '').replace(/'/g, "''");
}

function translateDutchDefect(text) {
  if (!text) return 'Défaut technique constaté lors du contrôle APK';
  const replacements = [
    [/Uitlaatsysteem niet gasdicht/i, 'Système d’échappement non étanche aux gaz'],
    [/onveilige afvoer uitlaatgassen?/i, 'évacuation non conforme des gaz d’échappement'],
    [/Band\(en\)? niet voldoende profiel|profieldiepte/i, 'Usure pneumatique / profondeur de sculpture insuffisante'],
    [/Remschijf|Remblok|Remleiding|Remwerking/i, 'Défaut du système de freinage'],
    [/Verlichting|Koplamp|Achterlicht|Richtingaanwijzer/i, 'Défaut d’éclairage ou de signalisation'],
    [/Schokdemper|Veer|Wielophanging|Fuseekogel/i, 'Défaut de suspension ou train roulant'],
    [/Stuurinrichting|Stuurkogel/i, 'Jeu ou défaut dans la direction'],
    [/Roest|Corrosie/i, 'Corrosion constatée sur la structure'],
    [/Voorruit|Ruitenwisser/i, 'Pare-brise ou essuie-glaces non conformes'],
    [/Olielekkage|Lekkage/i, 'Fuite de fluide / huile'],
    [/Airbag|Gordel/i, 'Défaut de sécurité passive (airbag ou ceinture)'],
    [/CO-gehalte|Uitstoot|Emissie/i, 'Émissions polluantes hors normes'],
  ];

  for (const [regex, fr] of replacements) {
    if (regex.test(text)) {
      return `${fr} (NL : « ${text} »)`;
    }
  }
  return `Point de contrôle APK (NL) : ${text}`;
}

function mapOdometerJudgement(oordeel) {
  if (!oordeel) return { status: 'unknown', label: 'Non évalué', raw: null };
  const lower = oordeel.toLowerCase();
  if (lower === 'logisch') {
    return {
      status: 'verified',
      label: 'Logique (cohérence validée par le registre néerlandais)',
      raw: oordeel,
    };
  }
  if (lower === 'onlogisch') {
    return {
      status: 'rollback',
      label: 'ILLOGIQUE — Anomalie ou recul kilométrique signalé au registre néerlandais',
      raw: oordeel,
    };
  }
  return {
    status: 'inconclusive',
    label: `Sans jugement définitif (${oordeel} — souvent dû à un import ou trop peu de relevés)`,
    raw: oordeel,
  };
}

/**
 * Fetches live vehicle history from Dutch Open Data (CC0) across 5 public datasets
 * with batched Socrata `in(...)` metadata queries and SQLite TTL caching.
 */
export async function lookupNetherlandsOpenData(rawPlate, fetchImpl = globalThis.fetch) {
  const plate = normalizeDutchPlate(rawPlate);
  const startedAt = performance.now();

  try {
    const { data: result } = await getCachedOrFetch({
      cacheKey: `rdw:plate:${plate}`,
      provider: 'nl_open_data',
      ttlMs: CACHE_TTLS.rdw,
      fetcher: async () => {
        const [coreArr, fuelArr, apkArr, defectsArr, recallsLinkArr] = await Promise.all([
          fetchJson(`${RDW_BASE}/m9d7-ebf2.json?kenteken=${encodeURIComponent(plate)}`, fetchImpl),
          fetchJson(`${RDW_BASE}/8ys7-d773.json?kenteken=${encodeURIComponent(plate)}`, fetchImpl).catch(() => []),
          fetchJson(
            `${RDW_BASE}/sgfe-77wx.json?kenteken=${encodeURIComponent(plate)}&%24order=meld_datum_door_keuringsinstantie%20DESC&%24limit=15`,
            fetchImpl
          ).catch(() => []),
          fetchJson(
            `${RDW_BASE}/a34c-vvps.json?kenteken=${encodeURIComponent(plate)}&%24order=meld_datum_door_keuringsinstantie%20DESC&%24limit=25`,
            fetchImpl
          ).catch(() => []),
          fetchJson(`${RDW_BASE}/t49b-isb7.json?kenteken=${encodeURIComponent(plate)}`, fetchImpl).catch(() => []),
        ]);

        const latency = performance.now() - startedAt;

        if (!Array.isArray(coreArr) || coreArr.length === 0) {
          recordConnectorMetric('nl_open_data', 'online', latency, `Plaque ${plate} non trouvée`);
          return { found: false, plate, latencyMs: Math.round(latency) };
        }

        const core = coreArr[0];
        const fuel = fuelArr[0] || {};
        const fuelSecondary = fuelArr[1] || null;

        // Batched Socrata `in(...)` calls instead of N+1 individual queries
        const uniqueDefectCodes = [...new Set(defectsArr.map((d) => d.gebrek_identificatie).filter(Boolean))].slice(0, 20);
        const uniqueRecallCodes = [...new Set((recallsLinkArr || []).map((r) => r.referentiecode_rdw).filter(Boolean))].slice(0, 12);

        const [defectRows, recallDetailRows] = await Promise.all([
          uniqueDefectCodes.length > 0
            ? fetchJson(
                `${RDW_BASE}/hx2c-gt7k.json?%24where=${encodeURIComponent(
                  `gebrek_identificatie in(${uniqueDefectCodes.map((c) => `'${escapeSoql(c)}'`).join(',')})`
                )}&%24limit=50`,
                fetchImpl
              ).catch(() => [])
            : Promise.resolve([]),
          uniqueRecallCodes.length > 0
            ? fetchJson(
                `${RDW_BASE}/j9yg-7rg9.json?%24where=${encodeURIComponent(
                  `referentiecode_rdw in(${uniqueRecallCodes.map((c) => `'${escapeSoql(c)}'`).join(',')})`
                )}&%24limit=50`,
                fetchImpl
              ).catch(() => [])
            : Promise.resolve([]),
        ]);

        const defectDict = {};
        for (const row of defectRows || []) {
          if (row.gebrek_identificatie && row.gebrek_omschrijving && !defectDict[row.gebrek_identificatie]) {
            defectDict[row.gebrek_identificatie] = row.gebrek_omschrijving;
          }
        }

        const recallDetailMap = {};
        for (const row of recallDetailRows || []) {
          if (row.referentiecode_rdw && !recallDetailMap[row.referentiecode_rdw]) {
            recallDetailMap[row.referentiecode_rdw] = row;
          }
        }

        const recalls = (recallsLinkArr || []).slice(0, 10).map((item) => {
          const detail = item.referentiecode_rdw ? recallDetailMap[item.referentiecode_rdw] : null;
          const isResolved = item.code_status === 'P' || /herstel gemeld/i.test(item.status || '');
          return {
            campaignId: item.referentiecode_rdw || item.referentiecode_producent || 'NL-RECALL',
            manufacturerCode: detail?.referentiecode_producent || null,
            date: formatRdwDate(detail?.publicatiedatum_rdw),
            source: 'Registre ouvert néerlandais (Open Data CC0)',
            status: isResolved ? 'resolved' : 'open',
            statusLabel: isResolved
              ? 'Corrigé (déclaré par le constructeur)'
              : 'Rappel ouvert — intervention requise',
            component: detail?.categorie_defect || 'Rappel constructeur',
            description: detail?.omschrijving_defect || item.status || 'Campagne de rappel constructeur',
            risk: detail?.materiele_gevolgen || null,
          };
        });

        const defectsByDate = new Map();
        for (const d of defectsArr) {
          const dateStr = formatRdwDate(d.meld_datum_door_keuringsinstantie);
          if (!dateStr) continue;
          const list = defectsByDate.get(dateStr) || [];
          const rawDesc = defectDict[d.gebrek_identificatie];
          list.push({
            code: d.gebrek_identificatie,
            count: Number(d.aantal_gebreken_geconstateerd || 1),
            description: translateDutchDefect(rawDesc),
            rawDescription: rawDesc || `Code défaut ${d.gebrek_identificatie}`,
          });
          defectsByDate.set(dateStr, list);
        }

        const seenDates = new Set();
        const inspections = [];
        for (const row of apkArr) {
          const date = formatRdwDate(row.meld_datum_door_keuringsinstantie);
          if (!date || seenDates.has(date)) continue;
          seenDates.add(date);
          const defs = defectsByDate.get(date) || [];
          inspections.push({
            date,
            country: 'NL',
            type: row.soort_erkenning_omschrijving || 'Contrôle technique APK',
            result: defs.length > 0 ? 'Favorable avec remarques / défauts consignés' : 'Favorable',
            passed: true,
            mileageKm: null,
            defects: defs,
          });
        }

        for (const [date, defs] of defectsByDate.entries()) {
          if (!seenDates.has(date)) {
            inspections.push({
              date,
              country: 'NL',
              type: 'Contrôle technique APK (défauts relevés)',
              result: 'Défauts signalés lors du contrôle',
              passed: true,
              mileageKm: null,
              defects: defs,
            });
          }
        }
        inspections.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        const firstAdmissionDate = formatRdwDate(core.datum_eerste_toelating);
        const firstAdmissionNlDate = formatRdwDate(core.datum_eerste_tenaamstelling_in_nederland);
        const lastRegistrationDate = formatRdwDate(core.datum_tenaamstelling);
        const apkExpiryDate = formatRdwDate(core.vervaldatum_apk);
        const isImportedToNl = Boolean(
          firstAdmissionDate && firstAdmissionNlDate && firstAdmissionDate !== firstAdmissionNlDate
        );

        const fuelPrimary = NL_FUEL_MAP[fuel.brandstof_omschrijving] || fuel.brandstof_omschrijving || null;
        const fuelSecLabel = fuelSecondary
          ? NL_FUEL_MAP[fuelSecondary.brandstof_omschrijving] || fuelSecondary.brandstof_omschrijving
          : null;
        const fuelLabel = fuelSecLabel && fuelSecLabel !== fuelPrimary ? `${fuelPrimary} / ${fuelSecLabel}` : fuelPrimary;

        const odometerJudgement = mapOdometerJudgement(core.tellerstandoordeel);
        const wokRaw = core.wacht_op_keuren || '';
        const hasActiveWok = /^ja$/i.test(wokRaw.trim());
        const wokKnown = /^ja$|^nee$/i.test(wokRaw.trim());

        recordConnectorMetric('nl_open_data', 'online', performance.now() - startedAt, `${core.merk} ${core.handelsbenaming}`);

        return {
          found: true,
          plate: core.kenteken,
          latencyMs: Math.round(performance.now() - startedAt),
          vehicle: {
            make: core.merk || 'Inconnu',
            model: core.handelsbenaming || 'Modèle non renseigné',
            year: firstAdmissionDate ? Number(firstAdmissionDate.slice(0, 4)) : null,
            firstRegistrationDate: firstAdmissionDate,
            firstRegistrationLocalDate: firstAdmissionNlDate,
            lastRegistrationChangeDate: lastRegistrationDate,
            apkExpiryDate,
            vehicleCategory: core.europese_voertuigcategorie || core.voertuigsoort || 'M1',
            bodyType: NL_BODY_MAP[core.inrichting] || core.inrichting || null,
            color: NL_COLOR_MAP[core.eerste_kleur] || core.eerste_kleur || null,
            seats: core.aantal_zitplaatsen ? Number(core.aantal_zitplaatsen) : null,
            doors: core.aantal_deuren ? Number(core.aantal_deuren) : null,
            cylinders: core.aantal_cilinders ? Number(core.aantal_cilinders) : null,
            displacementCC: core.cilinderinhoud ? Number(core.cilinderinhoud) : null,
            curbWeightKg: core.massa_ledig_voertuig ? Number(core.massa_ledig_voertuig) : null,
            catalogPriceEur: core.catalogusprijs ? Number(core.catalogusprijs) : null,
            fuelType: fuelLabel,
            co2Gkm: fuel.co2_uitstoot_gecombineerd ? Number(fuel.co2_uitstoot_gecombineerd) : null,
            consumptionCombinedL100: fuel.brandstofverbruik_gecombineerd
              ? Number(fuel.brandstofverbruik_gecombineerd)
              : null,
            euroClass: fuel.emissiecode_omschrijving ? `Euro ${fuel.emissiecode_omschrijving}` : null,
            powerKw: fuel.nettomaximumvermogen ? Math.round(Number(fuel.nettomaximumvermogen)) : null,
            powerHp: fuel.nettomaximumvermogen ? Math.round(Number(fuel.nettomaximumvermogen) * 1.35962) : null,
          },
          odometerJudgement,
          administrative: {
            insuredWam: core.wam_verzekerd === 'Ja' ? true : core.wam_verzekerd === 'Nee' ? false : null,
            exported: core.export_indicator === 'Ja',
            taxiUse: core.taxi_indicator === 'Ja',
            openRecallFlag: core.openstaande_terugroepactie_indicator === 'Ja',
            hasActiveWok,
            wokStatus: hasActiveWok
              ? 'WOK actif — Véhicule interdit de circulation jusqu’à contre-expertise'
              : wokKnown
                ? 'Aucune interdiction WOK'
                : 'Non communiqué en Open Data',
            importedIntoCountry: isImportedToNl,
            importNote: isImportedToNl
              ? `Importé aux Pays-Bas le ${firstAdmissionNlDate} (1re mise en circulation internationale le ${firstAdmissionDate}).`
              : 'Immatriculé d’origine aux Pays-Bas.',
            verifiedFields: {
              stolen: false,
              pledge: false,
              opposition: false,
              vgeProcedure: wokKnown,
              veiProcedure: wokKnown,
              wokStatus: wokKnown,
              insuredWam: core.wam_verzekerd === 'Ja' || core.wam_verzekerd === 'Nee',
            },
          },
          inspections,
          recalls,
        };
      },
    });

    return result;
  } catch (err) {
    recordConnectorMetric('nl_open_data', 'error', performance.now() - startedAt, err.message);
    return {
      found: false,
      plate,
      error: err.message,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
