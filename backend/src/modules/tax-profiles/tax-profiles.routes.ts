import { Router } from 'express';
import { z } from 'zod';
import { taxProfilesService } from './tax-profiles.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

const createSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(1).max(120),
  rate: z.number().min(0).max(100),
  inclusive: z.boolean().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const data = await taxProfilesService.list(
      req.query.activeOnly !== 'false'
    );

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const data = await taxProfilesService.findById(id);

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  authorize(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const data = await taxProfilesService.create(body);

      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  authorize(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  async (req, res, next) => {
    try {
      const body = createSchema.partial().parse(req.body);

      const id = req.params.id as string;
      const data = await taxProfilesService.update(id, body);

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/resolve/:productId',
  async (req, res, next) => {
    try {
      const productId = req.params.productId as string;
      const branchId =
        (req.query.branchId as string) ||
        req.user?.branchId ||
        undefined;

      const data = await taxProfilesService.resolveRate(
        productId,
        branchId
      );

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;