import { recordConnectorMetric } from '../db/repositories.js';
import { getCachedOrFetch, CACHE_TTLS } from '../services/apiCache.js';

/**
 * Comprehensive European & Global WMI (World Manufacturer Identifier) lookup table (145+ entries)
 */
const WMI_MANUFACTURERS = {
  // France
  VF1: { make: 'Renault', country: 'France', countryCode: 'FR' },
  VF2: { make: 'Renault', country: 'France', countryCode: 'FR' },
  VF3: { make: 'Peugeot', country: 'France', countryCode: 'FR' },
  VF4: { make: 'Talbot', country: 'France', countryCode: 'FR' },
  VF6: { make: 'Renault Trucks', country: 'France', countryCode: 'FR' },
  VF7: { make: 'Citroën', country: 'France', countryCode: 'FR' },
  VF8: { make: 'Matra', country: 'France', countryCode: 'FR' },
  VF9: { make: 'Bugatti', country: 'France', countryCode: 'FR' },
  VR1: { make: 'DS Automobiles', country: 'France', countryCode: 'FR' },
  VR3: { make: 'Peugeot', country: 'France', countryCode: 'FR' },
  VR7: { make: 'Citroën', country: 'France', countryCode: 'FR' },
  VXK: { make: 'Opel', country: 'France', countryCode: 'FR' },
  VXE: { make: 'Opel Utilitaires', country: 'France', countryCode: 'FR' },
  VNK: { make: 'Toyota', country: 'France', countryCode: 'FR' },
  VN1: { make: 'Renault / Nissan', country: 'France', countryCode: 'FR' },
  VG6: { make: 'Renault Trucks', country: 'France', countryCode: 'FR' },
  VFA: { make: 'Alpine', country: 'France', countryCode: 'FR' },

  // Allemagne
  WVW: { make: 'Volkswagen', country: 'Allemagne', countryCode: 'DE' },
  WV1: { make: 'Volkswagen Utilitaires', country: 'Allemagne', countryCode: 'DE' },
  WV2: { make: 'Volkswagen Utilitaires', country: 'Allemagne', countryCode: 'DE' },
  WVG: { make: 'Volkswagen', country: 'Allemagne', countryCode: 'DE' },
  WAU: { make: 'Audi', country: 'Allemagne', countryCode: 'DE' },
  WUA: { make: 'Audi Sport', country: 'Allemagne', countryCode: 'DE' },
  WBA: { make: 'BMW', country: 'Allemagne', countryCode: 'DE' },
  WBS: { make: 'BMW M', country: 'Allemagne', countryCode: 'DE' },
  WBY: { make: 'BMW i', country: 'Allemagne', countryCode: 'DE' },
  WBX: { make: 'BMW', country: 'Allemagne', countryCode: 'DE' },
  WDB: { make: 'Mercedes-Benz', country: 'Allemagne', countryCode: 'DE' },
  WDD: { make: 'Mercedes-Benz', country: 'Allemagne', countryCode: 'DE' },
  WDC: { make: 'Mercedes-Benz', country: 'Allemagne', countryCode: 'DE' },
  WDF: { make: 'Mercedes-Benz', country: 'Allemagne', countryCode: 'DE' },
  W1K: { make: 'Mercedes-Benz', country: 'Allemagne', countryCode: 'DE' },
  W1N: { make: 'Mercedes-Benz', country: 'Allemagne', countryCode: 'DE' },
  W1V: { make: 'Mercedes-Benz Utilitaires', country: 'Allemagne', countryCode: 'DE' },
  WME: { make: 'Smart', country: 'Allemagne', countryCode: 'DE' },
  WP0: { make: 'Porsche', country: 'Allemagne', countryCode: 'DE' },
  WP1: { make: 'Porsche', country: 'Allemagne', countryCode: 'DE' },
  W0L: { make: 'Opel', country: 'Allemagne', countryCode: 'DE' },
  W0V: { make: 'Opel', country: 'Allemagne', countryCode: 'DE' },
  WF0: { make: 'Ford Europe', country: 'Allemagne', countryCode: 'DE' },
  WMW: { make: 'MINI', country: 'Allemagne', countryCode: 'DE' },
  XP7: { make: 'Tesla', country: 'Allemagne', countryCode: 'DE' },
  WMA: { make: 'MAN', country: 'Allemagne', countryCode: 'DE' },

  // Italie
  ZFA: { make: 'Fiat', country: 'Italie', countryCode: 'IT' },
  ZFC: { make: 'Fiat Utilitaires', country: 'Italie', countryCode: 'IT' },
  ZAR: { make: 'Alfa Romeo', country: 'Italie', countryCode: 'IT' },
  ZLA: { make: 'Lancia', country: 'Italie', countryCode: 'IT' },
  ZFF: { make: 'Ferrari', country: 'Italie', countryCode: 'IT' },
  ZHW: { make: 'Lamborghini', country: 'Italie', countryCode: 'IT' },
  ZAM: { make: 'Maserati', country: 'Italie', countryCode: 'IT' },
  ZAC: { make: 'Jeep', country: 'Italie', countryCode: 'IT' },
  ZCF: { make: 'Iveco', country: 'Italie', countryCode: 'IT' },
  ZAP: { make: 'Piaggio', country: 'Italie', countryCode: 'IT' },

  // Espagne
  VSS: { make: 'SEAT / CUPRA', country: 'Espagne', countryCode: 'ES' },
  VS6: { make: 'Ford Espagne', country: 'Espagne', countryCode: 'ES' },
  VS7: { make: 'Citroën Espagne', country: 'Espagne', countryCode: 'ES' },
  VSK: { make: 'Nissan Espagne', country: 'Espagne', countryCode: 'ES' },
  VSX: { make: 'Opel Espagne', country: 'Espagne', countryCode: 'ES' },
  VSE: { make: 'Santana / Suzuki Espagne', country: 'Espagne', countryCode: 'ES' },

  // Royaume-Uni
  SAL: { make: 'Land Rover', country: 'Royaume-Uni', countryCode: 'GB' },
  SAJ: { make: 'Jaguar', country: 'Royaume-Uni', countryCode: 'GB' },
  SAR: { make: 'Rover / MG', country: 'Royaume-Uni', countryCode: 'GB' },
  SB1: { make: 'Toyota UK', country: 'Royaume-Uni', countryCode: 'GB' },
  SCC: { make: 'Lotus', country: 'Royaume-Uni', countryCode: 'GB' },
  SCF: { make: 'Aston Martin', country: 'Royaume-Uni', countryCode: 'GB' },
  SCB: { make: 'Bentley', country: 'Royaume-Uni', countryCode: 'GB' },
  SCA: { make: 'Rolls-Royce', country: 'Royaume-Uni', countryCode: 'GB' },
  SBM: { make: 'McLaren', country: 'Royaume-Uni', countryCode: 'GB' },
  SHH: { make: 'Honda UK', country: 'Royaume-Uni', countryCode: 'GB' },
  SHS: { make: 'Honda UK', country: 'Royaume-Uni', countryCode: 'GB' },
  SJN: { make: 'Nissan UK', country: 'Royaume-Uni', countryCode: 'GB' },
  SFD: { make: 'Vauxhall', country: 'Royaume-Uni', countryCode: 'GB' },

  // Europe Centrale, Benelux & Nordique
  TMB: { make: 'Škoda', country: 'République tchèque', countryCode: 'CZ' },
  TMA: { make: 'Hyundai', country: 'République tchèque', countryCode: 'CZ' },
  TM9: { make: 'Škoda', country: 'République tchèque', countryCode: 'CZ' },
  U5Y: { make: 'Kia', country: 'Slovaquie', countryCode: 'SK' },
  U6Y: { make: 'Kia', country: 'Slovaquie', countryCode: 'SK' },
  UU1: { make: 'Dacia', country: 'Roumanie', countryCode: 'RO' },
  YV1: { make: 'Volvo', country: 'Suède', countryCode: 'SE' },
  YV4: { make: 'Volvo', country: 'Suède', countryCode: 'SE' },
  YV3: { make: 'Volvo Bus', country: 'Suède', countryCode: 'SE' },
  YS3: { make: 'Saab', country: 'Suède', countryCode: 'SE' },
  YS2: { make: 'Scania', country: 'Suède', countryCode: 'SE' },
  TRU: { make: 'Audi Hongrie', country: 'Hongrie', countryCode: 'HU' },
  TSM: { make: 'Suzuki Hongrie', country: 'Hongrie', countryCode: 'HU' },
  SUP: { make: 'Opel Pologne', country: 'Pologne', countryCode: 'PL' },
  SUF: { make: 'Fiat Pologne', country: 'Pologne', countryCode: 'PL' },
  XLR: { make: 'DAF', country: 'Pays-Bas', countryCode: 'NL' },
  XL9: { make: 'Spyker / NL', country: 'Pays-Bas', countryCode: 'NL' },
  XTA: { make: 'Lada', country: 'Russie', countryCode: 'RU' },
  YB1: { make: 'Volvo Belgique', country: 'Belgique', countryCode: 'BE' },
  VA0: { make: 'Magna Steyr', country: 'Autriche', countryCode: 'AT' },
  NLH: { make: 'Hyundai', country: 'Turquie', countryCode: 'TR' },
  NMT: { make: 'Toyota', country: 'Turquie', countryCode: 'TR' },
  NM0: { make: 'Ford Otosan', country: 'Turquie', countryCode: 'TR' },
  NM4: { make: 'Tofaş / Fiat Turquie', country: 'Turquie', countryCode: 'TR' },

  // Japon / Corée / USA / Chine / Mexique / Canada
  JTD: { make: 'Toyota', country: 'Japon', countryCode: 'JP' },
  JTM: { make: 'Toyota', country: 'Japon', countryCode: 'JP' },
  JTE: { make: 'Toyota', country: 'Japon', countryCode: 'JP' },
  JTH: { make: 'Lexus', country: 'Japon', countryCode: 'JP' },
  JTJ: { make: 'Lexus', country: 'Japon', countryCode: 'JP' },
  JHM: { make: 'Honda', country: 'Japon', countryCode: 'JP' },
  JMZ: { make: 'Mazda', country: 'Japon', countryCode: 'JP' },
  JM1: { make: 'Mazda', country: 'Japon', countryCode: 'JP' },
  JN1: { make: 'Nissan', country: 'Japon', countryCode: 'JP' },
  JF1: { make: 'Subaru', country: 'Japon', countryCode: 'JP' },
  JF2: { make: 'Subaru', country: 'Japon', countryCode: 'JP' },
  JS1: { make: 'Suzuki', country: 'Japon', countryCode: 'JP' },
  JSA: { make: 'Suzuki', country: 'Japon', countryCode: 'JP' },
  JMB: { make: 'Mitsubishi', country: 'Japon', countryCode: 'JP' },
  JA3: { make: 'Mitsubishi', country: 'Japon', countryCode: 'JP' },
  KMH: { make: 'Hyundai', country: 'Corée du Sud', countryCode: 'KR' },
  KM8: { make: 'Hyundai', country: 'Corée du Sud', countryCode: 'KR' },
  KNA: { make: 'Kia', country: 'Corée du Sud', countryCode: 'KR' },
  KND: { make: 'Kia', country: 'Corée du Sud', countryCode: 'KR' },
  KNM: { make: 'Renault Samsung', country: 'Corée du Sud', countryCode: 'KR' },
  KPT: { make: 'SsangYong / KGM', country: 'Corée du Sud', countryCode: 'KR' },
  '5YJ': { make: 'Tesla', country: 'États-Unis', countryCode: 'US' },
  '7SA': { make: 'Tesla', country: 'États-Unis', countryCode: 'US' },
  '1FA': { make: 'Ford', country: 'États-Unis', countryCode: 'US' },
  '1FT': { make: 'Ford', country: 'États-Unis', countryCode: 'US' },
  '1G1': { make: 'Chevrolet', country: 'États-Unis', countryCode: 'US' },
  '1C4': { make: 'Jeep', country: 'États-Unis', countryCode: 'US' },
  '5UX': { make: 'BMW USA', country: 'États-Unis', countryCode: 'US' },
  '4JG': { make: 'Mercedes-Benz USA', country: 'États-Unis', countryCode: 'US' },
  '1HG': { make: 'Honda USA', country: 'États-Unis', countryCode: 'US' },
  '2T1': { make: 'Toyota Canada', country: 'Canada', countryCode: 'CA' },
  '3VW': { make: 'Volkswagen Mexique', country: 'Mexique', countryCode: 'MX' },
  '3MW': { make: 'BMW Mexique', country: 'Mexique', countryCode: 'MX' },
  LRW: { make: 'Tesla', country: 'Chine', countryCode: 'CN' },
  LSJ: { make: 'MG Motor', country: 'Chine', countryCode: 'CN' },
  LGX: { make: 'BYD', country: 'Chine', countryCode: 'CN' },
  LC0: { make: 'BYD', country: 'Chine', countryCode: 'CN' },
  LVV: { make: 'Chery', country: 'Chine', countryCode: 'CN' },
  LPS: { make: 'Polestar', country: 'Chine', countryCode: 'CN' },
  L6T: { make: 'Geely / Lynk & Co', country: 'Chine', countryCode: 'CN' },
  LNB: { make: 'BAIC', country: 'Chine', countryCode: 'CN' },
  LFV: { make: 'FAW-Volkswagen', country: 'Chine', countryCode: 'CN' },
  LSV: { make: 'SAIC-Volkswagen', country: 'Chine', countryCode: 'CN' },
  LBV: { make: 'BMW Brilliance', country: 'Chine', countryCode: 'CN' },
  LDC: { make: 'Dongfeng Peugeot-Citroën', country: 'Chine', countryCode: 'CN' },
  LSG: { make: 'SAIC-GM', country: 'Chine', countryCode: 'CN' },
  MA1: { make: 'Mahindra', country: 'Inde', countryCode: 'IN' },
  MMB: { make: 'Mitsubishi Thaïlande', country: 'Thaïlande', countryCode: 'TH' },
  MNB: { make: 'Ford Thaïlande', country: 'Thaïlande', countryCode: 'TH' },
};

