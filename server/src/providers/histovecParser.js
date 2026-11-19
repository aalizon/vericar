import { normalizeVin, isLikelyVin } from './vinDecoder.js';

export const SAMPLE_HISTOVEC_PAYLOAD = {
  source: 'HistoVec (Ministère de l’Intérieur — SIV)',
  plate: 'FN-642-TR',
  vin: 'VF1RJB00265819432',
  make: 'Renault',
  model: 'Clio V 1.0 TCe 100 Intens',
  firstRegistrationDate: '2020-02-18',
  fuelType: 'Essence',
  co2Gkm: 118,
  euroClass: 'Euro 6',
  fiscalPowerCv: 5,
  powerHp: 100,
  color: 'Gris Titanium',
  imported: false,
  ownersCount: 2,
  administrative: {
    stolen: false,
    pledge: false,
    opposition: false,
    vgeProcedure: false,
    veiProcedure: false,
    registrationValid: true,
    insuredWam: null,
  },
  historyEvents: [
    { date: '2020-02-18', country: 'FR', type: 'registration', title: 'Première immatriculation en France (véhicule neuf)' },
    { date: '2022-09-14', country: 'FR', type: 'ownership', title: 'Cession — Changement de titulaire (2e propriétaire particulier)' },
    { date: '2024-02-09', country: 'FR', type: 'inspection', title: 'Contrôle technique périodique UTAC — Favorable (52 340 km)' },
    { date: '2026-02-04', country: 'FR', type: 'inspection', title: 'Contrôle technique périodique UTAC — Favorable (78 910 km)' },
  ],
  mileageReadings: [
    { date: '2020-02-18', km: 12, source: 'Mise en circulation SIV', country: 'FR' },
    { date: '2022-09-14', km: 31800, source: 'Déclaration cession / entretien', country: 'FR' },
    { date: '2024-02-09', km: 52340, source: 'Contrôle technique UTAC', country: 'FR' },
    { date: '2026-02-04', km: 78910, source: 'Contrôle technique UTAC', country: 'FR' },
  ],
  inspections: [
    {
      date: '2026-02-04',
      country: 'FR',
      type: 'Contrôle technique périodique (UTAC-OTC)',
      result: 'Favorable',
      passed: true,
      mileageKm: 78910,
      defects: [
        { code: '4.1.2.a.1', description: 'Orientation feu de brouillard avant légèrement basse (défaillance mineure)' },
      ],
    },
    {
      date: '2024-02-09',
      country: 'FR',
      type: 'Contrôle technique périodique (UTAC-OTC)',
      result: 'Favorable',
      passed: true,
      mileageKm: 52340,
      defects: [],
    },
  ],
  damages: [],
};

function hasPositiveLineMatch(lines, positiveRegex, negativeRegex) {
  return lines.some((line) => positiveRegex.test(line) && !negativeRegex.test(line));
}

function toIsoDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.split(/[/-]/);
  if (parts.length === 3 && parts[2].length === 4) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Parses either a JSON HistoVec payload or pasted raw French HistoVec text.
 * Uses line-scoped negation checks so "non gagé" on one line never masks a VGE alert on another line.
 */
