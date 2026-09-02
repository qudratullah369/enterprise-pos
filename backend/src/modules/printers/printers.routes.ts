import { Router } from 'express';
import { z } from 'zod';
import { printersService } from './printers.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

const printSchema = z.object({
  driver: z.enum(['log', 'network', 'file']).optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
});

/**
 * POST /api/printers/receipts/:saleId
 * Send ESC/POS receipt to a printer (log / network / file).
 */
router.post(
  '/receipts/:saleId',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER),
  async (req, res, next) => {
    try {
      const body = printSchema.parse(req.body ?? {});
      const saleId = req.params.saleId as string;
      const data = await printersService.printSaleReceipt(saleId, body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;