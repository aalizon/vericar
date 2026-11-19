import {
  getCacheEntry,
  upsertCacheEntry,
  deleteCacheEntry,
  deleteCacheByProvider,
  pruneExpiredCacheEntries,
  getCacheStatsRows,
} from '../db/repositories.js';

export const CACHE_TTLS = Object.freeze({
  // Seconds-based canonical constants
  NHTSA_VPIC: 30 * 24 * 60 * 60, // 30 days
  RDW_META: 30 * 24 * 60 * 60, // 30 days
  RDW_VEHICLE: 6 * 60 * 60, // 6 hours
  RAPPELCONSO: 12 * 60 * 60, // 12 hours
  NHTSA_RECALLS: 24 * 60 * 60, // 24 hours
  UK_MOT: 6 * 60 * 60, // 6 hours
  NO_VEGVESEN: 6 * 60 * 60, // 6 hours
  FR_SIV: 6 * 60 * 60, // 6 hours
  // Millisecond aliases used by providers ({ ttlMs })
  vpic: 30 * 24 * 60 * 60 * 1000,
  rdw: 6 * 60 * 60 * 1000,
  rdwMeta: 30 * 24 * 60 * 60 * 1000,
  rappelconso: 12 * 60 * 60 * 1000,
  nhtsaRecalls: 24 * 60 * 60 * 1000,
  ukMot: 6 * 60 * 60 * 1000,
  noVegvesen: 6 * 60 * 60 * 1000,
  frSiv: 6 * 60 * 60 * 1000,
});

const inFlightRequests = new Map();
let cacheWriteCount = 0;

/**
 * Fetches data using SQLite-backed TTL cache with in-flight deduplication
 * and stale-while-error fallback when an upstream provider fails.
 * Accepts either `(key, provider, ttlSec, fetcher, options)` or
 * `({ cacheKey, key, provider, ttlMs, ttlSec, fetcher, forceRefresh, allowStaleOnError, shouldCache })`.
 */
export async function getCachedOrFetch(keyOrOpts, providerArg, ttlSecArg, fetcherArg, optionsArg = {}) {
  let key;
  let provider;
  let ttlSec;
  let fetcher;
  let options;

  if (keyOrOpts && typeof keyOrOpts === 'object') {
    key = keyOrOpts.cacheKey ?? keyOrOpts.key;
    provider = keyOrOpts.provider;
    if (keyOrOpts.ttlMs !== undefined) {
      ttlSec = Math.round(Number(keyOrOpts.ttlMs) / 1000);
    } else {
      ttlSec = keyOrOpts.ttlSec ?? keyOrOpts.ttl ?? 3600;
    }
    fetcher = keyOrOpts.fetcher;
    options = {
      forceRefresh: keyOrOpts.forceRefresh,
      allowStaleOnError: keyOrOpts.allowStaleOnError,
      shouldCache: keyOrOpts.shouldCache,
    };
  } else {
    key = keyOrOpts;
    provider = providerArg;
    ttlSec = ttlSecArg;
    fetcher = fetcherArg;
    options = optionsArg || {};
  }

  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('apiCache: key must be a non-empty string');
  }
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new TypeError('apiCache: provider must be a non-empty string');
  }
  if (typeof fetcher !== 'function') {
    throw new TypeError('apiCache: fetcher must be a function');
  }

  const {
    forceRefresh = false,
    allowStaleOnError = true,
    shouldCache = (value) => value !== undefined,
  } = options;

  let entry = null;
  let hasCachedValue = false;
  let cachedValue;

  try {
    entry = getCacheEntry(key);
    if (entry) {
      try {
        cachedValue = JSON.parse(entry.payloadJson);
        hasCachedValue = true;
      } catch {
        // Self-heal corrupted cache row
        try {
          deleteCacheEntry(key);
        } catch {
          // Ignore delete failure
        }
        entry = null;
      }
    }
  } catch {
    // DB read error falls through to live fetch
    entry = null;
  }

  const nowMs = Date.now();
  if (hasCachedValue && !forceRefresh && Date.parse(entry.expiresAt) > nowMs) {
    return {
      data: cachedValue,
      cached: true,
      stale: false,
      fetchedAt: entry.fetchedAt,
      expiresAt: entry.expiresAt,
    };
  }

  if (!forceRefresh && inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }

  const runFetch = (async () => {
    try {
      const freshData = await fetcher();
      const fetchedMs = Date.now();
      const safeTtlSec = Math.max(0, Number(ttlSec) || 0);
      const fetchedAt = new Date(fetchedMs).toISOString();
      const expiresAt = new Date(fetchedMs + safeTtlSec * 1000).toISOString();

      if (safeTtlSec > 0 && shouldCache(freshData)) {
        const payloadJson = JSON.stringify(freshData);
        if (payloadJson !== undefined) {
          try {
            upsertCacheEntry({
              cacheKey: key,
              provider,
              payloadJson,
              fetchedAt,
              expiresAt,
            });
            cacheWriteCount += 1;
            if (cacheWriteCount % 50 === 0) {
              pruneExpiredCache({ gracePeriodSec: 86400 });
            }
          } catch {
            // Cache write error must not break fresh response
          }
        }
      }

      return {
        data: freshData,
        cached: false,
        stale: false,
        fetchedAt,
        expiresAt,
      };
    } catch (err) {
      if (hasCachedValue && allowStaleOnError !== false) {
        return {
          data: cachedValue,
          cached: true,
          stale: true,
          fetchedAt: entry.fetchedAt,
          expiresAt: entry.expiresAt,
          error: err?.message || String(err),
        };
      }
      throw err;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  if (!forceRefresh) {
    inFlightRequests.set(key, runFetch);
  }

  return runFetch;
}

export function pruneExpiredCache({ gracePeriodSec = 0 } = {}) {
  const safeGrace = Math.max(0, Number(gracePeriodSec) || 0);
  const cutoffIso = new Date(Date.now() - safeGrace * 1000).toISOString();
  const deleted = pruneExpiredCacheEntries(cutoffIso);
  return { deleted };
}

export function invalidateCacheKey(key) {
  return deleteCacheEntry(key);
}

export function clearCacheByProvider(provider) {
  const deleted = deleteCacheByProvider(provider);
  return { deleted };
}

export function getCacheStats() {
  return getCacheStatsRows(new Date().toISOString());
}
