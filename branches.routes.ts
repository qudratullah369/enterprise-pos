import { Router } from 'express';
import { z } from 'zod';
import { branchesService } from './branches.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(1).max(120),
  address: z.string().max(300).optional(),
  phone: z.string().max(30).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(300).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** List all branches (for switcher) */
router.get('/', async (req, res, next) => {
  try {
    const data = await branchesService.list({
      search: req.query.search as string | undefined,
      activeOnly: req.query.activeOnly !== 'false',
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const data = await branchesService.findById(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/summary', async (req, res, next) => {
  try {
    const data = await branchesService.summary(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(Role.ADMIN), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const data = await branchesService.create(body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const data = await branchesService.update(req.params.id, body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