export function parseHistovecInput(input) {
  if (!input) {
    throw new Error('Veuillez fournir les données HistoVec (JSON ou texte copié depuis le rapport officiel).');
  }

  if (typeof input === 'object') {
    return normalizeStructuredHistovec(input);
  }

  const trimmed = String(input).trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeStructuredHistovec(parsed);
    } catch {
      // Fallback to text extraction below
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const plateMatch = trimmed.match(/\b([A-Z]{2}[-\s]?\d{3}[-\s]?[A-Z]{2})\b/i);
  // Require at least one digit in 17-char VIN candidate to avoid false-positive French words
  const vinCandidates = trimmed.match(/\b([A-HJ-NPR-Z0-9]{17})\b/gi) || [];
  const validVinMatch = vinCandidates.find((cand) => /\d/.test(cand) && isLikelyVin(cand)) || null;

  const dateRegMatch = trimmed.match(
    /(?:mise en circulation|1[èe]re immatriculation)[^\d]{0,30}(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i
  );
  const makeMatch = trimmed.match(/(?:Marque|Constructeur)\s*[:\-]\s*([A-Za-zÀ-ÿ0-9 -]{2,28})/i);
  const modelMatch = trimmed.match(/(?:Modèle|Dénomination commerciale)\s*[:\-]\s*([A-Za-zÀ-ÿ0-9 .\-/]{2,45})/i);
  const ownersMatch = trimmed.match(/(\d+)\s*(?:titulaires?|propriétaires?)/i);

  // Extract mileage lines supporting <1000 km, spaces, dots, and commas (e.g. "12 km", "54 200 km", "78,500 km")
  const mileageReadings = [];
  const lineRegex = /(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})[^\n]{0,70}?(\d{1,3}(?:[\s.,]\d{3})+|\d{1,6})\s*km\b/gi;
  let m;
  while ((m = lineRegex.exec(trimmed)) !== null) {
    const isoDate = toIsoDate(m[1]);
    const km = Number(m[2].replace(/[\s.,]/g, ''));
    if (isoDate && Number.isFinite(km) && km >= 0 && km < 1_500_000) {
      mileageReadings.push({
        date: isoDate,
        km,
        source: 'Extrait rapport HistoVec (UTAC)',
        country: 'FR',
      });
    }
  }

  // Line-scoped positive/negative flags
  const hasVge = hasPositiveLineMatch(
    lines,
    /\b(VGE|VEI|véhicule gravement endommagé|procédure d['’]expertise)\b/i,
    /\b(aucun|aucune|pas de|néant|sans|non)\b/i
  );
  const hasGage = hasPositiveLineMatch(
    lines,
    /\b(gagé|gage inscrit|opposition judiciaire|opposition)\b/i,
    /\b(non gagé|aucun gage|absence de gage|aucune opposition|pas d['’]opposition|néant|sans)\b/i
  );
  const hasStolen = hasPositiveLineMatch(
    lines,
    /\b(déclaré volé|signalé volé|volé)\b/i,
    /\b(non volé|pas déclaré volé|pas volé|aucun vol|néant)\b/i
  );
  const hasImport = hasPositiveLineMatch(
    lines,
    /\b(importé|importation|immatriculation étrangère)\b/i,
    /\b(non importé|pas importé|origine france|jamais importé)\b/i
  );

  const normalizedVin = validVinMatch ? normalizeVin(validVinMatch) : null;
  const formattedPlate = plateMatch
    ? plateMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3')
    : null;

  if (!normalizedVin && !formattedPlate && mileageReadings.length === 0) {
    throw new Error(
      'Impossible d’extraire une plaque (ex. AA-123-AA), un VIN (17 caractères) ou des relevés kilométriques depuis ce texte.'
    );
  }

  return normalizeStructuredHistovec({
    plate: formattedPlate,
    vin: normalizedVin,
    make: makeMatch ? makeMatch[1].trim() : null,
    model: modelMatch ? modelMatch[1].trim() : null,
    firstRegistrationDate: dateRegMatch ? toIsoDate(dateRegMatch[1]) : null,
    ownersCount: ownersMatch ? Number(ownersMatch[1]) : null,
    imported: hasImport,
    administrative: {
      stolen: hasStolen,
      pledge: hasGage,
      opposition: hasGage,
      vgeProcedure: hasVge,
      veiProcedure: false,
      registrationValid: true,
      insuredWam: null,
    },
    mileageReadings,
  });
}

function normalizeStructuredHistovec(obj) {
  const mileageReadings = Array.isArray(obj.mileageReadings)
    ? obj.mileageReadings
        .map((r) => ({
          date: toIsoDate(r.date) || r.date,
          km: Number(r.km),
          source: r.source || 'HistoVec / UTAC',
          country: r.country || 'FR',
        }))
        .filter((r) => r.date && Number.isFinite(r.km))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  return {
    source: obj.source || 'Import HistoVec (France)',
    plate: obj.plate ? String(obj.plate).toUpperCase().trim() : null,
    vin: obj.vin && isLikelyVin(obj.vin) ? normalizeVin(obj.vin) : null,
    make: obj.make || null,
    model: obj.model || null,
    firstRegistrationDate: toIsoDate(obj.firstRegistrationDate) || null,
    fuelType: obj.fuelType || null,
    co2Gkm: obj.co2Gkm ? Number(obj.co2Gkm) : null,
    euroClass: obj.euroClass || null,
    powerHp: obj.powerHp ? Number(obj.powerHp) : null,
    color: obj.color || null,
    imported: Boolean(obj.imported),
    ownersCount:
      obj.ownersCount !== undefined && obj.ownersCount !== null && Number.isFinite(Number(obj.ownersCount))
        ? Number(obj.ownersCount)
        : null,
    administrative: {
      stolen: Boolean(obj.administrative?.stolen),
      pledge: Boolean(obj.administrative?.pledge),
      opposition: Boolean(obj.administrative?.opposition),
      vgeProcedure: Boolean(obj.administrative?.vgeProcedure),
      veiProcedure: Boolean(obj.administrative?.veiProcedure),
      registrationValid: obj.administrative?.registrationValid !== false,
      insuredWam: null, // HistoVec (SIV) does not certify active private insurance
      verifiedFields: {
        stolen: true,
        pledge: true,
        opposition: true,
        vgeProcedure: true,
        veiProcedure: true,
        wokStatus: false,
        insuredWam: false,
      },
    },
    historyEvents: Array.isArray(obj.historyEvents) ? obj.historyEvents : [],
    mileageReadings,
    inspections: Array.isArray(obj.inspections) ? obj.inspections : [],
    damages: Array.isArray(obj.damages) ? obj.damages : [],
  };
}

export function buildSellerRequestMessage({ vehicleLabel = 'votre véhicule', plate = '', country = 'FR' } = {}) {
  const cleanLabel = String(vehicleLabel || 'votre véhicule').trim();
  const plateSuffix = plate && String(plate).trim() ? ` (${String(plate).trim().toUpperCase()})` : '';
  const target = `${cleanLabel}${plateSuffix}`;

  if (country === 'BE') {
    return `Bonjour,\n\nJe suis très intéressé par ${target}. Avant d’organiser une visite, pourriez-vous me transmettre le numéro de châssis (VIN à 17 caractères) ainsi que le code d’identification du certificat Car-Pass (obligatoire en Belgique) ?\n\nCela me permet de vérifier l’historique en toute transparence. Merci beaucoup par avance !`;
  }
  return `Bonjour,\n\nJe suis très intéressé par ${target}. Avant de me déplacer, pourriez-vous générer et me partager le lien officiel gratuit HistoVec (sur histovec.interieur.gouv.fr, cela prend 1 minute avec votre carte grise) ainsi que le numéro VIN (champ E) ?\n\nMerci beaucoup pour votre transparence, je reste disponible pour convenir d’un rendez-vous rapidement !`;
}
