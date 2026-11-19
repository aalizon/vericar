import { Router } from 'express';
import {
  getPacksPayload,
  createCheckout,
  completeSandboxOrder,
  getBillingSummary,
  getUserOrders,
  getOrderWithReceipt,
  renderReceiptHtml,
} from '../services/billingService.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, isHttpsRequest } from '../middleware/security.js';

function resolveRequestBaseUrl(req) {
  const proto = isHttpsRequest(req) ? 'https' : 'http';
  const host = req.get('host');
  return host ? `${proto}://${host}` : null;
}

export function createBillingRoutes({ limiters, configOverrides = {}, fetchImpl = globalThis.fetch }) {
  const router = Router();

  router.get('/billing/packs', (_req, res) => {
    res.json(getPacksPayload(configOverrides));
  });

  router.post(
    '/billing/checkout',
    requireAuth,
    limiters.billing,
    asyncHandler(async (req, res) => {
      const { packId, acceptedWaiver } = req.body || {};
      const baseUrl = resolveRequestBaseUrl(req);
      const result = await createCheckout(
        {
          user: req.user,
          packId,
          acceptedWaiver,
          baseUrl,
        },
        configOverrides,
        fetchImpl
      );
      res.status(201).json(result);
    })
  );

  router.post(
    '/billing/sandbox/complete',
    requireAuth,
    limiters.billing,
    asyncHandler(async (req, res) => {
      const { orderId } = req.body || {};
      const result = completeSandboxOrder(
        { userId: req.user.id, orderId },
        configOverrides
      );
      res.json(result);
    })
  );

  router.get(
    '/billing/summary',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(getBillingSummary(req.user.id));
    })
  );

  router.get(
    '/billing/orders',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(getUserOrders(req.user.id));
    })
  );

  router.get(
    '/billing/orders/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = getOrderWithReceipt(req.params.id, req.user, configOverrides);
      res.json(result);
    })
  );

  router.get(
    '/billing/orders/:id/receipt',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { receipt } = getOrderWithReceipt(req.params.id, req.user, configOverrides);
      const format = String(req.query.format || 'json').toLowerCase();
      if (format === 'html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(renderReceiptHtml(receipt));
      }
      res.json({ receipt });
    })
  );

  return router;
}
