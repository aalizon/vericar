import { recordConnectorMetric } from '../db/repositories.js';
import { getCachedOrFetch, CACHE_TTLS } from '../services/apiCache.js';

let cachedUkOAuthToken = { token: null, expiresAt: 0 };

/**
 * Structured catalog of 12 European national vehicle history registries.
 * By default (`includeInternalMeta: false`), strips internal `.env` variable names
 * so public consumer endpoints never expose server configuration details.
 */
export function getEuropeanRegistriesCatalog({ includeInternalMeta = false } = {}) {
  const hasUkMot = Boolean(
    process.env.UK_MOT_API_KEY &&
      ((process.env.UK_MOT_CLIENT_ID && process.env.UK_MOT_CLIENT_SECRET && process.env.UK_MOT_TOKEN_URL) ||
        process.env.UK_MOT_API_KEY)
  );
  const hasNoVegvesen = Boolean(process.env.NO_VEGVESEN_API_KEY);
  const hasFrSiv = Boolean(process.env.FR_SIV_API_KEY && process.env.FR_SIV_API_URL);

  const rawCatalog = [
    {
      code: 'FR',
      country: 'France',
      registry: 'HistoVec (SIV — Ministère de l’Intérieur) & RappelConso',
      accessModel: 'hybrid',
      connectorStatus: hasFrSiv ? 'live_full' : 'live_partial',
      statusLabel: hasFrSiv
        ? 'Live SIV + RappelConso + Import HistoVec'
        : 'Live RappelConso + Import HistoVec guidé',
      officialUrl: 'https://histovec.interieur.gouv.fr/',
      lookupBy: ['Plaque SIV (AA-123-AA)', 'Import rapport HistoVec', 'VIN (RappelConso)'],
      freeOfficialData: [
        'Historique des titulaires',
        'Relevés kilométriques UTAC (contrôles techniques)',
        'Sinistres VGE / VEI déclarés',
        'Situation administrative (gages, oppositions, vol)',
        'Rappels sécurité RappelConso (live)',
      ],
      limitations:
        'HistoVec exige l’identité du titulaire (carte grise) pour générer le lien de partage ; aucune API publique anonyme n’existe. L’import dans VériCar permet de fusionner HistoVec avec nos sources européennes.',
      envVars: ['FR_SIV_API_KEY', 'FR_SIV_API_URL'],
      configured: hasFrSiv,
    },
    {
      code: 'NL',
      country: 'Pays-Bas',
      registry: 'Registre Open Data néerlandais (5 datasets CC0)',
      accessModel: 'open_data_live',
      connectorStatus: 'live_full',
      statusLabel: 'Actif temps réel (Open Data)',
      officialUrl: 'https://opendata.rdw.nl/',
      lookupBy: ['Plaque néerlandaise (ex. 21STVK, HSF60S)'],
      freeOfficialData: [
        'Fiche technique complète, CO₂, Euro, prix catalogue',
        'Jugement compteur officiel (Logisch / Onlogisch)',
        'Historique des inspections APK et défauts constatés',
        'Campagnes de rappels constructeur et statut de réparation',
        'Statut assurance WAM, export, taxi, WOK et date d’import NL',
      ],
      limitations:
        'Les relevés kilométriques bruts exacts restent privés, mais le verdict officiel de cohérence compteur (Logisch/Onlogisch) est publié en temps réel.',
      envVars: [],
      configured: true,
    },
    {
      code: 'GB',
      country: 'Royaume-Uni',
      registry: 'DVSA MOT History API & DVLA',
      accessModel: 'free_api_key',
      connectorStatus: hasUkMot ? 'live_full' : 'ready_key_required',
      statusLabel: hasUkMot ? 'Actif temps réel (DVSA MOT)' : 'Connecteur prêt (clé GOV.UK)',
      officialUrl: 'https://documentation.history.mot.api.gov.uk/',
      lookupBy: ['Plaque britannique (VRM)', 'VIN'],
      freeOfficialData: [
        'Tous les contrôles MOT depuis 2005 (GB) / 2017 (NI)',
        'Kilométrage exact relevé à chaque passage MOT',
        'Défauts majeurs, échecs et avis consultatifs complets',
      ],
      limitations:
        'Nécessite des identifiants développeur gratuits DVSA (OAuth2 + clé API GOV.UK) pour les requêtes automatisées.',
      envVars: ['UK_MOT_API_KEY', 'UK_MOT_CLIENT_ID', 'UK_MOT_CLIENT_SECRET', 'UK_MOT_TOKEN_URL'],
      configured: hasUkMot,
    },
    {
      code: 'BE',
      country: 'Belgique',
      registry: 'Car-Pass ASBL',
      accessModel: 'owner_certificate',
      connectorStatus: 'portal_assisted',
      statusLabel: 'Vérification par certificat Car-Pass',
      officialUrl: 'https://www.car-pass.be/',
      lookupBy: ['Code d’identification Car-Pass'],
      freeOfficialData: [
        'Certificat kilométrique légalement obligatoire à toute vente en Belgique',
        'Relevés des garages, concessions, marchands de pneus et contrôles techniques',
        'Statut d’inspection après accident grave',
      ],
      limitations:
        'Obligatoire pour le vendeur belge : demandez toujours le document Car-Pass ou son code QR avant un import Belgique → France.',
      envVars: ['BE_CARPASS_API_KEY'],
      configured: false,
    },
    {
      code: 'DE',
      country: 'Allemagne',
      registry: 'KBA (Kraftfahrt-Bundesamt) / Bases B2B assureurs',
      accessModel: 'b2b_commercial',
      connectorStatus: 'b2b_required',
      statusLabel: 'Aucun registre public gratuit (B2B requis)',
      officialUrl: 'https://www.kba.de/',
      lookupBy: ['VIN (via agrégateurs assureurs / enchères B2B)'],
      freeOfficialData: [
        'Base publique de rappels KBA par marque/modèle uniquement',
        'Aucun historique individuel par VIN ou plaque accessible au public (RGPD / Datenschutz)',
      ],
      limitations:
        'Premier exportateur de véhicules d’occasion en Europe et principal point aveugle : exige des flux commerciaux assureurs/enchères (DAT, Audatex, réseaux constructeurs).',
      envVars: ['DE_DAT_API_KEY'],
      configured: false,
    },
    {
      code: 'PL',
      country: 'Pologne',
      registry: 'Historia Pojazdu (CEPiK — Gouvernement polonais)',
      accessModel: 'owner_portal',
      connectorStatus: 'portal_assisted',
      statusLabel: 'Portail officiel gratuit (plaque + VIN + 1re immat.)',
      officialUrl: 'https://historiapojazdu.gov.pl/',
      lookupBy: ['Plaque + VIN + Date de 1re mise en circulation'],
      freeOfficialData: [
        'Relevés kilométriques des contrôles techniques SKP depuis 2014',
        'Nombre de propriétaires et département d’immatriculation',
        'Validité assurance OC, contrôle technique et statut vol',
      ],
      limitations:
        'Nécessite les 3 identifiants simultanément (plaque + VIN + date de 1re immatriculation) sur le portail gouvernemental.',
      envVars: [],
      configured: false,
    },
    {
      code: 'IT',
      country: 'Italie',
      registry: 'Portale dell’Automobilista & ACI PRA',
      accessModel: 'owner_portal',
      connectorStatus: 'portal_assisted',
      statusLabel: 'Portail public (révisions/km gratuits, PRA payant)',
      officialUrl: 'https://www.ilportaledellautomobilista.it/',
      lookupBy: ['Plaque italienne (Targa)'],
      freeOfficialData: [
        'Dates des révisions techniques et kilométrages depuis 2018',
        'Statut de couverture assurance RC Auto',
        'Classe environnementale Euro et restrictions jeunes conducteurs',
      ],
      limitations:
        'L’historique complet de propriété et d’hypothèques (Visura PRA) est délivré contre redevance auprès de l’ACI.',
      envVars: [],
      configured: false,
    },
    {
      code: 'ES',
      country: 'Espagne',
      registry: 'DGT (Dirección General de Tráfico)',
      accessModel: 'owner_portal',
      connectorStatus: 'portal_assisted',
      statusLabel: 'Rapport réduit gratuit · Rapport complet DGT (~8,67 €)',
      officialUrl: 'https://sede.dgt.gob.es/',
      lookupBy: ['Plaque espagnole (Matrícula)', 'VIN'],
      freeOfficialData: [
        'Rapport réduit gratuit : validité administrative et indicateur d’incident',
        'Rapport complet DGT : relevés ITV, propriétaires, charges/embargos, sinistres',
      ],
      limitations:
        'Le rapport complet nécessite une identification électronique espagnole (Cl@ve / certificat) ou un intermédiaire agréé.',
      envVars: [],
      configured: false,
    },
    {
      code: 'NO',
      country: 'Norvège',
      registry: 'Statens vegvesen (Kjøretøyopplysninger)',
      accessModel: 'free_api_key',
      connectorStatus: hasNoVegvesen ? 'live_full' : 'ready_key_required',
      statusLabel: hasNoVegvesen ? 'Actif temps réel (Vegvesen)' : 'Connecteur prêt (clé API Vegvesen)',
      officialUrl: 'https://www.vegvesen.no/kjoretoy/kjop-og-salg/kjoretoyopplysninger/',
      lookupBy: ['Plaque norvégienne', 'VIN'],
      freeOfficialData: [
        'Spécifications techniques officielles et dates de contrôle EU-kontroll',
        'Historique des relevés kilométriques aux contrôles périodiques',
        'Statut d’importation et dates d’immatriculation',
      ],
      limitations:
        'API officielle gratuite sur inscription auprès de Statens vegvesen.',
      envVars: ['NO_VEGVESEN_API_KEY'],
      configured: hasNoVegvesen,
    },
    {
      code: 'SE',
      country: 'Suède',
      registry: 'Transportstyrelsen / Biluppgifter',
      accessModel: 'owner_portal',
      connectorStatus: 'portal_assisted',
      statusLabel: 'Registre public consultable (plaque)',
      officialUrl: 'https://fordon-fu-regnr.transportstyrelsen.se/',
      lookupBy: ['Plaque suédoise'],
      freeOfficialData: [
        'Kilométrage des inspections Besiktning',
        'Nombre de propriétaires, taxe annuelle, statut import/export',
        'Historique d’usage (taxi, leasing, location)',
      ],
      limitations:
        'Accès API structuré réservé aux partenaires agréés ; consultation individuelle ouverte sur le portail officiel.',
      envVars: [],
      configured: false,
    },
    {
      code: 'DK',
      country: 'Danemark',
      registry: 'Motorregisteret (SKAT) & Færdselsstyrelsen',
      accessModel: 'owner_portal',
      connectorStatus: 'portal_assisted',
      statusLabel: 'Registre ouvert (inspections & km publics)',
      officialUrl: 'https://motorregister.skat.dk/',
      lookupBy: ['Plaque danoise', 'VIN'],
      freeOfficialData: [
        'Rapports complets de contrôle technique (Syn) avec kilométrage exact',
        'Défauts constatés et contre-visites',
        'Statut fiscal et technique',
      ],
      limitations:
        'Forte transparence publique sur les contrôles techniques ; données d’assurance sinistres sur flux B2B.',
      envVars: [],
      configured: false,
    },
    {
      code: 'EE',
      country: 'Estonie',
      registry: 'Transpordiamet & LKF (Fonds d’assurance)',
      accessModel: 'owner_portal',
      connectorStatus: 'portal_assisted',
      statusLabel: 'Portail public gratuit (VIN + sinistres LKF)',
      officialUrl: 'https://eteenindus.mnt.ee/public/soidukTaustakontroll.jsf',
      lookupBy: ['Plaque estonienne', 'VIN'],
      freeOfficialData: [
        'Contrôles techniques, kilométrages et historique d’opérations',
        'Sinistres déclarés aux assureurs via la base publique LKF',
      ],
      limitations:
        'Modèle de référence en Europe pour la transparence des sinistres d’assurance publics par VIN.',
      envVars: [],
      configured: false,
    },
  ];

  if (includeInternalMeta) {
    return rawCatalog;
  }

  return rawCatalog.map(({ envVars: _env, configured: _cfg, ...publicFields }) => publicFields);
}

