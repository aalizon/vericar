import { Router } from 'express';
import {
  registerUser,
  loginUser,
  logoutSession,
  updateProfile,
  changePassword,
  exportAccountData,
  deleteAccount,
} from '../services/authService.js';
import {
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
} from '../middleware/auth.js';
import { asyncHandler, normalizeIp } from '../middleware/security.js';

export function createAuthRoutes({ limiters, configOverrides = {} }) {
  const router = Router();

  router.post(
    '/auth/register',
    limiters.auth,
    asyncHandler(async (req, res) => {
      const { email, password, fullName, companyName, acceptedTerms } = req.body || {};
      const result = await registerUser(
        {
          email,
          password,
          fullName,
          companyName,
          acceptedTerms,
          ipAddress: normalizeIp(req.ip || req.socket?.remoteAddress),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
        },
        configOverrides
      );

      setSessionCookie(res, result.rawToken, req, configOverrides);
      res.status(201).json({
        user: result.user,
        signupBonusCredits: result.signupBonusCredits,
      });
    })
  );

  router.post(
    '/auth/login',
    limiters.auth,
    asyncHandler(async (req, res) => {
      const { email, password } = req.body || {};
      const result = await loginUser(
        {
          email,
          password,
          ipAddress: normalizeIp(req.ip || req.socket?.remoteAddress),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
        },
        configOverrides
      );

      setSessionCookie(res, result.rawToken, req, configOverrides);
      res.json({ user: result.user });
    })
  );

  router.post(
    '/auth/logout',
    asyncHandler(async (req, res) => {
      if (req.sessionTokenHash) {
        logoutSession(req.sessionTokenHash);
      }
      clearSessionCookie(res, req, configOverrides);
      res.json({ ok: true });
    })
  );

  router.get('/auth/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      authenticated: Boolean(req.user),
      user: req.user || null,
    });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  router.patch(
    '/auth/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { fullName, companyName } = req.body || {};
      const result = updateProfile(req.user.id, { fullName, companyName });
      res.json({ user: result.user });
    })
  );

  router.post(
    '/auth/password',
    requireAuth,
    limiters.auth,
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body || {};
      const result = await changePassword(req.user.id, req.sessionTokenHash, {
        currentPassword,
        newPassword,
      });
      res.json(result);
    })
  );

  router.get(
    '/account/export',
    requireAuth,
    asyncHandler(async (req, res) => {
      const data = exportAccountData(req.user.id);
      res.setHeader('Content-Disposition', 'attachment; filename="vericar-export.json"');
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    })
  );

  router.delete(
    '/account',
    requireAuth,
    limiters.auth,
    asyncHandler(async (req, res) => {
      const { password, confirmation } = req.body || {};
      const result = await deleteAccount(req.user.id, { password, confirmation });
      clearSessionCookie(res, req, configOverrides);
      res.json(result);
    })
  );

  return router;
}
