import { Router } from 'express';
import { z } from 'zod';
import { categoriesService } from './categories.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  parentId: z.string().cuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  parentId: z.string().cuid().nullable().optional(),
});

/** Tree view (roots + nested children) */
router.get('/tree', async (_req, res, next) => {
  try {
    const data = await categoriesService.getTree();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/** Flat list */
router.get('/', async (req, res, next) => {
  try {
    const parentIdParam = req.query.parentId;
    let parentId: string | null | undefined = undefined;
    if (parentIdParam === 'null' || parentIdParam === '') parentId = null;
    else if (typeof parentIdParam === 'string') parentId = parentIdParam;

    const data = await categoriesService.list({
      search: req.query.search as string | undefined,
      parentId,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const data = await categoriesService.findById(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const data = await categoriesService.create(body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  authorize(Role.ADMIN, Role.MANAGER, Role.INVENTORY),
  async (req, res, next) => {
    try {
      const body = updateSchema.parse(req.body);
      const data = await categoriesService.update(req.params.id, body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  authorize(Role.ADMIN, Role.MANAGER),
  async (req, res, next) => {
    try {
      const data = await categoriesService.delete(req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
