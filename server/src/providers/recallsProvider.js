import { recordConnectorMetric } from '../db/repositories.js';
import { getCachedOrFetch, CACHE_TTLS } from '../services/apiCache.js';

const RAPPELCONSO_DATASET = 'rappelconso-v2-gtin-espaces';

const MAKE_ALIASES = {
  'MERCEDES-BENZ': 'MERCEDES',
  'MERCEDES BENZ': 'MERCEDES',
  'VOLKSWAGEN': 'VOLKSWAGEN',
  'VW': 'VOLKSWAGEN',
  'CITROËN': 'CITROEN',
  'ŠKODA': 'SKODA',
  'ALFA ROMEO': 'ALFA',
  'LAND ROVER': 'LAND ROVER',
  'DS AUTOMOBILES': 'DS',
  'FORD EUROPE': 'FORD',
  'TOYOTA UK': 'TOYOTA',
  'BMW M': 'BMW',
  'BMW I': 'BMW',
  'BMW USA': 'BMW',
  'AUDI SPORT': 'AUDI',
};

export function normalizeBrandForRecall(make) {
  const upper = String(make || '')
    .trim()
    .toUpperCase()
    .replace(/["'\\]/g, '');
  if (!upper) return '';
  return MAKE_ALIASES[upper] || upper;
}

export function extractModelKeyword(make, model) {
  const raw = String(model || '').trim().replace(/["'\\]/g, '');
  if (!raw || /non renseigné|à confirmer|issu de/i.test(raw)) return '';

  // Handle French "Série 3 320d" / "Classe A" / "Golf 8" cleanly
  const serieMatch = raw.match(/^(?:S[ée]rie|Classe|Model)\s+([A-Z0-9]+)/i);
  if (serieMatch) {
    return `${serieMatch[0]}`.trim();
  }
  const firstToken = raw.split(/[\s/]+/)[0] || '';
  if (firstToken.length < 2) return '';
  if (firstToken.toUpperCase() === normalizeBrandForRecall(make)) return '';
  return firstToken;
}

/**
 * Queries French official RappelConso Open Data (data.economie.gouv.fr)
 * using the `rappelconso-v2-gtin-espaces` dataset (contains automotive vehicles)
 * with SQLite TTL caching & stale-while-error fallback.
 */
export async function fetchRappelConsoRecalls(make, model = '', fetchImpl = globalThis.fetch) {
  const normalizedMake = normalizeBrandForRecall(make);
  if (!normalizedMake) return [];

  const modelKeyword = extractModelKeyword(normalizedMake, model);
  const cacheKey = `rappelconso:${normalizedMake}:${modelKeyword.toUpperCase()}`;

  const { data } = await getCachedOrFetch({
    cacheKey,
    provider: 'rappelconso_fr',
    ttlMs: CACHE_TTLS.rappelconso,
    fetcher: async () => {
      const startedAt = performance.now();
      try {
        const baseFilter = [
          '(categorie_produit like "automobiles" OR sous_categorie_produit like "automobiles")',
          `(marque_produit like "${normalizedMake}" OR modeles_ou_references like "${normalizedMake}")`,
        ];

        const queryUrl = (where) =>
          `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${RAPPELCONSO_DATASET}/records?limit=6&order_by=date_publication%20DESC&where=${encodeURIComponent(where)}`;

        let matchScope = 'brand';
        let records = [];

        if (modelKeyword) {
          matchScope = 'model';
          const resModel = await fetchImpl(
            queryUrl([...baseFilter, `modeles_ou_references like "${modelKeyword}"`].join(' AND ')),
            { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } }
          );
          if (resModel.ok) {
            const payload = await resModel.json();
            records = payload.results || [];
          }
        }

        if (records.length === 0) {
          matchScope = 'brand';
          const resBrand = await fetchImpl(queryUrl(baseFilter.join(' AND ')), {
            signal: AbortSignal.timeout(8000),
            headers: { Accept: 'application/json' },
          });
          if (!resBrand.ok) throw new Error(`HTTP ${resBrand.status}`);
          const payload = await resBrand.json();
          records = payload.results || [];
        }

        const latency = performance.now() - startedAt;
        recordConnectorMetric('rappelconso_fr', 'online', latency, `${records.length} fiche(s) (${normalizedMake})`);

        return records.map((r) => ({
          campaignId: r.numero_fiche || 'RAPPELCONSO',
          date: r.date_publication ? String(r.date_publication).slice(0, 10) : null,
          source: 'RappelConso France (DGCCRF / Safety Gate)',
          matchScope,
          status: 'advisory',
          statusLabel:
            matchScope === 'model'
              ? 'À vérifier en concession (correspondance modèle)'
              : 'Rappel marque récent — vérifiez la plage VIN concernée',
          component: r.sous_categorie_produit || r.modeles_ou_references || 'Véhicule / équipement',
          description: r.motif_rappel || r.libelle || 'Rappel de sécurité constructeur',
          risk: r.risques_encourus || null,
          remedy: r.conduites_a_tenir_par_le_consommateur || null,
          officialUrl: r.lien_vers_la_fiche_rappel || null,
          affectedModels: r.modeles_ou_references || null,
        }));
      } catch (err) {
        recordConnectorMetric('rappelconso_fr', 'degraded', performance.now() - startedAt, err.message);
        throw err;
      }
    },
  }).catch(() => ({ data: [] }));

  return Array.isArray(data) ? data : [];
}

/**
 * Queries NHTSA Safety Recalls API by make, model, and modelYear with TTL caching.
 */
export async function fetchNhtsaRecalls(make, model, year, fetchImpl = globalThis.fetch) {
  const cleanMake = normalizeBrandForRecall(make);
  const cleanModel = extractModelKeyword(cleanMake, model);
  if (!cleanMake || !cleanModel || !year) return [];

  const cacheKey = `nhtsa_recalls:${cleanMake}:${cleanModel.toUpperCase()}:${year}`;

  const { data } = await getCachedOrFetch({
    cacheKey,
    provider: 'nhtsa_recalls',
    ttlMs: CACHE_TTLS.nhtsaRecalls,
    fetcher: async () => {
      const startedAt = performance.now();
      try {
        const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(cleanMake)}&model=${encodeURIComponent(cleanModel)}&modelYear=${encodeURIComponent(year)}`;
        const res = await fetchImpl(url, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const list = payload.results || [];
        recordConnectorMetric('nhtsa_recalls', 'online', performance.now() - startedAt, `${list.length} rappel(s)`);

        return list.slice(0, 6).map((r) => ({
          campaignId: r.NHTSACampaignNumber || 'NHTSA',
          date: r.ReportReceivedDate || null,
          source: 'NHTSA Safety Recalls (International)',
          matchScope: 'model',
          status: 'advisory',
          statusLabel: 'Campagne sécurité répertoriée — vérifier statut VIN',
          component: r.Component || 'Sécurité véhicule',
          description: r.Summary || 'Campagne de rappel sécurité',
          risk: r.Consequence || null,
          remedy: r.Remedy || null,
          officialUrl: 'https://www.nhtsa.gov/recalls',
        }));
      } catch (err) {
        recordConnectorMetric('nhtsa_recalls', 'degraded', performance.now() - startedAt, err.message);
        throw err;
      }
    },
  }).catch(() => ({ data: [] }));

  return Array.isArray(data) ? data : [];
}