const YEAR_CODES_MODERN = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
  T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
  1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005, 6: 2006, 7: 2007, 8: 2008, 9: 2009,
};

const TRANSLITERATION = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isLikelyVin(raw) {
  const cleaned = normalizeVin(raw);
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned);
}

export function validateVinCheckDigit(rawVin) {
  const vin = normalizeVin(rawVin);
  if (!isLikelyVin(vin)) {
    return { valid: false, expected: null, actual: null };
  }
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const val = TRANSLITERATION[vin[i]];
    if (val === undefined) return { valid: false, expected: null, actual: vin[8] };
    sum += val * WEIGHTS[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? 'X' : String(rem);
  return {
    valid: vin[8] === expected,
    expected,
    actual: vin[8],
  };
}

function decodeWmiRegion(firstChar, wmi) {
  if (WMI_MANUFACTURERS[wmi]) {
    return WMI_MANUFACTURERS[wmi];
  }
  const two = wmi.slice(0, 2);
  if (two >= 'VF' && two <= 'VR') return { make: 'Constructeur français', country: 'France', countryCode: 'FR' };
  if (two >= 'VS' && two <= 'VW') return { make: 'Constructeur espagnol', country: 'Espagne', countryCode: 'ES' };
  if (firstChar === 'W') return { make: 'Constructeur allemand', country: 'Allemagne', countryCode: 'DE' };
  if (firstChar === 'Z') return { make: 'Constructeur italien', country: 'Italie', countryCode: 'IT' };
  if (two >= 'SA' && two <= 'SM') return { make: 'Constructeur britannique', country: 'Royaume-Uni', countryCode: 'GB' };
  if (two >= 'YS' && two <= 'YW') return { make: 'Constructeur suédois', country: 'Suède', countryCode: 'SE' };
  if (two >= 'XL' && two <= 'XR') return { make: 'Constructeur néerlandais', country: 'Pays-Bas', countryCode: 'NL' };
  if (two >= 'TJ' && two <= 'TP') return { make: 'Constructeur tchèque', country: 'République tchèque', countryCode: 'CZ' };
  if (firstChar === 'J') return { make: 'Constructeur japonais', country: 'Japon', countryCode: 'JP' };
  if (firstChar === 'K') return { make: 'Constructeur coréen', country: 'Corée du Sud', countryCode: 'KR' };
  if (firstChar === 'L') return { make: 'Constructeur chinois', country: 'Chine', countryCode: 'CN' };
  if (['1', '4', '5', '7'].includes(firstChar)) return { make: 'Constructeur américain', country: 'États-Unis', countryCode: 'US' };
  if (firstChar === '2') return { make: 'Constructeur canadien', country: 'Canada', countryCode: 'CA' };
  if (firstChar === '3') return { make: 'Constructeur mexicain', country: 'Mexique', countryCode: 'MX' };
  return { make: 'Constructeur international', country: 'Europe / International', countryCode: 'EU' };
}

export function decodeVinLocal(rawVin) {
  const vin = normalizeVin(rawVin);
  const validFormat = isLikelyVin(vin);
  if (!validFormat) {
    return {
      validFormat: false,
      vin,
      error: 'Un numéro VIN valide comporte exactement 17 caractères alphanumériques (sans I, O ni Q).',
    };
  }

  const wmi = vin.slice(0, 3);
  const vds = vin.slice(3, 9);
  const vis = vin.slice(9, 17);
  const yearChar = vin[9];
  const plantCode = vin[10];
  const serialNumber = vin.slice(11, 17);
  const regionInfo = decodeWmiRegion(vin[0], wmi);
  const checkDigit = validateVinCheckDigit(vin);

  const isEuropeanStandard = ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].includes(vin[0]);
  const currentYear = new Date().getFullYear();

  // Handle ISO 3779 30-year cycle: if pos 7 is digit, pre-2010 cycle may apply;
  // also European makers (e.g. Renault/Peugeot/Fiat/Ford EU) often put '0' or non-year code in pos 10.
  let modelYear = YEAR_CODES_MODERN[yearChar] || null;
  let yearReliable = Boolean(modelYear);

  if (yearChar === '0') {
    modelYear = null;
    yearReliable = false;
  } else if (modelYear && modelYear > currentYear + 1) {
    // 30-year wrap back (e.g. 'W' = 1998 rather than 2028)
    modelYear -= 30;
  }

  // European OEMs that don't always encode model year at pos 10
  if (isEuropeanStandard && ['VF1', 'VF3', 'VF7', 'ZFA', 'WDB', 'WDD', 'WBA'].includes(wmi) && !checkDigit.valid) {
    yearReliable = false;
  }

  return {
    validFormat: true,
    vin,
    anatomy: {
      wmi,
      vds,
      vis,
      checkDigitChar: vin[8],
      yearChar,
      plantCode,
      serialNumber,
    },
    checkDigit: {
      ...checkDigit,
      note: checkDigit.valid
        ? 'Clé de contrôle ISO 3779 conforme'
        : isEuropeanStandard
          ? 'VIN européen : la position 9 n’est pas toujours utilisée comme clé de contrôle obligatoire dans l’UE (contrairement aux normes US).'
          : 'Clé de contrôle non concordante — vérifiez la frappe sur la carte grise (champ E).',
    },
    make: regionInfo.make,
    assemblyCountry: regionInfo.country,
    assemblyCountryCode: regionInfo.countryCode,
    estimatedYear: modelYear,
    yearReliable,
  };
}

