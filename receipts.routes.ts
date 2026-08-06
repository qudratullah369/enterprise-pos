import { Router } from 'express';
import { receiptsService } from './receipts.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

/**
 * GET /api/receipts/:saleId
 * Returns ESC/POS base64 + HTML + plain text for printing.
 */
router.get(
  '/:saleId',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT),
  async (req, res, next) => {
    try {
      const data = await receiptsService.getSaleReceipt(req.params.saleId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/receipts/:saleId/html
 * Returns pure HTML suitable for window.print() or Save as PDF.
 */
router.get(
  '/:saleId/html',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT),
  async (req, res, next) => {
    try {
      const data = await receiptsService.getSaleReceipt(req.params.saleId);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(data.html);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/receipts/:saleId/escpos
 * Returns raw ESC/POS binary (application/octet-stream).
 */
router.get(
  '/:saleId/escpos',
  authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER),
  async (req, res, next) => {
    try {
      const data = await receiptsService.getSaleReceipt(req.params.saleId);
      const buf = Buffer.from(data.escposBase64, 'base64');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="receipt-${data.invoiceNumber}.bin"`
      );
      res.send(buf);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
