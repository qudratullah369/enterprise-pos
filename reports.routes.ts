import { Router } from 'express';
import { reportsService } from './reports.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

const managerRoles = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

router.get('/daily-sales', authorize(...managerRoles), async (req, res, next) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date' });
    }
    const branchId = (req.query.branchId as string) || req.user?.branchId || undefined;
    const report = await reportsService.dailySalesReport(date, branchId);
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

router.get('/inventory-valuation', authorize(...managerRoles), async (req, res, next) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId || undefined;
    const report = await reportsService.inventoryValuation(branchId);
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/** Dashboard KPIs – accessible to cashiers too for their branch view */
router.get(
  '/dashboard',
  authorize(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CASHIER),
  async (req, res, next) => {
    try {
      const branchId = (req.query.branchId as string) || req.user?.branchId || undefined;
      const data = await reportsService.dashboard(branchId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/** CSV export – daily sales (opens in Excel) */
router.get('/export/daily-sales.csv', authorize(...managerRoles), async (req, res, next) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date' });
    }
    const branchId = (req.query.branchId as string) || req.user?.branchId || undefined;
    const csv = await reportsService.exportDailySalesCsv(date, branchId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="daily-sales-${dateStr}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/** CSV export – inventory valuation */
router.get('/export/inventory.csv', authorize(...managerRoles), async (req, res, next) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId || undefined;
    const csv = await reportsService.exportInventoryCsv(branchId);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="inventory-valuation-${dateStr}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