async function getUkDvsaBearerToken(fetchImpl = globalThis.fetch) {
  const clientId = process.env.UK_MOT_CLIENT_ID;
  const clientSecret = process.env.UK_MOT_CLIENT_SECRET;
  const tokenUrl = process.env.UK_MOT_TOKEN_URL;
  const scope = process.env.UK_MOT_SCOPE || 'https://tapi.dvsa.gov.uk/.default';

  if (!clientId || !clientSecret || !tokenUrl) return null;
  if (cachedUkOAuthToken.token && Date.now() < cachedUkOAuthToken.expiresAt - 60_000) {
    return cachedUkOAuthToken.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const res = await fetchImpl(tokenUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`DVSA OAuth HTTP ${res.status}`);
  const payload = await res.json();
  if (!payload.access_token) throw new Error('DVSA OAuth sans access_token');

  cachedUkOAuthToken = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  };
  return cachedUkOAuthToken.token;
}

/**
 * Live UK DVSA MOT History lookup (supports both Registration & 17-char VIN with OAuth2 + API Key)
 */
export async function lookupUkMotHistory(query, { byVin = false } = {}, fetchImpl = globalThis.fetch) {
  const apiKey = process.env.UK_MOT_API_KEY;
  if (!apiKey) return { configured: false, found: false };

  const clean = String(query || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const startedAt = performance.now();

  try {
    const { data } = await getCachedOrFetch({
      cacheKey: `uk_mot:${byVin ? 'vin' : 'reg'}:${clean}`,
      provider: 'uk_dvsa_mot',
      ttlMs: CACHE_TTLS.ukMot,
      fetcher: async () => {
        const bearer = await getUkDvsaBearerToken(fetchImpl);
        const endpoint = byVin
          ? `https://history.mot.api.gov.uk/v1/trade/vehicles/vin/${encodeURIComponent(clean)}`
          : `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(clean)}`;

        const headers = {
          Accept: 'application/json',
          'x-api-key': apiKey,
        };
        if (bearer) headers.Authorization = `Bearer ${bearer}`;

        const res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(8000), headers });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    });

    if (!data) {
      recordConnectorMetric('uk_dvsa_mot', 'online', performance.now() - startedAt, `${clean} non trouvé`);
      return { configured: true, found: false };
    }

    recordConnectorMetric('uk_dvsa_mot', 'online', performance.now() - startedAt, `${data.make || ''} ${data.model || ''}`.trim());
    return { configured: true, found: true, data };
  } catch (err) {
    recordConnectorMetric('uk_dvsa_mot', 'error', performance.now() - startedAt, err.message);
    return { configured: true, found: false, error: err.message };
  }
}

