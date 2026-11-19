import { withTransaction } from '../db/index.js';
import {
  saveReport,
  insertReport,
  runWithoutAutoSave,
  findUserReportByNormalizedKey,
  getUserCreditsBalance,
  adjustUserCreditsAtomic,
} from '../db/repositories.js';
import { AppError } from '../middleware/security.js';
import { decodeVinEnriched, decodeVinLocal, isLikelyVin } from '../providers/vinDecoder.js';
import { lookupNetherlandsOpenData, isLikelyDutchPlate } from '../providers/rdwProvider.js';
import { fetchRappelConsoRecalls, fetchNhtsaRecalls } from '../providers/recallsProvider.js';
import {
  lookupUkMotHistory,
  lookupNorwayVegvesen,
  lookupFranceSivB2B,
  getEuropeanRegistriesCatalog,
} from '../providers/euRegistries.js';
import { parseHistovecInput } from '../providers/histovecParser.js';
import { findDemoCase } from '../providers/demoCases.js';

/**
 * Auto-detects whether user typed a 17-char VIN or a national license plate
 * while avoiding false French formatting on Italian / German / Spanish plates.
 */
export function detectQueryType(rawQuery, requestedCountry = 'AUTO') {
  const cleaned = String(rawQuery || '').trim().toUpperCase();
  const alnum = cleaned.replace(/[^A-Z0-9]/g, '');

  if (isLikelyVin(alnum)) {
    return {
      queryType: 'vin',
      normalized: alnum,
      normalizedKey: `VIN:${alnum}`,
      detectedCountry: requestedCountry !== 'AUTO' ? requestedCountry : 'EU',
    };
  }

  const isFrenchSiv = /^[A-Z]{2}[-]?\d{3}[-]?[A-Z]{2}$/.test(cleaned) || /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(alnum);
  const isUkPlate = /^[A-Z]{2}\d{2}\s?[A-Z]{3}$/.test(cleaned);
  const isBePlate = /^[12][-]?[A-Z]{3}[-]?\d{3}$/.test(cleaned);
  const isEsPlate = /^\d{4}\s?[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(cleaned);
  const isDePlate = /^[A-ZÄÖÜ]{1,3}[-\s][A-Z]{1,2}\s?\d{1,4}[EH]?$/.test(cleaned);
  const isNoPlate = /^[A-Z]{2}\s?\d{5}$/.test(cleaned);

  let detectedCountry = requestedCountry;
  if (requestedCountry === 'AUTO') {
    if (isBePlate) detectedCountry = 'BE';
    else if (isUkPlate) detectedCountry = 'GB';
    else if (isEsPlate) detectedCountry = 'ES';
    else if (isNoPlate) detectedCountry = 'NO';
    else if (isDePlate) detectedCountry = 'DE';
    else if (isFrenchSiv) detectedCountry = 'FR';
    else if (isLikelyDutchPlate(alnum)) detectedCountry = 'NL';
    else detectedCountry = 'FR';
  }

  // Only format as AA-123-AA when country is actually France (not Italy!)
  const formattedPlate =
    detectedCountry === 'FR' && isFrenchSiv
      ? `${alnum.slice(0, 2)}-${alnum.slice(2, 5)}-${alnum.slice(5, 7)}`
      : cleaned;

  return {
    queryType: 'plate',
    normalized: alnum,
    normalizedKey: `PLATE:${detectedCountry}:${alnum}`,
    formattedPlate,
    detectedCountry,
  };
}

/**
 * Free, public, read-only Pre-Check (0 credits) powering the 2-step CarVertical-style funnel.
 */
export function runVehiclePrecheck({ query, country = 'AUTO', userId = null }) {
  const demo = findDemoCase(query);
  if (demo) {
    const vinDecoded = decodeVinLocal(demo.vehicle.vin);
    const normalizedKey = `DEMO:${demo.key}`;
    const existing = userId ? findUserReportByNormalizedKey(userId, normalizedKey) : null;

    return {
      normalized: demo.vehicle.vin,
      normalizedKey,
      queryType: isLikelyVin(query) ? 'vin' : 'plate',
      detectedCountry: demo.country,
      isDemo: true,
      demoInfo: {
        key: demo.key,
        badge: demo.badge,
        title: demo.shortTitle,
        subtitle: demo.subtitle,
      },
      vinPreview: vinDecoded.validFormat
        ? {
            vin: vinDecoded.vin,
            validLength: true,
            checkDigitValid: vinDecoded.checkDigit.valid,
            wmi: vinDecoded.anatomy.wmi,
            make: demo.vehicle.make,
            model: demo.vehicle.model,
            assemblyCountry: vinDecoded.assemblyCountry,
            modelYear: demo.vehicle.year,
            yearReliable: true,
            anatomy: vinDecoded.anatomy,
          }
        : null,
      availableSources: [
        { name: 'Décodage VIN ISO 3779', country: 'EU', status: 'available', live: true },
        { name: 'RappelConso France (DGCCRF)', country: 'FR', status: 'available', live: true },
        { name: `Dossier de démonstration (${demo.countriesVisited.join(' → ')})`, country: demo.country, status: 'demo', live: false },
      ],
      estimatedSectionsCount: 9,
      signalTeasers: [
        { category: 'Kilométrage', label: `${demo.mileageReadings.length} relevés historiques détectés`, tone: demo.key === 'DE_FR_ROLLBACK' ? 'danger' : 'ok' },
        { category: 'Sinistres', label: demo.damages.length ? `${demo.damages.length} dossier(s) carrosserie répertorié(s)` : 'Contrôle sinistres prêt', tone: demo.damages.length ? 'warn' : 'ok' },
        { category: 'Parcours UE', label: `${demo.countriesVisited.length} pays traversé(s) (${demo.countriesVisited.join(' → ')})`, tone: demo.countriesVisited.length > 1 ? 'info' : 'ok' },
      ],
      requiresCredit: false,
      creditCost: 0,
      alreadyUnlockedReportId: existing?.id || null,
    };
  }

  const detected = detectQueryType(query, country);
  const existing = userId ? findUserReportByNormalizedKey(userId, detected.normalizedKey) : null;

  if (detected.queryType === 'vin') {
    const vinDecoded = decodeVinLocal(detected.normalized);
    if (!vinDecoded.validFormat) {
      throw new AppError(400, 'VALIDATION_ERROR', vinDecoded.error, { field: 'query' });
    }

    return {
      normalized: vinDecoded.vin,
      normalizedKey: detected.normalizedKey,
      queryType: 'vin',
      detectedCountry: detected.detectedCountry,
      isDemo: false,
      demoInfo: null,
      vinPreview: {
        vin: vinDecoded.vin,
        validLength: true,
        checkDigitValid: vinDecoded.checkDigit.valid,
        wmi: vinDecoded.anatomy.wmi,
        make: vinDecoded.make,
        model: null,
        assemblyCountry: vinDecoded.assemblyCountry,
        modelYear: vinDecoded.estimatedYear,
        yearReliable: vinDecoded.yearReliable,
        anatomy: vinDecoded.anatomy,
      },
      availableSources: [
        { name: 'Décodeur VIN ISO 3779 (145+ WMI)', country: 'EU', status: 'available', live: true },
        { name: 'NHTSA vPIC Spécifications usine', country: 'INTL', status: 'available', live: true },
        { name: 'RappelConso France (DGCCRF)', country: 'FR', status: 'available', live: true },
        { name: 'NHTSA Safety Recalls', country: 'INTL', status: 'available', live: true },
      ],
      estimatedSectionsCount: 7,
      signalTeasers: [
        { category: 'Constructeur', label: `${vinDecoded.make} — Assemblage ${vinDecoded.assemblyCountry}`, tone: 'ok' },
        { category: 'Rappels sécurité', label: 'Vérification temps réel RappelConso + NHTSA prête', tone: 'info' },
        { category: 'Historique national', label: 'Fusion HistoVec disponible gratuitement après déblocage', tone: 'info' },
      ],
      requiresCredit: !existing,
      creditCost: existing ? 0 : 1,
      alreadyUnlockedReportId: existing?.id || null,
    };
  }

  // License plate pre-check
  const isLiveRegistry =
    detected.detectedCountry === 'NL' ||
    (detected.detectedCountry === 'GB' && Boolean(process.env.UK_MOT_API_KEY)) ||
    (detected.detectedCountry === 'NO' && Boolean(process.env.NO_VEGVESEN_API_KEY)) ||
    (detected.detectedCountry === 'FR' && Boolean(process.env.FR_SIV_API_KEY && process.env.FR_SIV_API_URL));

  const registry =
    getEuropeanRegistriesCatalog({ includeInternalMeta: false }).find((r) => r.code === detected.detectedCountry) ||
    getEuropeanRegistriesCatalog({ includeInternalMeta: false })[0];

  const availableSources = isLiveRegistry
    ? [
        { name: registry.registry, country: detected.detectedCountry, status: 'available', live: true },
        { name: 'RappelConso France (DGCCRF)', country: 'FR', status: 'available', live: true },
        { name: 'NHTSA Safety Recalls', country: 'INTL', status: 'available', live: true },
      ]
    : [
        { name: registry.registry, country: detected.detectedCountry, status: 'owner_required', live: false },
      ];

  return {
    normalized: detected.formattedPlate || detected.normalized,
    normalizedKey: detected.normalizedKey,
    queryType: 'plate',
    detectedCountry: detected.detectedCountry,
    isDemo: false,
    demoInfo: null,
    vinPreview: null,
    availableSources,
    estimatedSectionsCount: isLiveRegistry ? 8 : 4,
    signalTeasers: isLiveRegistry
      ? [
          { category: `Registre ${registry.country}`, label: 'Données officielles disponibles en temps réel', tone: 'ok' },
          { category: 'Contrôles & Compteur', label: 'Contrôles techniques, défauts et jugement compteur', tone: 'info' },
          { category: 'Rappels sécurité', label: 'Vérification multi-bases incluse', tone: 'info' },
        ]
      : [
          { category: `Registre ${registry.country}`, label: 'Accès protégé : pré-rapport guidé gratuit (0 crédit)', tone: 'warn' },
          { category: 'Alternative directe', label: detected.detectedCountry === 'FR' ? 'Importez le rapport HistoVec gratuitement ou saisissez le VIN (17 car.)' : 'Saisissez le numéro VIN à 17 caractères pour le décodage live', tone: 'info' },
        ],
    requiresCredit: isLiveRegistry && !existing,
    creditCost: isLiveRegistry && !existing ? 1 : 0,
    alreadyUnlockedReportId: existing?.id || null,
  };
}

/**
 * Analyzes odometer history for rollbacks, stagnation, and annual driving pace
 */
export function analyzeMileage(readings = [], externalVerdict = null) {
  const sorted = [...readings]
    .filter((r) => r && r.date && Number.isFinite(Number(r.km)))
    .map((r) => ({ ...r, km: Number(r.km) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let rollbackDetected = false;
  let rollbackDropKm = 0;
  let rollbackEvent = null;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.km < prev.km - 500) {
      rollbackDetected = true;
      const drop = prev.km - curr.km;
      if (drop > rollbackDropKm) {
        rollbackDropKm = drop;
        rollbackEvent = {
          fromDate: prev.date,
          fromKm: prev.km,
          toDate: curr.date,
          toKm: curr.km,
          dropKm: drop,
          fromCountry: prev.country || 'EU',
          toCountry: curr.country || 'EU',
        };
      }
      curr.anomaly = true;
    }
  }

  let avgKmPerYear = null;
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const years = (new Date(last.date) - new Date(first.date)) / (1000 * 60 * 60 * 24 * 365.25);
    const totalEffectiveKm = rollbackDetected
      ? Math.max(...sorted.map((s) => s.km)) + (last.km - (rollbackEvent?.toKm || 0))
      : last.km - first.km;
    if (years > 0.25) {
      avgKmPerYear = Math.round(totalEffectiveKm / years);
    }
  }

  const latestKm = sorted.length > 0 ? sorted[sorted.length - 1].km : null;
  const maxRecordedKm = sorted.length > 0 ? Math.max(...sorted.map((s) => s.km)) : null;

  let status = 'unknown';
  let statusLabel = 'Aucun relevé kilométrique public disponible';

  if (rollbackDetected || externalVerdict?.status === 'rollback') {
    status = 'rollback';
    statusLabel = rollbackDetected
      ? `Recul kilométrique détecté (-${rollbackDropKm.toLocaleString('fr-FR')} km)`
      : externalVerdict.label;
  } else if (externalVerdict?.status === 'verified') {
    status = 'verified';
    statusLabel = externalVerdict.label;
  } else if (sorted.length >= 2) {
    status = 'verified';
    statusLabel = `Progression cohérente sur ${sorted.length} relevés vérifiés`;
  } else if (externalVerdict?.status === 'inconclusive') {
    status = 'inconclusive';
    statusLabel = externalVerdict.label;
  } else if (sorted.length === 1) {
    status = 'inconclusive';
    statusLabel = 'Un seul relevé disponible — historique insuffisant pour conclure';
  }

  return {
    status,
    statusLabel,
    rollbackDetected: status === 'rollback',
    rollbackDropKm,
    rollbackEvent,
    latestKm,
    maxRecordedKm,
    estimatedTrueKm:
      rollbackDetected && rollbackEvent && latestKm !== null
        ? maxRecordedKm + Math.max(0, latestKm - rollbackEvent.toKm)
        : latestKm,
    avgKmPerYear,
    readings: sorted,
    externalVerdict,
  };
}

/**
 * Estimates French Crit'Air sticker class based on fuel, Euro class, and year.
 * Fixed: Hybrids (e.g. "Essence / Électrique" or "Diesel / Électrique") NEVER get Crit'Air 0!
 */
export function computeCritAir({ fuelType, euroClass, year }) {
  const fuel = String(fuelType || '').toLowerCase();
  const euroNum = Number(String(euroClass || '').match(/(\d)/)?.[1] || 0);
  const y = Number(year || 0);

  const hasElectric = fuel.includes('électrique') || fuel.includes('electrique') || fuel.includes('hydrogène');
  const hasPetrol = fuel.includes('essence') || fuel.includes('benzine') || fuel.includes('éthanol');
  const hasDiesel = fuel.includes('diesel');
  const isHybrid = fuel.includes('hybride') || (hasElectric && (hasPetrol || hasDiesel));

  // Crit'Air 0 is strictly 100% electric or hydrogen (never hybrid!)
  if (hasElectric && !isHybrid) {
    return { level: 0, label: "Crit'Air 0 (100 % Électrique / Hydrogène)", color: '#1b8a5a', zfeAllowed: true };
  }

  if (fuel.includes('gpl') || fuel.includes('gnv')) {
    return { level: 1, label: "Crit'Air 1", color: '#6b3fa0', zfeAllowed: true };
  }

  if (isHybrid) {
    if (hasDiesel) {
      if (euroNum >= 5 || y >= 2011) return { level: 2, label: "Crit'Air 2 (Hybride Diesel)", color: '#d49b17', zfeAllowed: true };
      return { level: 3, label: "Crit'Air 3", color: '#d96b1f', zfeAllowed: false };
    }
    // Petrol hybrid / PHEV Euro 5-6 -> Crit'Air 1
    if (euroNum >= 5 || y >= 2011 || !y) {
      return { level: 1, label: "Crit'Air 1 (Hybride)", color: '#6b3fa0', zfeAllowed: true };
    }
    return { level: 2, label: "Crit'Air 2", color: '#d49b17', zfeAllowed: true };
  }

  if (hasPetrol) {
    if (euroNum >= 5 || y >= 2011) {
      return { level: 1, label: "Crit'Air 1", color: '#6b3fa0', zfeAllowed: true };
    }
    if (euroNum === 4 || (y >= 2006 && y <= 2010)) {
      return { level: 2, label: "Crit'Air 2", color: '#d49b17', zfeAllowed: true };
    }
    if (euroNum >= 2 || (y >= 1997 && y <= 2005)) {
      return { level: 3, label: "Crit'Air 3", color: '#d96b1f', zfeAllowed: false };
    }
    return { level: 6, label: 'Non classé', color: '#64748b', zfeAllowed: false };
  }

  if (hasDiesel) {
    if (euroNum >= 5 || y >= 2011) {
      return { level: 2, label: "Crit'Air 2", color: '#d49b17', zfeAllowed: true };
    }
    if (euroNum === 4 || (y >= 2006 && y <= 2010)) {
      return { level: 3, label: "Crit'Air 3", color: '#d96b1f', zfeAllowed: false };
    }
    if (euroNum === 3 || (y >= 2001 && y <= 2005)) {
      return { level: 4, label: "Crit'Air 4", color: '#8f2d3b', zfeAllowed: false };
    }
    if (euroNum === 2 || (y >= 1997 && y <= 2000)) {
      return { level: 5, label: "Crit'Air 5", color: '#52525b', zfeAllowed: false };
    }
    return { level: 6, label: 'Non classé', color: '#64748b', zfeAllowed: false };
  }

  return { level: null, label: 'Non déterminé (motorisation incomplète)', color: '#64748b', zfeAllowed: null };
}

/**
 * Estimates market value & buyer negotiation leverage based on vehicle specs & findings
 */
export function estimateMarketValuation({
  catalogPriceEur,
  year,
  mileage,
  damages = [],
  usageHistory = {},
  baseOverride = null,
}) {
  const currentYear = new Date().getFullYear();
  const age = year ? Math.max(0, currentYear - Number(year)) : 6;

  let baseMid = baseOverride?.mid || null;
  let baseLow = baseOverride?.low || null;
  let baseHigh = baseOverride?.high || null;

  if (!baseMid && catalogPriceEur) {
    const retention = Math.max(0.11, Math.pow(0.84, Math.min(age, 12)) * (age > 12 ? Math.pow(0.92, age - 12) : 1));
    baseMid = Math.round((catalogPriceEur * retention) / 100) * 100;
    baseLow = Math.round((baseMid * 0.9) / 100) * 100;
    baseHigh = Math.round((baseMid * 1.1) / 100) * 100;
  }

  if (!baseMid) {
    return {
      available: false,
      note: 'Prix catalogue neuf non communiqué par les registres ouverts pour ce véhicule.',
      negotiationPoints: [],
    };
  }

  let penaltyPct = 0;
  const negotiationPoints = [];

  if (mileage?.rollbackDetected) {
    penaltyPct += 0.35;
    negotiationPoints.push({
      severity: 'critical',
      title: 'Anomalie kilométrique majeure',
      impact: '-30 % à -45 % (ou renoncer à l’achat)',
      detail: mileage.rollbackDropKm
        ? `Un recul d’au moins ${mileage.rollbackDropKm.toLocaleString('fr-FR')} km rend la valeur marchande très incertaine et constitue un motif d’annulation pour dol / tromperie.`
        : 'Le registre officiel signale un relevé compteur illogique : exigez l’ensemble des factures d’entretien datées avant toute offre.',
    });
  }

  const majorDamages = damages.filter((d) => d.severity === 'high');
  const minorDamages = damages.filter((d) => d.severity !== 'high');

  if (majorDamages.length > 0) {
    penaltyPct += 0.14 * majorDamages.length;
    const totalMax = majorDamages.reduce((acc, d) => acc + (d.estimatedCostMax || 4000), 0);
    negotiationPoints.push({
      severity: 'warning',
      title: `${majorDamages.length} sinistre(s) important(s) déclaré(s)`,
      impact: `-12 % à -18 % (réparations estimées jusqu’à ${totalMax.toLocaleString('fr-FR')} €)`,
      detail: 'Exigez les factures de carrosserie, le rapport de géométrie/marbre et vérifiez l’alignement des éléments sur place.',
    });
  } else if (minorDamages.length > 0) {
    penaltyPct += 0.04;
    negotiationPoints.push({
      severity: 'info',
      title: `${minorDamages.length} dommage(s) carrosserie mineur(s)`,
      impact: '-3 % à -5 %',
      detail: 'Vérifiez la qualité de la reprise peinture à la lumière du jour (différence de teinte ou vernis).',
    });
  }

  if (usageHistory?.taxiOrVtc) {
    penaltyPct += 0.12;
    negotiationPoints.push({
      severity: 'warning',
      title: 'Ancien usage Taxi / VTC détecté',
      impact: '-10 % à -15 %',
      detail: 'Usure urbaine accrue (embrayage/boîte auto, suspensions, sièges arrière) : vérifiez les vidanges de boîte et amortisseurs.',
    });
  }

  const cappedPenalty = Math.min(0.55, penaltyPct);
  const adjustedMid = Math.round((baseMid * (1 - cappedPenalty)) / 100) * 100;
  const adjustedLow = Math.round((baseLow * (1 - cappedPenalty)) / 100) * 100;
  const adjustedHigh = Math.round((baseHigh * (1 - cappedPenalty)) / 100) * 100;

  if (negotiationPoints.length === 0) {
    negotiationPoints.push({
      severity: 'positive',
      title: 'Historique cohérent sans pénalité majeure',
      impact: 'Prix dans la moyenne du marché',
      detail: 'Concentrez votre négociation sur les consommables à venir (pneus, freins, distribution, date du prochain contrôle technique).',
    });
  }

  return {
    available: true,
    cleanRangeEur: { low: baseLow, mid: baseMid, high: baseHigh },
    adjustedRangeEur: { low: adjustedLow, mid: adjustedMid, high: adjustedHigh },
    penaltyPercent: Math.round(cappedPenalty * 100),
    negotiationPoints,
  };
}

/**
 * Computes global 0-100 Trust Score, Risk Level, Executive Verdict, and Prioritized Alerts.
 * Includes full penalties for WOK road-ban, uninsured WAM, exported, open recalls, and failed inspections.
 */
export function evaluateTrustAndAlerts({
  mileage,
  damages = [],
  administrative = {},
  usageHistory = {},
  recalls = [],
  inspections = [],
  countriesVisited = [],
  dataCompleteness = 'full',
}) {
  let score = dataCompleteness === 'full' ? 96 : dataCompleteness === 'open_data' ? 86 : 74;
  const alerts = [];

  if (administrative.stolen) {
    score -= 60;
    alerts.push({
      severity: 'critical',
      category: 'Vol',
      title: 'Véhicule signalé volé',
      description: 'Une alerte de vol actif est recensée. N’effectuez aucune transaction et contactez les autorités.',
    });
  }

  if (mileage.rollbackDetected) {
    score -= 42;
    alerts.push({
      severity: 'critical',
      category: 'Kilométrage',
      title: mileage.rollbackDropKm
        ? `Fraude probable au compteur (-${mileage.rollbackDropKm.toLocaleString('fr-FR')} km)`
        : 'Relevé kilométrique jugé illogique',
      description: mileage.rollbackEvent
        ? `Le compteur est passé de ${mileage.rollbackEvent.fromKm.toLocaleString('fr-FR')} km (${mileage.rollbackEvent.fromDate}, ${mileage.rollbackEvent.fromCountry}) à ${mileage.rollbackEvent.toKm.toLocaleString('fr-FR')} km (${mileage.rollbackEvent.toDate}, ${mileage.rollbackEvent.toCountry}).`
        : 'Le registre officiel néerlandais indique une incohérence (Onlogisch) dans la suite des relevés kilométriques enregistrés.',
    });
  } else if (mileage.status === 'inconclusive') {
    score -= 6;
    alerts.push({
      severity: 'info',
      category: 'Kilométrage',
      title: 'Jugement kilométrique incomplet',
      description: mileage.statusLabel,
    });
  }

  if (administrative.vgeProcedure || administrative.veiProcedure || administrative.hasActiveWok) {
    score -= 30;
    alerts.push({
      severity: 'critical',
      category: 'Administratif',
      title: administrative.hasActiveWok
        ? 'Interdiction de circuler WOK active (Pays-Bas)'
        : 'Procédure VGE / VEI enregistrée',
      description: administrative.hasActiveWok
        ? 'Le véhicule fait l’objet d’un statut WOK (Wacht op Keuren) suite à un dommage majeur ou non-conformité : contre-expertise obligatoire avant remise en circulation.'
        : 'Véhicule ayant fait l’objet d’une procédure Véhicule Gravement ou Économiquement Endommagé.',
    });
  }

  if (administrative.pledge || administrative.opposition) {
    score -= 22;
    alerts.push({
      severity: 'critical',
      category: 'Gage / Opposition',
      title: 'Gage ou opposition administrative détecté',
      description: 'Le transfert de carte grise peut être bloqué tant que la mainlevée officielle n’est pas obtenue.',
    });
  }

  if (administrative.insuredWam === false) {
    score -= 10;
    alerts.push({
      severity: 'warning',
      category: 'Assurance',
      title: 'Véhicule déclaré non assuré (WAM = Non)',
      description: 'Le registre indique l’absence d’assurance responsabilité civile active (véhicule possiblement immobilisé ou en stock marchand).',
    });
  }

  if (administrative.exported) {
    score -= 8;
    alerts.push({
      severity: 'warning',
      category: 'Export',
      title: 'Véhicule radié pour exportation',
      description: 'Le véhicule a été marqué comme exporté hors de son pays d’immatriculation précédent. Vérifiez le quitus fiscal et les documents d’import.',
    });
  }

  const highDamages = damages.filter((d) => d.severity === 'high');
  const modDamages = damages.filter((d) => d.severity === 'medium');

  if (highDamages.length > 0) {
    score -= 22;
    alerts.push({
      severity: 'critical',
      category: 'Sinistres',
      title: `${highDamages.length} sinistre(s) structurel(s) ou lourd(s)`,
      description: highDamages[0].summary,
    });
  } else if (modDamages.length > 0) {
    score -= 10;
    alerts.push({
      severity: 'warning',
      category: 'Sinistres',
      title: `${modDamages.length} sinistre(s) carrosserie modéré(s)`,
      description: modDamages[0].summary,
    });
  }

  const openRecalls = recalls.filter((r) => r.status === 'open');
  if (openRecalls.length > 0 || administrative.openRecallFlag) {
    score -= 10;
    alerts.push({
      severity: 'warning',
      category: 'Sécurité',
      title:
        openRecalls.length > 0
          ? `${openRecalls.length} rappel(s) constructeur ouvert(s)`
          : 'Rappel de sécurité ouvert signalé au registre',
      description:
        openRecalls[0]
          ? `${openRecalls[0].component} : intervention gratuite à faire réaliser en concession.`
          : 'Le registre signale une campagne de rappel non encore effectuée en atelier agréé.',
    });
  }

  if (usageHistory.taxiOrVtc) {
    score -= 10;
    alerts.push({
      severity: 'warning',
      category: 'Usage antérieur',
      title: 'Usage commercial Taxi / VTC détecté',
      description: usageHistory.note || 'Véhicule enregistré comme taxi ou transport professionnel de personnes.',
    });
  }

  if (administrative.importedIntoCountry || countriesVisited.length > 1) {
    score -= 4;
    alerts.push({
      severity: 'info',
      category: 'Importation UE',
      title: 'Parcours transfrontalier européen',
      description:
        administrative.importNote ||
        `Véhicule ayant circulé dans plusieurs pays (${countriesVisited.join(' → ')}). Vérifiez la continuité entre les registres nationaux.`,
    });
  }

  const failedLatest = inspections[0]?.passed === false;
  if (failedLatest) {
    score -= 12;
    alerts.push({
      severity: 'warning',
      category: 'Contrôle technique',
      title: 'Dernier contrôle technique défavorable (contre-visite)',
      description: 'Le contrôle le plus récent présente un résultat défavorable. Exigez la preuve de contre-visite validée avant achat.',
    });
  } else {
    const recentDefectsCount = inspections[0]?.defects?.length || 0;
    if (recentDefectsCount >= 3) {
      score -= 6;
      alerts.push({
        severity: 'warning',
        category: 'Contrôle technique',
        title: `${recentDefectsCount} défauts consignés au dernier contrôle`,
        description: 'Consultez la section Contrôles Techniques ci-dessous pour vérifier si les réparations ont été effectuées.',
      });
    }
  }

  const clampedScore = Math.max(8, Math.min(98, Math.round(score)));

  let riskLevel = 'low';
  let verdict = 'Achat serein — Aucun signal rouge majeur';
  let recommendation =
    'Les sources consultées ne révèlent aucune anomalie critique. Effectuez un essai routier complet et contrôlez les factures d’entretien courantes.';

  if (clampedScore < 50 || alerts.some((a) => a.severity === 'critical')) {
    riskLevel = 'high';
    verdict = 'Risque élevé — Achat fortement déconseillé sans expertise';
    recommendation =
      'Des anomalies critiques (kilométrage, sinistre lourd ou blocage administratif) ont été détectées. Ne versez aucun acompte avant clarification complète et expertise indépendante.';
  } else if (clampedScore < 76 || alerts.some((a) => a.severity === 'warning')) {
    riskLevel = 'medium';
    verdict = 'Points de vigilance à vérifier avant d’acheter';
    recommendation =
      'Le véhicule présente des éléments nécessitant une vérification attentive (rappel ouvert, ancien usage pro, sinistre modéré ou import). Utilisez la section négociation pour ajuster votre offre.';
  }

  return {
    trustScore: clampedScore,
    riskLevel,
    summary: {
      verdict,
      recommendation,
    },
    alerts,
  };
}

/**
 * Builds the report object in-memory (does NOT deduct credits).
 */
async function buildVehicleReportObject({ query, country = 'AUTO', fetchImpl = globalThis.fetch }) {
  const trimmed = String(query || '').trim();
  if (!trimmed || trimmed.length < 4) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Veuillez saisir un numéro VIN (17 caractères) ou une plaque d’immatriculation valide.');
  }

  // 1. Showcase European demo dossiers (0 credits)
  const demo = findDemoCase(trimmed);
  if (demo) {
    const vinDecoded = decodeVinLocal(demo.vehicle.vin);
    const liveRecalls = await fetchRappelConsoRecalls(demo.vehicle.make, demo.vehicle.model.split(' ')[0], fetchImpl);
    const mileage = analyzeMileage(demo.mileageReadings);
    const allRecalls = [...demo.recalls, ...liveRecalls.slice(0, 2)];
    const critAir = computeCritAir(demo.vehicle);
    const valuation = estimateMarketValuation({
      catalogPriceEur: demo.vehicle.catalogPriceEur,
      year: demo.vehicle.year,
      mileage,
      damages: demo.damages,
      usageHistory: demo.usageHistory,
      baseOverride: demo.marketValuationBase,
    });
    const administrative = {
      ...demo.administrative,
      verifiedFields: {
        stolen: true,
        pledge: true,
        opposition: true,
        vgeProcedure: true,
        veiProcedure: true,
        wokStatus: false,
        insuredWam: true,
      },
    };
    const trust = evaluateTrustAndAlerts({
      mileage,
      damages: demo.damages,
      administrative,
      usageHistory: demo.usageHistory,
      recalls: allRecalls,
      inspections: demo.inspections,
      countriesVisited: demo.countriesVisited,
      dataCompleteness: 'full',
    });

    return {
      query: trimmed.toUpperCase(),
      normalizedKey: `DEMO:${demo.key}`,
      queryType: isLikelyVin(trimmed) ? 'vin' : 'plate',
      country: demo.country,
      dataOrigin: 'demo_enriched',
      dataOriginLabel: 'Dossier de démonstration européen (+ rappels RappelConso temps réel)',
      sourcesConsulted: [
        { name: 'Décodage VIN ISO 3779', mode: 'live', status: 'ok', detail: 'Validation structurelle & WMI' },
        { name: 'RappelConso France (DGCCRF)', mode: 'live', status: liveRecalls.length ? 'ok' : 'empty', detail: `${liveRecalls.length} fiche(s) marque en direct` },
        { name: 'Agrégation multi-pays (Scénario démo)', mode: 'demo', status: 'ok', detail: `Données de démonstration (${demo.countriesVisited.join(' + ')})` },
      ],
      vehicle: {
        ...demo.vehicle,
        critAir,
        vinAnatomy: vinDecoded.validFormat ? vinDecoded.anatomy : null,
        vinCheckDigit: vinDecoded.validFormat ? vinDecoded.checkDigit : null,
      },
      countriesVisited: demo.countriesVisited,
      ownersCount: demo.ownersCount,
      usageHistory: demo.usageHistory,
      administrative,
      mileage,
      damages: { count: demo.damages.length, records: demo.damages },
      inspections: demo.inspections,
      recalls: allRecalls,
      timeline: demo.timeline,
      valuation,
      ...trust,
    };
  }

  const detected = detectQueryType(trimmed, country);

  // 2. Live Dutch Open Data pipeline (5 datasets CC0)
  if (detected.queryType === 'plate' && detected.detectedCountry === 'NL') {
    const rdw = await lookupNetherlandsOpenData(detected.normalized, fetchImpl);
    if (rdw.error) {
      throw new AppError(
        502,
        'UPSTREAM_ERROR',
        `Le registre Open Data néerlandais n’a pas répondu à temps (${rdw.error}). Aucun crédit n’a été débité.`
      );
    }
    if (!rdw.found) {
      throw new AppError(
        404,
        'VEHICLE_NOT_FOUND',
        `Aucune immatriculation néerlandaise trouvée pour « ${detected.normalized} » dans le registre Open Data NL. Essayez par exemple 21STVK ou HSF60S.`
      );
    }

    const [rappelConso, nhtsaRecalls] = await Promise.all([
      fetchRappelConsoRecalls(rdw.vehicle.make, rdw.vehicle.model, fetchImpl),
      fetchNhtsaRecalls(rdw.vehicle.make, rdw.vehicle.model, rdw.vehicle.year, fetchImpl),
    ]);

    const allRecalls = [...rdw.recalls, ...rappelConso.slice(0, 3), ...nhtsaRecalls.slice(0, 2)];
    const mileage = analyzeMileage([], rdw.odometerJudgement);
    const critAir = computeCritAir(rdw.vehicle);
    const usageHistory = {
      taxiOrVtc: rdw.administrative.taxiUse,
      rentalOrFleet: false,
      drivingSchool: false,
      note: rdw.administrative.taxiUse
        ? 'Déclaré avec indicateur Taxi actif au registre néerlandais.'
        : 'Aucun usage taxi enregistré au registre néerlandais.',
    };

    const administrative = {
      stolen: false,
      pledge: false,
      opposition: false,
      vgeProcedure: Boolean(rdw.administrative.hasActiveWok),
      veiProcedure: false,
      hasActiveWok: Boolean(rdw.administrative.hasActiveWok),
      exported: rdw.administrative.exported,
      insuredWam: rdw.administrative.insuredWam,
      openRecallFlag: rdw.administrative.openRecallFlag,
      apkExpiryDate: rdw.vehicle.apkExpiryDate,
      wokStatus: rdw.administrative.wokStatus,
      importedIntoCountry: rdw.administrative.importedIntoCountry,
      importNote: rdw.administrative.importNote,
      verifiedFields: rdw.administrative.verifiedFields,
    };

    const countriesVisited = rdw.administrative.importedIntoCountry ? ['EU', 'NL'] : ['NL'];
    const timeline = buildTimelineFromRdw(rdw);
    const valuation = estimateMarketValuation({
      catalogPriceEur: rdw.vehicle.catalogPriceEur,
      year: rdw.vehicle.year,
      mileage,
      damages: [],
      usageHistory,
    });
    const trust = evaluateTrustAndAlerts({
      mileage,
      damages: [],
      administrative,
      usageHistory,
      recalls: allRecalls,
      inspections: rdw.inspections,
      countriesVisited,
      dataCompleteness: 'open_data',
    });

    return {
      query: rdw.plate,
      normalizedKey: detected.normalizedKey,
      queryType: 'plate',
      country: 'NL',
      dataOrigin: 'live_open_data',
      dataOriginLabel: 'Données officielles temps réel (Open Data Pays-Bas + RappelConso)',
      sourcesConsulted: [
        { name: 'Registre ouvert Pays-Bas (5 datasets CC0)', mode: 'live', status: 'ok', detail: `Réponse en ${rdw.latencyMs} ms` },
        { name: 'RappelConso France (DGCCRF)', mode: 'live', status: rappelConso.length ? 'ok' : 'empty', detail: `${rappelConso.length} fiche(s) marque` },
        { name: 'NHTSA Safety Recalls', mode: 'live', status: nhtsaRecalls.length ? 'ok' : 'empty', detail: `${nhtsaRecalls.length} campagne(s)` },
      ],
      vehicle: {
        vin: null,
        plate: rdw.plate,
        ...rdw.vehicle,
        critAir,
        vinAnatomy: null,
        vinCheckDigit: null,
      },
      countriesVisited,
      ownersCount: null,
      usageHistory,
      administrative,
      mileage,
      damages: {
        count: 0,
        records: [],
        note: 'Le registre ouvert néerlandais ne publie pas les montants de sinistres assureurs privés. Vérifiez toujours le statut WOK et les défauts APK.',
      },
      inspections: rdw.inspections,
      recalls: allRecalls,
      timeline,
      valuation,
      ...trust,
    };
  }

  // 3. Live VIN Pipeline (ISO 3779 + NHTSA vPIC + RappelConso + NHTSA Recalls + optional UK MOT / NO Vegvesen by VIN)
  if (detected.queryType === 'vin') {
    const vinData = await decodeVinEnriched(detected.normalized, fetchImpl);
    if (!vinData.validFormat) {
      throw new AppError(400, 'VALIDATION_ERROR', vinData.error, { field: 'query' });
    }

    const specs = vinData.vpicSpecs || {};
    const make = vinData.make;
    const model = vinData.model || specs.model || 'Modèle à confirmer (via registre national)';
    const year = vinData.year || specs.modelYear || vinData.estimatedYear;

    const [rappelConso, nhtsaRecalls, ukVinRes] = await Promise.all([
      fetchRappelConsoRecalls(make, specs.model || '', fetchImpl),
      fetchNhtsaRecalls(make, specs.model || '', year, fetchImpl),
      lookupUkMotHistory(vinData.vin, { byVin: true }, fetchImpl),
    ]);

    const allRecalls = [...rappelConso, ...nhtsaRecalls];
    const critAir = computeCritAir({
      fuelType: specs.fuelType,
      euroClass: year >= 2015 ? 'Euro 6' : year >= 2011 ? 'Euro 5' : null,
      year,
    });

    const ukInspections = ukVinRes.found && ukVinRes.data ? mapUkMotTests(ukVinRes.data) : { inspections: [], mileageReadings: [] };
    const mileage = analyzeMileage(ukInspections.mileageReadings);
    const countriesVisited = vinData.assemblyCountryCode ? [vinData.assemblyCountryCode] : ['EU'];
    if (ukVinRes.found && !countriesVisited.includes('GB')) countriesVisited.push('GB');

    const administrative = {
      stolen: false,
      pledge: false,
      opposition: false,
      vgeProcedure: false,
      veiProcedure: false,
      exported: false,
      insuredWam: null,
      importedIntoCountry: false,
      importNote: `VIN assemblé en ${vinData.assemblyCountry}. Pour obtenir les relevés kilométriques et propriétaires en France, importez le rapport HistoVec du vendeur.`,
      verifiedFields: {
        stolen: false,
        pledge: false,
        opposition: false,
        vgeProcedure: false,
        veiProcedure: false,
        wokStatus: false,
        insuredWam: false,
      },
    };

    const trust = evaluateTrustAndAlerts({
      mileage,
      damages: [],
      administrative,
      usageHistory: {},
      recalls: allRecalls,
      inspections: ukInspections.inspections,
      countriesVisited,
      dataCompleteness: ukVinRes.found ? 'open_data' : 'partial_vin',
    });

    const timeline = [];
    if (year) {
      timeline.push({
        date: `${year}-01-01`,
        country: vinData.assemblyCountryCode || 'EU',
        kind: 'registration',
        title: `Année-modèle ${vinData.yearReliable ? '' : 'estimée '} (${make}${specs.plantCity ? ` — usine de ${specs.plantCity}` : ` — ${vinData.assemblyCountry}`})`,
        km: null,
      });
    }
    for (const r of allRecalls.slice(0, 3)) {
      if (r.date) {
        timeline.push({
          date: r.date,
          country: r.source.includes('France') ? 'FR' : 'EU',
          kind: 'recall',
          title: `Rappel répertorié (${r.campaignId}) : ${r.component}`,
          km: null,
        });
      }
    }

    return {
      query: vinData.vin,
      normalizedKey: detected.normalizedKey,
      queryType: 'vin',
      country: detected.detectedCountry,
      dataOrigin: 'live_vin',
      dataOriginLabel: 'Décodage VIN temps réel (ISO 3779 + NHTSA vPIC + RappelConso FR)',
      sourcesConsulted: [
        { name: 'Décodeur VIN ISO 3779 (WMI Europe)', mode: 'live', status: 'ok', detail: `Constructeur : ${make} (${vinData.assemblyCountry})` },
        { name: 'NHTSA vPIC Extended', mode: 'live', status: vinData.vpicConnected ? 'ok' : 'degraded', detail: specs.model ? `${specs.make} ${specs.model}` : 'Données constructeur partielles pour VIN UE' },
        { name: 'RappelConso France (DGCCRF)', mode: 'live', status: rappelConso.length ? 'ok' : 'empty', detail: `${rappelConso.length} fiche(s) trouvée(s)` },
        { name: 'NHTSA Safety Recalls', mode: 'live', status: nhtsaRecalls.length ? 'ok' : 'empty', detail: `${nhtsaRecalls.length} campagne(s)` },
        { name: 'Registres nationaux (HistoVec / Car-Pass / KBA)', mode: 'owner_required', status: 'pending', detail: 'Import HistoVec recommandé pour les km & titulaires FR' },
      ],
      vehicle: {
        vin: vinData.vin,
        plate: ukVinRes.found ? ukVinRes.data.registration || null : null,
        make,
        model,
        trim: specs.trim || null,
        year,
        yearReliable: vinData.yearReliable,
        bodyType: specs.bodyClass || null,
        fuelType: specs.fuelType || null,
        transmission: specs.transmission || null,
        driveType: specs.driveType || null,
        engineCylinders: specs.engineCylinders || null,
        displacementCC: specs.displacementCC || null,
        powerHp: specs.engineHP || null,
        powerKw: specs.engineKW || null,
        doors: specs.doors || null,
        assemblyPlant: [specs.plantCity, specs.plantCountry || vinData.assemblyCountry].filter(Boolean).join(', '),
        safetyEquipment: specs.safety || null,
        critAir,
        vinAnatomy: vinData.anatomy,
        vinCheckDigit: vinData.checkDigit,
      },
      countriesVisited,
      ownersCount: null,
      usageHistory: {
        taxiOrVtc: false,
        rentalOrFleet: false,
        drivingSchool: false,
        note: 'L’historique d’usage commercial nécessite le rapport HistoVec (FR) ou un connecteur B2B assureur.',
      },
      administrative,
      mileage,
      damages: {
        count: 0,
        records: [],
        note: 'Aucune base gratuite européenne ne publie les sinistres privés uniquement par VIN (hors Estonie LKF). Importez HistoVec (FR) pour les sinistres VGE/VEI.',
      },
      inspections: ukInspections.inspections,
      recalls: allRecalls,
      timeline,
      valuation: {
        available: false,
        note: 'Importez le rapport HistoVec ou un relevé national pour obtenir une cote ajustée au kilométrage réel.',
        negotiationPoints: [
          {
            severity: 'info',
            title: 'Complétez avec le rapport officiel national',
            impact: 'Indispensable avant achat',
            detail: 'Utilisez la page « Import HistoVec » pour demander le lien officiel au vendeur et fusionner son kilométrage UTAC avec ce décodage VIN.',
          },
        ],
      },
      ...trust,
    };
  }

  // 4. Optional keyed connectors (UK MOT, NO Vegvesen, FR SIV B2B)
  if (detected.detectedCountry === 'GB') {
    const ukRes = await lookupUkMotHistory(detected.normalized, { byVin: false }, fetchImpl);
    if (ukRes.found && ukRes.data) {
      return buildUkMotReport(ukRes.data, detected.formattedPlate, detected.normalizedKey);
    }
  }
  if (detected.detectedCountry === 'NO') {
    const noRes = await lookupNorwayVegvesen(detected.normalized, fetchImpl);
    if (noRes.found && noRes.data) {
      return buildNorwayReport(noRes.data, detected.formattedPlate, detected.normalizedKey);
    }
  }
  if (detected.detectedCountry === 'FR') {
    const frRes = await lookupFranceSivB2B(detected.normalized, fetchImpl);
    if (frRes.found && frRes.data) {
      return buildFranceSivReport(frRes.data, detected.formattedPlate, detected.normalizedKey);
    }
  }

  // 5. Guided national pre-report (0 credits — honest about legal protections)
  const registry =
    getEuropeanRegistriesCatalog({ includeInternalMeta: false }).find((r) => r.code === detected.detectedCountry) ||
    getEuropeanRegistriesCatalog({ includeInternalMeta: false })[0];

  return {
    query: detected.formattedPlate || detected.normalized,
    normalizedKey: detected.normalizedKey,
    queryType: 'plate',
    country: detected.detectedCountry,
    dataOrigin: 'registry_guided',
    dataOriginLabel: `Pré-rapport ${registry.country} — Accès registre protégé (${registry.registry})`,
    sourcesConsulted: [
      {
        name: registry.registry,
        mode: registry.accessModel,
        status: 'pending',
        detail: registry.statusLabel,
      },
    ],
    vehicle: {
      vin: null,
      plate: detected.formattedPlate || detected.normalized,
      make: `Plaque ${registry.country} détectée`,
      model: 'En attente de données registre / import HistoVec',
      year: null,
      critAir: { level: null, label: 'En attente des données SIV / HistoVec', color: '#64748b', zfeAllowed: null },
    },
    countriesVisited: [detected.detectedCountry],
    ownersCount: null,
    usageHistory: {
      taxiOrVtc: false,
      rentalOrFleet: false,
      drivingSchool: false,
      note: registry.limitations,
    },
    administrative: {
      stolen: false,
      pledge: false,
      opposition: false,
      vgeProcedure: false,
      veiProcedure: false,
      insuredWam: null,
      importNote: registry.limitations,
      verifiedFields: {
        stolen: false,
        pledge: false,
        opposition: false,
        vgeProcedure: false,
        veiProcedure: false,
        wokStatus: false,
        insuredWam: false,
      },
    },
    mileage: analyzeMileage([]),
    damages: {
      count: 0,
      records: [],
      note: registry.limitations,
    },
    inspections: [],
    recalls: [],
    timeline: [],
    valuation: {
      available: false,
      note: 'Importez le rapport HistoVec ou renseignez le VIN à 17 caractères pour lancer le décodage complet.',
      negotiationPoints: [
        {
          severity: 'info',
          title: `Action recommandée (${registry.country})`,
          impact: 'Gratuit côté propriétaire',
          detail:
            detected.detectedCountry === 'FR'
              ? 'Demandez au vendeur son lien HistoVec (histovec.interieur.gouv.fr) et importez-le dans l’onglet « Import HistoVec », ou saisissez le numéro VIN à 17 caractères.'
              : `Consultez ${registry.officialUrl} ou saisissez le numéro VIN à 17 caractères pour obtenir le décodage usine et les rappels sécurité.`,
        },
      ],
    },
    guidedRegistry: registry,
    trustScore: 70,
    riskLevel: 'medium',
    summary: {
      verdict: `Registre ${registry.country} protégé — Étape propriétaire requise (0 crédit consommé)`,
      recommendation: registry.limitations,
    },
    alerts: [
      {
        severity: 'info',
        category: `Registre ${registry.country}`,
        title: `${registry.registry} ne permet pas de requête anonyme libre par plaque`,
        description:
          detected.detectedCountry === 'FR'
            ? 'En France, le Ministère de l’Intérieur protège le SIV : le vendeur génère gratuitement son rapport HistoVec en 1 minute. Vous pouvez l’importer dans VériCar gratuitement. Pour tester un registre live sans clé, essayez une plaque néerlandaise (ex. 21STVK ou HSF60S) ou un VIN à 17 caractères.'
            : registry.limitations,
      },
    ],
  };
}

