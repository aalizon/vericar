import { Router } from 'express';
import {
  listReportsByUser,
  getReportByIdForUser,
  deleteReportForUser,
  enableReportShare,
  revokeReportShare,
  getSharedReportByToken,
  getUserCreditsBalance,
} from '../db/repositories.js';
import {
  runVehiclePrecheck,
  executeVehicleLookup,
  generateReportFromHistovec,
} from '../services/reportAggregator.js';
import { getEuropeanRegistriesCatalog } from '../providers/euRegistries.js';
import { DEMO_CASES } from '../providers/demoCases.js';
import { SAMPLE_HISTOVEC_PAYLOAD, buildSellerRequestMessage } from '../providers/histovecParser.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/security.js';

export function createReportRoutes({ limiters, fetchImpl = globalThis.fetch }) {
  const router = Router();

  router.get('/samples', (_req, res) => {
    const demoCases = DEMO_CASES.map((d) => ({
      key: d.key,
      query: d.vehicle.vin,
      vin: d.vehicle.vin,
      plate: d.vehicle.plate,
      country: d.country,
      badge: d.badge,
      title: d.shortTitle,
      subtitle: d.subtitle,
    }));

    res.json({
      liveExamples: [
        {
          query: '21STVK',
          country: 'NL',
          type: 'plate',
          badge: 'Live API Pays-Bas · Compteur illogique',
          title: 'Volkswagen Caddy (Plaque NL temps réel)',
          subtitle: 'Requête live sur 5 datasets publics NL : défauts APK, rappel & compteur Onlogisch',
        },
        {
          query: 'HSF60S',
          country: 'NL',
          type: 'plate',
          badge: 'Live API Pays-Bas · Récent',
          title: 'Peugeot 308 (Plaque NL temps réel)',
          subtitle: 'Requête live sur le registre ouvert NL : prix neuf, CO2, Euro, statut assurance',
        },
        {
          query: 'WBA3A5C57CF256987',
          country: 'EU',
          type: 'vin',
          badge: 'Live VIN · vPIC + RappelConso + NHTSA',
          title: 'BMW Série 3 (VIN réel 17 caractères)',
          subtitle: 'Décodage ISO 3779 + fiche technique live vPIC + rappels constructeur en direct',
        },
      ],
      demoCases,
      demoDossiers: demoCases,
      sampleHistovec: SAMPLE_HISTOVEC_PAYLOAD,
      histovecSample: SAMPLE_HISTOVEC_PAYLOAD,
    });
  });

  // Consumer-safe public European registries directory (zero .env variable leaks)
  router.get('/registries', (_req, res) => {
    res.json({
      registries: getEuropeanRegistriesCatalog({ includeInternalMeta: false }),
    });
  });

  router.post(
    '/tools/seller-message',
    limiters.tools,
    asyncHandler(async (req, res) => {
      const { vehicleLabel, plate, country } = req.body || {};
      res.json({
        message: buildSellerRequestMessage({ vehicleLabel, plate, country }),
      });
    })
  );

  // Free, read-only 0-credit Pre-Check
  router.post(
    '/precheck',
    limiters.precheck,
    asyncHandler(async (req, res) => {
      const { query, country = 'AUTO' } = req.body || {};
      if (!query || typeof query !== 'string' || query.trim().length < 4) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Veuillez saisir un numéro VIN (17 caractères) ou une plaque d’immatriculation valide.',
          { field: 'query' }
        );
      }
      const preview = runVehiclePrecheck({
        query: query.trim(),
        country,
        userId: req.user?.id || null,
      });
      res.json(preview);
    })
  );

  // Credit-gated, idempotent Vehicle Report Lookup
  router.post(
    '/reports/lookup',
    limiters.lookup,
    asyncHandler(async (req, res) => {
      const { query, country = 'AUTO', forceRefresh = false } = req.body || {};
      if (!query || typeof query !== 'string' || query.trim().length < 4) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Le champ « query » (VIN ou plaque) est requis.',
          { field: 'query' }
        );
      }

      const result = await executeVehicleLookup({
        query: query.trim(),
        country,
        forceRefresh: Boolean(forceRefresh),
        user: req.user || null,
        fetchImpl,
      });

      const statusCode = result.alreadyUnlocked ? 200 : 201;
      res.status(statusCode).json({
        report: result.report,
        alreadyUnlocked: Boolean(result.alreadyUnlocked),
        creditCost: Number(result.creditCost || 0),
        ephemeral: Boolean(result.ephemeral),
        creditsBalance: req.user ? getUserCreditsBalance(req.user.id) : null,
      });
    })
  );

  // Authenticated 0-credit French HistoVec import & cross-border fusion
  router.post(
    '/reports/import-histovec',
    requireAuth,
    limiters.lookup,
    asyncHandler(async (req, res) => {
      const rawPayload = req.body?.payload ?? req.body?.input;
      if (!rawPayload) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Veuillez fournir les données HistoVec (JSON ou texte copié depuis le rapport officiel).',
          { field: 'payload' }
        );
      }
      const report = await generateReportFromHistovec(rawPayload, { userId: req.user.id, fetchImpl });
      res.status(201).json({
        report,
        creditCost: 0,
        creditsBalance: getUserCreditsBalance(req.user.id),
      });
    })
  );

  // User-scoped report library
  router.get(
    '/reports',
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
      res.json({ reports: listReportsByUser(req.user.id, { q, limit }) });
    })
  );

  router.get(
    '/reports/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const report = getReportByIdForUser(req.params.id, req.user.id, {
        isAdmin: req.user.role === 'admin',
      });
      if (!report) {
        throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport introuvable.');
      }
      res.json({ report });
    })
  );

  router.delete(
    '/reports/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const deleted = deleteReportForUser(req.params.id, req.user.id, {
        isAdmin: req.user.role === 'admin',
      });
      if (!deleted) {
        throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport introuvable.');
      }
      res.json({ deleted: true, id: req.params.id });
    })
  );

  // Verified share link management
  router.post(
    '/reports/:id/share',
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = enableReportShare(req.params.id, req.user.id, {
        isAdmin: req.user.role === 'admin',
        regenerate: Boolean(req.body?.regenerate),
      });
      if (!result) {
        throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport introuvable.');
      }
      res.json(result);
    })
  );

  router.delete(
    '/reports/:id/share',
    requireAuth,
    asyncHandler(async (req, res) => {
      const ok = revokeReportShare(req.params.id, req.user.id, {
        isAdmin: req.user.role === 'admin',
      });
      if (!ok) {
        throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport introuvable.');
      }
      res.json({ isShared: false });
    })
  );

  // Public read-only verified share endpoint
  router.get(
    '/share/:token',
    limiters.share,
    asyncHandler(async (req, res) => {
      const found = getSharedReportByToken(req.params.token);
      if (!found) {
        throw new AppError(404, 'SHARE_NOT_FOUND', 'Ce lien de partage est invalide ou a été révoqué.');
      }
      res.json({
        report: found.report,
        verifiedShare: true,
        sharedAt: found.sharedAt,
      });
    })
  );

  return router;
}
