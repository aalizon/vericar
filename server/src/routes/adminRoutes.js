import { Router } from 'express';
import {
  getAdminOverviewKpis,
  getConnectorStats24h,
  listRecentOrdersForAdmin,
  listRecentReportsForAdmin,
  listRecentUsersForAdmin,
  listUsersForAdmin,
  findUserById,
  adjustUserCreditsAtomic,
} from '../db/repositories.js';
import { getCacheStats } from '../services/apiCache.js';
import { getEuropeanRegistriesCatalog } from '../providers/euRegistries.js';
import { getBillingModeInfo } from '../services/billingService.js';
import { requireAdmin } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/security.js';

export function createAdminRoutes({ configOverrides = {} }) {
  const router = Router();

  router.use('/admin', requireAdmin);

  router.get(
    '/admin/overview',
    asyncHandler(async (_req, res) => {
      const kpis = getAdminOverviewKpis();
      const telemetry24h = getConnectorStats24h();
      const registries = getEuropeanRegistriesCatalog({ includeInternalMeta: true });
      const cache = getCacheStats();
      const billing = getBillingModeInfo(configOverrides);

      res.json({
        kpis,
        billing,
        cache,
        connectors: {
          telemetry24h,
          registries,
        },
        recentOrders: listRecentOrdersForAdmin(20),
        recentReports: listRecentReportsForAdmin(20),
        recentUsers: listRecentUsersForAdmin(20),
      });
    })
  );

  router.get(
    '/admin/users',
    asyncHandler(async (req, res) => {
      const search = typeof req.query.q === 'string' ? req.query.q : typeof req.query.search === 'string' ? req.query.search : '';
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      res.json(listUsersForAdmin({ search, limit, offset }));
    })
  );

  router.post(
    '/admin/users/:id/credits',
    asyncHandler(async (req, res) => {
      const targetId = req.params.id;
      const { delta, description } = req.body || {};
      const parsedDelta = Number(delta);

      if (!Number.isInteger(parsedDelta) || parsedDelta === 0 || Math.abs(parsedDelta) > 1000) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Le delta de crédits doit être un entier non nul compris entre -1000 et 1000.',
          { field: 'delta' }
        );
      }

      const cleanDesc = String(description || '').trim();
      if (cleanDesc.length < 3 || cleanDesc.length > 200) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Veuillez indiquer un motif d’ajustement (3 à 200 caractères).',
          { field: 'description' }
        );
      }

      const existing = findUserById(targetId);
      if (!existing) {
        throw new AppError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
      }

      let result;
      try {
        result = adjustUserCreditsAtomic(targetId, {
          delta: parsedDelta,
          reason: parsedDelta > 0 ? 'admin_grant' : 'admin_adjustment',
          referenceId: req.user.id,
          description: `[Admin ${req.user.email}] ${cleanDesc}`,
        });
      } catch (err) {
        if (err?.code === 'INSUFFICIENT_CREDITS') {
          throw new AppError(
            400,
            'INSUFFICIENT_CREDITS',
            'Cet ajustement rendrait le solde de l’utilisateur négatif.'
          );
        }
        throw err;
      }

      const updatedUser = result.user || findUserById(targetId);
      res.json({
        user: updatedUser,
        ledgerEntry: result.ledgerEntry,
      });
    })
  );

  return router;
}
