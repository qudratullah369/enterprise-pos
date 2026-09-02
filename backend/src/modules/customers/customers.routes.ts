import { Router } from 'express';
import { z } from 'zod';
import { customersService } from './customers.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().optional(),
  branchId: z.string().cuid().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const data = await customersService.list({
      search: req.query.search as string | undefined,
      branchId: (req.query.branchId as string) || req.user?.branchId || undefined,
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
    const id = req.params.id as string;
    const data = await customersService.findById(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(Role.ADMIN, Role.MANAGER, Role.CASHIER), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const data = await customersService.create(body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    const body = createSchema
      .partial()
      .extend({ isActive: z.boolean().optional() })
      .parse(req.body);

    const id = req.params.id as string;
    const data = await customersService.update(id, body);

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;