/**
 * Live Norway Statens Vegvesen lookup with SQLite TTL caching
 */
export async function lookupNorwayVegvesen(query, fetchImpl = globalThis.fetch) {
  const apiKey = process.env.NO_VEGVESEN_API_KEY;
  if (!apiKey) return { configured: false, found: false };

  const clean = String(query || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const param = clean.length === 17 ? `understellsnummer=${clean}` : `kjennemerke=${clean}`;
  const startedAt = performance.now();

  try {
    const { data } = await getCachedOrFetch({
      cacheKey: `no_vegvesen:${clean}`,
      provider: 'no_vegvesen',
      ttlMs: CACHE_TTLS.noVegvesen,
      fetcher: async () => {
        const res = await fetchImpl(
          `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?${param}`,
          {
            signal: AbortSignal.timeout(8000),
            headers: {
              Accept: 'application/json',
              'SVV-Authorization': `Apikey ${apiKey}`,
            },
          }
        );
        if (res.status === 404 || res.status === 204) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    });

    if (!data || !data.kjoretoydataListe?.length) {
      recordConnectorMetric('no_vegvesen', 'online', performance.now() - startedAt, `${clean} non trouvé`);
      return { configured: true, found: false };
    }

    recordConnectorMetric('no_vegvesen', 'online', performance.now() - startedAt, clean);
    return { configured: true, found: true, data };
  } catch (err) {
    recordConnectorMetric('no_vegvesen', 'error', performance.now() - startedAt, err.message);
    return { configured: true, found: false, error: err.message };
  }
}

/**
 * Optional configurable French SIV B2B adapter (activates when FR_SIV_API_URL + FR_SIV_API_KEY are set)
 */
export async function lookupFranceSivB2B(plate, fetchImpl = globalThis.fetch) {
  const apiUrl = process.env.FR_SIV_API_URL;
  const apiKey = process.env.FR_SIV_API_KEY;
  if (!apiUrl || !apiKey) return { configured: false, found: false };

  const clean = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const startedAt = performance.now();

  try {
    const { data } = await getCachedOrFetch({
      cacheKey: `fr_siv:${clean}`,
      provider: 'fr_siv_b2b',
      ttlMs: CACHE_TTLS.rdw,
      fetcher: async () => {
        const sep = apiUrl.includes('?') ? '&' : '?';
        const res = await fetchImpl(`${apiUrl}${sep}plaque=${encodeURIComponent(clean)}`, {
          signal: AbortSignal.timeout(8000),
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
          },
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    });

    if (!data) return { configured: true, found: false };
    recordConnectorMetric('fr_siv_b2b', 'online', performance.now() - startedAt, clean);
    return { configured: true, found: true, data };
  } catch (err) {
    recordConnectorMetric('fr_siv_b2b', 'error', performance.now() - startedAt, err.message);
    return { configured: true, found: false, error: err.message };
  }
}