const FUEL_TRANSLATIONS = {
  Gasoline: 'Essence',
  Diesel: 'Diesel',
  Electric: 'Électrique',
  'Plug-in Hybrid': 'Hybride rechargeable',
  Hybrid: 'Hybride',
  'Compressed Natural Gas (CNG)': 'GNV',
  'Liquefied Petroleum Gas (propane or LPG)': 'GPL',
  'Flexible Fuel Vehicle (FFV)': 'Superéthanol E85 / FlexFuel',
};

const BODY_TRANSLATIONS = {
  'Sedan/Saloon': 'Berline',
  'Hatchback/Liftback/Notchback': 'Berline compacte / Hayon',
  'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)': 'SUV / Crossover',
  Wagon: 'Break',
  Coupe: 'Coupé',
  'Convertible/Cabriolet': 'Cabriolet',
  Minivan: 'Monospace',
  'Cargo Van': 'Fourgon utilitaire',
  Pickup: 'Pick-up',
};

export async function decodeVinEnriched(rawVin, fetchImpl = globalThis.fetch) {
  const local = decodeVinLocal(rawVin);
  if (!local.validFormat) return local;

  const startedAt = performance.now();
  try {
    const { data: vpicResult } = await getCachedOrFetch({
      cacheKey: `vpic:${local.vin}`,
      provider: 'nhtsa_vpic',
      ttlMs: CACHE_TTLS.vpic,
      fetcher: async () => {
        const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(local.vin)}?format=json`;
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const row = payload?.Results?.[0];
        const latency = performance.now() - startedAt;

        if (!row || (!row.Make && !row.Model && !row.Manufacturer)) {
          recordConnectorMetric('nhtsa_vpic', 'partial', latency, 'VIN décodé localement, peu de champs vPIC');
          return { vpicConnected: true, vpicSpecs: null };
        }

        recordConnectorMetric('nhtsa_vpic', 'online', latency, `${row.Make || ''} ${row.Model || ''}`.trim());
        const clean = (val) => (val && val !== 'Not Applicable' && val !== '0' ? String(val).trim() : null);

        const vpicSpecs = {
          make: clean(row.Make),
          manufacturer: clean(row.Manufacturer),
          model: clean(row.Model),
          trim: clean(row.Trim) || clean(row.Series),
          modelYear: clean(row.ModelYear) ? Number(row.ModelYear) : null,
          bodyClass: BODY_TRANSLATIONS[clean(row.BodyClass)] || clean(row.BodyClass),
          doors: clean(row.Doors) ? Number(row.Doors) : null,
          fuelType: FUEL_TRANSLATIONS[clean(row.FuelTypePrimary)] || clean(row.FuelTypePrimary),
          fuelSecondary: FUEL_TRANSLATIONS[clean(row.FuelTypeSecondary)] || clean(row.FuelTypeSecondary),
          engineCylinders: clean(row.EngineCylinders) ? Number(row.EngineCylinders) : null,
          displacementL: clean(row.DisplacementL) ? Number(Number(row.DisplacementL).toFixed(1)) : null,
          displacementCC: clean(row.DisplacementCC) ? Math.round(Number(row.DisplacementCC)) : null,
          engineHP: clean(row.EngineHP) ? Math.round(Number(row.EngineHP)) : null,
          engineKW: clean(row.EngineKW) ? Math.round(Number(row.EngineKW)) : null,
          transmission: clean(row.TransmissionStyle),
          driveType: clean(row.DriveType),
          plantCity: clean(row.PlantCity),
          plantCountry: clean(row.PlantCountry),
          vehicleType: clean(row.VehicleType),
          safety: {
            abs: clean(row.ABS),
            esc: clean(row.ESC),
            airbagsFront: clean(row.AirBagLocFront),
            airbagsSide: clean(row.AirBagLocSide),
            airbagsCurtain: clean(row.AirBagLocCurtain),
            tpms: clean(row.TPMS),
          },
        };

        return { vpicConnected: true, vpicSpecs };
      },
    });

    const vpicSpecs = vpicResult?.vpicSpecs || null;
    return {
      ...local,
      make: vpicSpecs?.make || local.make,
      model: vpicSpecs?.model || null,
      year: vpicSpecs?.modelYear || local.estimatedYear,
      yearReliable: Boolean(vpicSpecs?.modelYear || local.yearReliable),
      vpicConnected: Boolean(vpicResult?.vpicConnected),
      vpicSpecs,
    };
  } catch (err) {
    recordConnectorMetric('nhtsa_vpic', 'degraded', performance.now() - startedAt, err.message);
    return {
      ...local,
      vpicConnected: false,
      vpicError: err.message,
      vpicSpecs: null,
    };
  }
}
