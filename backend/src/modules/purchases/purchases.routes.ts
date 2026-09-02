import { Router } from 'express';
import { z } from 'zod';
import { purchasesService } from './purchases.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role, PurchaseStatus } from '@prisma/client';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  supplierId: z.string().cuid(),
  branchId: z.string().cuid(),
  items: z
    .array(
      z.object({
        productId: z.string().cuid(),
        quantity: z.number().positive(),
        unitCost: z.number().min(0),
        taxRate: z.number().min(0).max(100).optional(),
      })
    )
    .min(1),
  expectedDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        purchaseItemId: z.string().cuid(),
        quantity: z.number().positive(),
        lotNumber: z.string().optional(),
        expiryDate: z.string().datetime().optional(),
      })
    )
    .min(1),
});

router.get('/', authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY), async (req, res, next) => {
  try {
    const data = await purchasesService.list({
      branchId: (req.query.branchId as string) || req.user?.branchId || undefined,
      status: req.query.status as PurchaseStatus | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 30,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const po = await purchasesService.findById(id);
    res.json({ success: true, data: po });
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const po = await purchasesService.create({
      ...body,
      expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
    });
    res.status(201).json({ success: true, data: po });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/receive',
  authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY),
  async (req, res, next) => {
    try {
      const body = receiveSchema.parse(req.body);
      const id = req.params.id as string;

      const po = await purchasesService.receive(
        id,
        body.items.map((i) => ({
          ...i,
          expiryDate: i.expiryDate ? new Date(i.expiryDate) : undefined,
        })),
        req.user!.userId
      );
      res.json({ success: true, data: po });
    } catch (err) {
      next(err);
    }
  }
);

export default router;