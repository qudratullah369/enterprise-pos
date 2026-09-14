import { Router } from 'express';
import { z } from 'zod';
import { cashRegistersService } from './cash-registers.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';
import { assertBranchAccess, resolveAuthorizedBranch } from '../../shared/authorization/branch.js';

const router = Router();
router.use(authenticate);

const openSchema = z.object({
  branchId: z.string().cuid(),
  openingFloat: z.number().min(0),
  notes: z.string().max(500).optional(),
});

const closeSchema = z.object({
  closingCash: z.number().min(0),
  notes: z.string().max(500).optional(),
});

/** Open a new cash register session */
router.post(
  '/open',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER),
  async (req, res, next) => {
    try {
      const body = openSchema.parse(req.body);
      assertBranchAccess(req.user!, body.branchId);
      const data = await cashRegistersService.open({
        branchId: body.branchId,
        userId: req.user!.userId,
        openingFloat: body.openingFloat,
        notes: body.notes,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/** Get my currently open session */
router.get('/me/open', async (req, res, next) => {
  try {
    const data = await cashRegistersService.getOpenSession(req.user!.userId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/** Close a session */
router.post(
  '/:id/close',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER),
  async (req, res, next) => {
    try {
      const body = closeSchema.parse(req.body);
      const isManager =
        req.user!.role === Role.ADMIN || req.user!.role === Role.MANAGER;

      const id = req.params.id as string;

      const data = await cashRegistersService.close({
  registerId: id,
  user: {
    userId: req.user!.userId,
    role: req.user!.role,
    branchId: req.user!.branchId,
  },
  closingCash: body.closingCash,
  notes: body.notes,
  isManagerOverride: isManager,
});
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/** Session summary (sales during the shift) */
router.get(
  '/:id/summary',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const data = await cashRegistersService.getSessionSummary({
  registerId: id,
  user: {
    userId: req.user!.userId,
    role: req.user!.role,
    branchId: req.user!.branchId,
  },
});
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/** List sessions (managers / admin) */
router.get(
  '/',
  authorize(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  async (req, res, next) => {
    try {
      const data = await cashRegistersService.list({
        branchId:
          resolveAuthorizedBranch(
            req.user!,
            req.query.branchId as string | undefined,
          ) ?? undefined,
        userId: req.query.userId as string | undefined,
        openOnly: req.query.openOnly === 'true',
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;