/**
 * SaaS HTTP lookup orchestrator:
 * - Demo & guided reports: 0 credits (ephemeral for guests, saved for authenticated users).
 * - Live unlockable reports (`live_open_data`, `live_vin`):
 *   - Guest -> 401 AUTH_REQUIRED
 *   - Already unlocked same normalized_key (unless forceRefresh) -> 200 idempotent, 0 credits
 *   - credits_balance < 1 -> 402 INSUFFICIENT_CREDITS
 *   - Fetch live data FIRST (never charge on 404/upstream failure!), then atomically debit 1 credit + save inside BEGIN IMMEDIATE.
 */
export async function executeVehicleLookup({ query, country = 'AUTO', forceRefresh = false, user = null, fetchImpl = globalThis.fetch }) {
  const precheck = runVehiclePrecheck({ query, country, userId: user?.id || null });

  // 1. Idempotent re-open for authenticated user (unless forceRefresh)
  if (user && precheck.alreadyUnlockedReportId && !forceRefresh) {
    const existing = findUserReportByNormalizedKey(user.id, precheck.normalizedKey);
    if (existing) {
      return {
        report: { ...existing, alreadyUnlocked: true, ephemeral: false },
        alreadyUnlocked: true,
        creditCost: 0,
        ephemeral: false,
      };
    }
  }

  // 2. Credit-gating check BEFORE upstream live fetches
  if (precheck.requiresCredit) {
    if (!user) {
      throw new AppError(
        401,
        'AUTH_REQUIRED',
        'Connectez-vous ou créez un compte gratuit (1 crédit offert) pour débloquer ce rapport complet.'
      );
    }
    const balance = getUserCreditsBalance(user.id);
    if (balance < 1) {
      throw new AppError(
        402,
        'INSUFFICIENT_CREDITS',
        'Votre solde de crédits est épuisé. Choisissez un pack pour débloquer ce rapport.',
        { creditsBalance: balance }
      );
    }
  }

  // 3. Build report in-memory FIRST (if upstream fails or 404, 0 credits are charged!)
  const draft = await runWithoutAutoSave(() =>
    buildVehicleReportObject({ query, country, fetchImpl })
  );

  const isPaidOrigin = draft.dataOrigin === 'live_open_data' || draft.dataOrigin === 'live_vin';

  // 4. Guest viewing 0-credit demo or guided report -> ephemeral (not persisted to DB)
  if (!user) {
    if (isPaidOrigin) {
      throw new AppError(
        401,
        'AUTH_REQUIRED',
        'Connectez-vous ou créez un compte gratuit pour débloquer ce rapport.'
      );
    }
    return {
      report: {
        ...draft,
        id: `DEMO-${draft.normalizedKey.replace(/[^A-Z0-9]/g, '').slice(-8)}`,
        createdAt: new Date().toISOString(),
        ephemeral: true,
        creditCost: 0,
        alreadyUnlocked: false,
        isShared: false,
      },
      alreadyUnlocked: false,
      creditCost: 0,
      ephemeral: true,
    };
  }

  // 5. Authenticated 0-credit report (demo / guided)
  if (!isPaidOrigin) {
    const saved = insertReport(draft, {
      userId: user.id,
      normalizedKey: draft.normalizedKey,
      creditCost: 0,
    });
    return {
      report: { ...saved, alreadyUnlocked: false, ephemeral: false },
      alreadyUnlocked: false,
      creditCost: 0,
      ephemeral: false,
    };
  }

  // 6. Authenticated PAID live report -> Atomic debit + ledger + persist in single BEGIN IMMEDIATE transaction
  const saved = withTransaction(() => {
    // Re-check idempotency inside transaction against race conditions
    if (!forceRefresh) {
      const raced = findUserReportByNormalizedKey(user.id, draft.normalizedKey);
      if (raced) {
        return { report: raced, alreadyUnlocked: true, creditCost: 0 };
      }
    }

    let debit;
    try {
      debit = adjustUserCreditsAtomic(user.id, {
        delta: -1,
        reason: 'report_unlock',
        referenceId: draft.normalizedKey,
        description: `Déblocage rapport ${draft.vehicle?.make || ''} ${draft.vehicle?.model || ''} (${draft.query})`.trim(),
      });
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_CREDITS') {
        throw new AppError(
          402,
          'INSUFFICIENT_CREDITS',
          'Solde de crédits insuffisant pour débloquer ce rapport.',
          { creditsBalance: err.creditsBalance ?? 0 }
        );
      }
      throw err;
    }

    if (!debit?.ok) {
      throw new AppError(
        402,
        'INSUFFICIENT_CREDITS',
        'Solde de crédits insuffisant pour débloquer ce rapport.',
        { creditsBalance: debit?.creditsBalance ?? 0 }
      );
    }

    const inserted = insertReport(draft, {
      userId: user.id,
      normalizedKey: draft.normalizedKey,
      creditCost: 1,
    });

    return { report: inserted, alreadyUnlocked: false, creditCost: 1 };
  });

  return {
    report: { ...saved.report, alreadyUnlocked: saved.alreadyUnlocked, ephemeral: false },
    alreadyUnlocked: saved.alreadyUnlocked,
    creditCost: saved.creditCost,
    ephemeral: false,
  };
}

