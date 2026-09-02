import { Router } from 'express';
import { z } from 'zod';
import { salesService } from './sales.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role, PaymentMethod } from '@prisma/client';

const router = Router();

router.use(authenticate);

const createSaleSchema = z.object({
  branchId: z.string().cuid(),
  customerId: z.string().cuid().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().cuid(),
        quantity: z.number().positive(),
        unitPrice: z.number().positive().optional(),
        discount: z.number().min(0).optional(),
      })
    )
    .min(1),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paidAmount: z.number().min(0),
  discountAmount: z.number().min(0).optional(),
  notes: z.string().optional(),
});

router.post('/', authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER), async (req, res, next) => {
  try {
    const body = createSaleSchema.parse(req.body);
    const sale = await salesService.createSale({
      ...body,
      cashierId: req.user!.userId,
    });
    res.status(201).json({ success: true, data: sale });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/void', authorize(Role.ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    const reason = z.string().min(3).parse(req.body.reason);
    const id = req.params.id as string;
    const sale = await salesService.voidSale(id, req.user!.userId, reason);
    res.json({ success: true, data: sale });
  } catch (err) {
    next(err);
  }
});

const refundSchema = z.object({
  items: z
    .array(
      z.object({
        saleItemId: z.string().cuid(),
        quantity: z.number().positive(),
      })
    )
    .min(1),
  reason: z.string().min(3).max(500),
});

router.post(
  '/:id/refund',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER),
  async (req, res, next) => {
    try {
      const body = refundSchema.parse(req.body);
      const id = req.params.id as string;
      const sale = await salesService.refundSale(
        id,
        req.user!.userId,
        body.items,
        body.reason
      );
      res.json({ success: true, data: sale });
    } catch (err) {
      next(err);
    }
  }
);

export default router;