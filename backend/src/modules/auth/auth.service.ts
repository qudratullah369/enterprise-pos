import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient, Role } from '@prisma/client';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export interface LoginInput {
  email: string;
  password: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  branchId?: string | null;
}

export class AuthService {
  async login({ email, password }: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { branch: true },
    });

    if (!user || !user.isActive) {
      throw new AppError('Invalid credentials', 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError('Invalid credentials', 401);
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        branchId: user.branchId,
        branch: user.branch
          ? { id: user.branch.id, code: user.branch.code, name: user.branch.name }
          : null,
      },
    };
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      throw new AppError('Invalid or expired token', 401);
    }
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { branch: true },
    });

    if (!user || !user.isActive) {
      throw new AppError('User not found', 404);
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      branchId: user.branchId,
      branch: user.branch
        ? { id: user.branch.id, code: user.branch.code, name: user.branch.name }
        : null,
    };
  }
}

export const authService = new AuthService();