/**
 * Direct backward-compatible vehicle report generator (used by domain unit tests)
 */
export async function generateVehicleReport({ query, country = 'AUTO', fetchImpl = globalThis.fetch }) {
  const draft = await buildVehicleReportObject({ query, country, fetchImpl });
  return saveReport(draft);
}

/**
 * Imports a French HistoVec report and fuses it with live ISO 3779 + NHTSA + RappelConso checks (0 credits)
 */
export async function generateReportFromHistovec(rawInput, { userId = null, fetchImpl = globalThis.fetch } = {}) {
  const hv = parseHistovecInput(rawInput);

  const vinDecoded = hv.vin ? await decodeVinEnriched(hv.vin, fetchImpl) : null;
  const make = hv.make || vinDecoded?.make || 'Constructeur non précisé';
  const model = hv.model || vinDecoded?.model || 'Modèle issu de HistoVec';
  const year = hv.firstRegistrationDate
    ? Number(hv.firstRegistrationDate.slice(0, 4))
    : vinDecoded?.year || vinDecoded?.estimatedYear || null;

  const [rappelConso, nhtsaRecalls] = await Promise.all([
    fetchRappelConsoRecalls(make, model.split(' ')[0], fetchImpl),
    fetchNhtsaRecalls(make, model.split(' ')[0], year, fetchImpl),
  ]);

  const allRecalls = [...rappelConso.slice(0, 4), ...nhtsaRecalls.slice(0, 2)];
  const mileage = analyzeMileage(hv.mileageReadings);
  const critAir = computeCritAir({
    fuelType: hv.fuelType || vinDecoded?.vpicSpecs?.fuelType,
    euroClass: hv.euroClass,
    year,
  });

  const countriesVisited = hv.imported ? ['EU', 'FR'] : ['FR'];
  const administrative = {
    ...hv.administrative,
    exported: false,
    insuredWam: null, // HistoVec does not provide private insurance status
    importedIntoCountry: hv.imported,
    importNote: hv.imported
      ? 'HistoVec indique une importation : l’historique antérieur à l’entrée en France doit être croisé avec le pays d’origine.'
      : 'Origine France confirmée sur le rapport HistoVec (suivi SIV continu).',
  };

  const timeline = [
    ...hv.historyEvents.map((e) => ({
      date: e.date,
      country: e.country || 'FR',
      kind: e.type || 'registration',
      title: e.title,
      km: null,
    })),
    ...(hv.historyEvents.length === 0
      ? hv.mileageReadings.map((r) => ({
          date: r.date,
          country: 'FR',
          kind: 'inspection',
          title: r.source,
          km: r.km,
        }))
      : []),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const valuation = {
    available: false,
    note: 'Le rapport HistoVec ne contient pas le prix catalogue neuf : consultez la cote marché (Argus / La Centrale) en tenant compte des éléments vérifiés ci-dessous.',
    negotiationPoints: mileage.rollbackDetected
      ? [
          {
            severity: 'critical',
            title: 'Recul kilométrique détecté dans les relevés UTAC',
            impact: 'Motif d’annulation / forte décote',
            detail: 'Les relevés importés présentent une baisse anormale du compteur. Exigez les procès-verbaux originaux.',
          },
        ]
      : [
          {
            severity: 'positive',
            title: 'Historique SIV / UTAC vérifié via HistoVec',
            impact: 'Base saine pour la négociation',
            detail: 'Vérifiez l’assurance en cours (non incluse dans HistoVec) et les factures d’entretien courant.',
          },
        ],
  };

  const trust = evaluateTrustAndAlerts({
    mileage,
    damages: hv.damages,
    administrative,
    usageHistory: {},
    recalls: allRecalls,
    inspections: hv.inspections,
    countriesVisited,
    dataCompleteness: 'full',
  });

  const normalizedKey = hv.vin
    ? `HISTOVEC:VIN:${hv.vin}`
    : hv.plate
      ? `HISTOVEC:PLATE:${hv.plate.replace(/[^A-Z0-9]/g, '')}`
      : `HISTOVEC:${Date.now()}`;

  const draft = {
    query: hv.plate || hv.vin || 'IMPORT-HISTOVEC',
    normalizedKey,
    queryType: hv.plate ? 'plate' : 'vin',
    country: 'FR',
    dataOrigin: 'histovec_fused',
    dataOriginLabel: 'Rapport HistoVec France fusionné + Décodage VIN & RappelConso temps réel',
    sourcesConsulted: [
      { name: 'Import HistoVec (SIV France)', mode: 'histovec', status: 'ok', detail: `${hv.mileageReadings.length} relevé(s) km extrait(s)` },
      ...(vinDecoded?.validFormat
        ? [{ name: 'Décodage VIN ISO 3779 + vPIC', mode: 'live', status: 'ok', detail: `${vinDecoded.make} (${vinDecoded.assemblyCountry})` }]
        : []),
      { name: 'RappelConso France (DGCCRF)', mode: 'live', status: rappelConso.length ? 'ok' : 'empty', detail: `${rappelConso.length} fiche(s) sécurité` },
    ],
    vehicle: {
      vin: hv.vin,
      plate: hv.plate,
      make,
      model,
      year,
      firstRegistrationDate: hv.firstRegistrationDate,
      fuelType: hv.fuelType || vinDecoded?.vpicSpecs?.fuelType || null,
      co2Gkm: hv.co2Gkm,
      euroClass: hv.euroClass,
      powerHp: hv.powerHp || vinDecoded?.vpicSpecs?.engineHP || null,
      color: hv.color,
      assemblyPlant: vinDecoded?.assemblyCountry || 'France / UE',
      critAir,
      vinAnatomy: vinDecoded?.validFormat ? vinDecoded.anatomy : null,
      vinCheckDigit: vinDecoded?.validFormat ? vinDecoded.checkDigit : null,
    },
    countriesVisited,
    ownersCount: hv.ownersCount,
    usageHistory: {
      taxiOrVtc: false,
      rentalOrFleet: false,
      drivingSchool: false,
      note: 'Usage particulier présumé d’après le rapport HistoVec importé.',
    },
    administrative,
    mileage,
    damages: { count: hv.damages.length, records: hv.damages },
    inspections: hv.inspections,
    recalls: allRecalls,
    timeline,
    valuation,
    ...trust,
  };

  if (userId) {
    return insertReport(draft, { userId, normalizedKey, creditCost: 0 });
  }
  return saveReport(draft);
}

function buildTimelineFromRdw(rdw) {
  const events = [];
  if (rdw.vehicle.firstRegistrationDate) {
    events.push({
      date: rdw.vehicle.firstRegistrationDate,
      country: rdw.administrative.importedIntoCountry ? 'EU' : 'NL',
      kind: 'registration',
      title: '1re mise en circulation internationale',
      km: null,
    });
  }
  if (rdw.administrative.importedIntoCountry && rdw.vehicle.firstRegistrationLocalDate) {
    events.push({
      date: rdw.vehicle.firstRegistrationLocalDate,
      country: 'NL',
      kind: 'export',
      title: 'Importation et première immatriculation aux Pays-Bas',
      km: null,
    });
  }
  if (
    rdw.vehicle.lastRegistrationChangeDate &&
    rdw.vehicle.lastRegistrationChangeDate !== rdw.vehicle.firstRegistrationLocalDate
  ) {
    events.push({
      date: rdw.vehicle.lastRegistrationChangeDate,
      country: 'NL',
      kind: 'ownership',
      title: 'Dernier changement de titulaire enregistré aux Pays-Bas',
      km: null,
    });
  }
  for (const insp of rdw.inspections.slice(0, 6)) {
    events.push({
      date: insp.date,
      country: 'NL',
      kind: 'inspection',
      title: `${insp.type}${insp.defects.length ? ` (${insp.defects.length} défaut(s) relevé(s))` : ' — conforme'}`,
      km: null,
    });
  }
  for (const rec of rdw.recalls.slice(0, 4)) {
    if (rec.date) {
      events.push({
        date: rec.date,
        country: 'NL',
        kind: 'recall',
        title: `Campagne de rappel ${rec.campaignId} — ${rec.status === 'resolved' ? 'corrigée' : 'ouverte'}`,
        km: null,
      });
    }
  }
  return events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function mapUkMotTests(ukData) {
  const motTests = Array.isArray(ukData.motTests) ? ukData.motTests : [];
  const mileageReadings = motTests
    .filter((t) => t.odometerValue !== undefined && t.odometerValue !== null && t.odometerValue !== '')
    .map((t) => {
      const val = Number(t.odometerValue);
      const km = String(t.odometerUnit || '').toUpperCase() === 'MI' ? Math.round(val * 1.60934) : val;
      return { date: String(t.completedDate).slice(0, 10), km, source: 'DVSA MOT History (UK)', country: 'GB' };
    });

  const inspections = motTests.map((t) => ({
    date: String(t.completedDate).slice(0, 10),
    country: 'GB',
    type: 'MOT Test (DVSA)',
    result: t.testResult === 'PASSED' ? 'Favorable (PASSED)' : 'Défavorable (FAILED)',
    passed: t.testResult === 'PASSED',
    mileageKm:
      t.odometerValue !== undefined && t.odometerValue !== null
        ? String(t.odometerUnit || '').toUpperCase() === 'MI'
          ? Math.round(Number(t.odometerValue) * 1.60934)
          : Number(t.odometerValue)
        : null,
    defects: (t.defects || []).map((d) => ({ code: d.type, description: d.text })),
  }));

  return { inspections, mileageReadings };
}

function buildUkMotReport(ukData, plate, normalizedKey) {
  const { inspections, mileageReadings } = mapUkMotTests(ukData);
  const mileage = analyzeMileage(mileageReadings);
  const year = ukData.firstUsedDate ? Number(ukData.firstUsedDate.slice(0, 4)) : null;
  const critAir = computeCritAir({ fuelType: ukData.fuelType, year });
  const administrative = {
    stolen: false,
    pledge: false,
    opposition: false,
    vgeProcedure: false,
    veiProcedure: false,
    insuredWam: null,
    verifiedFields: {
      stolen: false,
      pledge: false,
      opposition: false,
      vgeProcedure: false,
      veiProcedure: false,
      wokStatus: false,
      insuredWam: false,
    },
  };
  const trust = evaluateTrustAndAlerts({
    mileage,
    damages: [],
    administrative,
    usageHistory: {},
    recalls: [],
    inspections,
    countriesVisited: ['GB'],
    dataCompleteness: 'open_data',
  });

  return {
    query: plate,
    normalizedKey,
    queryType: 'plate',
    country: 'GB',
    dataOrigin: 'live_open_data',
    dataOriginLabel: 'Données officielles temps réel (DVSA MOT Royaume-Uni)',
    sourcesConsulted: [{ name: 'DVSA MOT History API', mode: 'live', status: 'ok', detail: `${inspections.length} contrôle(s) MOT` }],
    vehicle: {
      vin: ukData.vin || null,
      plate,
      make: ukData.make || 'Inconnu',
      model: ukData.model || 'Modèle non renseigné',
      year,
      firstRegistrationDate: ukData.firstUsedDate || null,
      fuelType: ukData.fuelType || null,
      color: ukData.primaryColour || null,
      critAir,
    },
    countriesVisited: ['GB'],
    ownersCount: null,
    usageHistory: { taxiOrVtc: false, rentalOrFleet: false, drivingSchool: false, note: 'Non précisé par DVSA MOT.' },
    administrative,
    mileage,
    damages: { count: 0, records: [] },
    inspections,
    recalls: [],
    timeline: inspections.map((i) => ({ date: i.date, country: 'GB', kind: 'inspection', title: `${i.type} — ${i.result}`, km: i.mileageKm })),
    valuation: { available: false, negotiationPoints: [] },
    ...trust,
  };
}

function buildNorwayReport(noData, plate, normalizedKey) {
  const item = noData?.kjoretoydataListe?.[0] || {};
  const tech = item?.godkjenning?.tekniskGodkjenning?.tekniskeData || {};
  const make = tech?.generelt?.merke?.[0]?.merke || 'Inconnu';
  const model = tech?.generelt?.handelsbetegnelse?.[0] || 'Modèle non renseigné';
  const vin = item?.kjoretoyId?.understellsnummer || null;
  const firstReg = item?.forstegangsregistrering?.registrertForstegangNorgeDato || null;
  const year = firstReg ? Number(String(firstReg).slice(0, 4)) : null;
  const fuelRaw = tech?.miljodata?.miljoOgdrivstoffGruppe?.[0]?.drivstoffKodeMiljodata?.kodeNavn || null;
  const euControl = item?.periodiskKjoretoyKontroll || {};

  const inspections = euControl.sistGodkjent
    ? [
        {
          date: String(euControl.sistGodkjent).slice(0, 10),
          country: 'NO',
          type: 'EU-kontroll (Statens vegvesen)',
          result: `Validé jusqu’au ${euControl.kontrollfrist || '—'}`,
          passed: true,
          mileageKm: null,
          defects: [],
        },
      ]
    : [];

  const mileage = analyzeMileage([]);
  const administrative = {
    stolen: false,
    pledge: false,
    opposition: false,
    vgeProcedure: false,
    veiProcedure: false,
    insuredWam: null,
    verifiedFields: {
      stolen: false,
      pledge: false,
      opposition: false,
      vgeProcedure: false,
      veiProcedure: false,
      wokStatus: false,
      insuredWam: false,
    },
  };
  const trust = evaluateTrustAndAlerts({
    mileage,
    damages: [],
    administrative,
    usageHistory: {},
    recalls: [],
    inspections,
    countriesVisited: ['NO'],
    dataCompleteness: 'open_data',
  });

  return {
    query: plate,
    normalizedKey,
    queryType: 'plate',
    country: 'NO',
    dataOrigin: 'live_open_data',
    dataOriginLabel: 'Données officielles temps réel (Statens Vegvesen Norvège)',
    sourcesConsulted: [{ name: 'Statens Vegvesen API', mode: 'live', status: 'ok', detail: `${make} ${model}` }],
    vehicle: {
      vin,
      plate,
      make,
      model,
      year,
      firstRegistrationDate: firstReg,
      fuelType: fuelRaw,
      critAir: computeCritAir({ fuelType: fuelRaw, year }),
    },
    countriesVisited: ['NO'],
    ownersCount: null,
    usageHistory: { taxiOrVtc: false, rentalOrFleet: false, drivingSchool: false },
    administrative,
    mileage,
    damages: { count: 0, records: [] },
    inspections,
    recalls: [],
    timeline: [
      ...(firstReg ? [{ date: String(firstReg).slice(0, 10), country: 'NO', kind: 'registration', title: '1re immatriculation Norvège', km: null }] : []),
      ...inspections.map((i) => ({ date: i.date, country: 'NO', kind: 'inspection', title: i.type, km: null })),
    ],
    valuation: { available: false, negotiationPoints: [] },
    ...trust,
  };
}

function buildFranceSivReport(sivData, plate, normalizedKey) {
  const make = sivData.marque || sivData.make || 'Inconnu';
  const model = sivData.modele || sivData.model || 'Modèle SIV';
  const vin = sivData.vin || null;
  const firstReg = sivData.date_mise_en_circulation || sivData.firstRegistrationDate || null;
  const year = firstReg ? Number(String(firstReg).slice(0, 4)) : null;
  const fuelType = sivData.energie || sivData.fuelType || null;
  const mileage = analyzeMileage([]);
  const administrative = {
    stolen: false,
    pledge: false,
    opposition: false,
    vgeProcedure: false,
    veiProcedure: false,
    insuredWam: null,
    verifiedFields: {
      stolen: false,
      pledge: false,
      opposition: false,
      vgeProcedure: false,
      veiProcedure: false,
      wokStatus: false,
      insuredWam: false,
    },
  };
  const trust = evaluateTrustAndAlerts({
    mileage,
    damages: [],
    administrative,
    usageHistory: {},
    recalls: [],
    inspections: [],
    countriesVisited: ['FR'],
    dataCompleteness: 'open_data',
  });

  return {
    query: plate,
    normalizedKey,
    queryType: 'plate',
    country: 'FR',
    dataOrigin: 'live_open_data',
    dataOriginLabel: 'Données SIV France temps réel (Connecteur B2B)',
    sourcesConsulted: [{ name: 'API SIV France (B2B)', mode: 'live', status: 'ok', detail: `${make} ${model}` }],
    vehicle: {
      vin,
      plate,
      make,
      model,
      year,
      firstRegistrationDate: firstReg,
      fuelType,
      powerHp: sivData.puissance_din ? Number(sivData.puissance_din) : null,
      co2Gkm: sivData.co2 ? Number(sivData.co2) : null,
      critAir: computeCritAir({ fuelType, year }),
    },
    countriesVisited: ['FR'],
    ownersCount: null,
    usageHistory: { taxiOrVtc: false, rentalOrFleet: false, drivingSchool: false },
    administrative,
    mileage,
    damages: { count: 0, records: [] },
    inspections: [],
    recalls: [],
    timeline: firstReg ? [{ date: String(firstReg).slice(0, 10), country: 'FR', kind: 'registration', title: '1re mise en circulation SIV France', km: null }] : [],
    valuation: { available: false, negotiationPoints: [] },
    ...trust,
  };
}
