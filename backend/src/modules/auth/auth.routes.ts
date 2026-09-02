import { Router } from 'express';
import { z } from 'zod';
import { authService } from './auth.service.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { AppError } from '../../shared/errors/AppError.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);
    const user = await authService.getProfile(req.user.userId);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});


export default router;
