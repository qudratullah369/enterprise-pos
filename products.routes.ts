import { Router } from 'express';
import { z } from 'zod';
import { productsService } from './products.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  sku: z.string().min(1).max(50),
  barcode: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  categoryId: z.string().cuid().optional(),
  unit: z.string().default('pcs'),
  costPrice: z.number().min(0),
  sellingPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  trackInventory: z.boolean().optional(),
  branchId: z.string().cuid().optional(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
  barcode: z.string().min(1).max(50).nullable().optional(),
  categoryId: z.string().cuid().nullable().optional(),
  description: z.string().nullable().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const data = await productsService.list({
      search: req.query.search as string | undefined,
      categoryId: req.query.categoryId as string | undefined,
      branchId: (req.query.branchId as string) || req.user?.branchId || undefined,
      isActive: req.query.isActive === 'false' ? false : true,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/barcode/:code', async (req, res, next) => {
  try {
    const product = await productsService.findByBarcode(req.params.code);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

router.get('/sku/:sku', async (req, res, next) => {
  try {
    const product = await productsService.findBySku(req.params.sku);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

router.get('/low-stock', authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY), async (req, res, next) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId || undefined;
    const items = await productsService.lowStock(branchId);
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const product = await productsService.findById(req.params.id);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/stock', async (req, res, next) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId;
    if (!branchId) throw new Error('branchId required');
    const stock = await productsService.getStock(req.params.id, branchId);
    res.json({ success: true, data: stock });
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const product = await productsService.create(body);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY), async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const product = await productsService.update(req.params.id, body);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

export default router;
