/**
 * Tax Profiles Service
 * Manage reusable tax rates (VAT, GST, sales tax) for multi-region setups.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export class TaxProfilesService {
  async list(activeOnly = true) {
    return prisma.taxProfile.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: 'asc' },
      include: { _count: { select: { branches: true, products: true } } },
    });
  }

  async findById(id: string) {
    const p = await prisma.taxProfile.findUnique({
      where: { id },
      include: { _count: { select: { branches: true, products: true } } },
    });
    if (!p) throw new AppError('Tax profile not found', 404);
    return p;
  }

  async create(data: {
    code: string;
    name: string;
    rate: number;
    inclusive?: boolean;
  }) {
    const exists = await prisma.taxProfile.findUnique({ where: { code: data.code } });
    if (exists) throw new AppError('Tax profile code already exists', 409);
    return prisma.taxProfile.create({
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        rate: new Prisma.Decimal(data.rate),
        inclusive: data.inclusive ?? false,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{ name: string; rate: number; inclusive: boolean; isActive: boolean }>
  ) {
    await this.findById(id);
    return prisma.taxProfile.update({
      where: { id },
      data: {
        name: data.name,
        rate: data.rate !== undefined ? new Prisma.Decimal(data.rate) : undefined,
        inclusive: data.inclusive,
        isActive: data.isActive,
      },
    });
  }

  /**
   * Resolve effective tax rate for a product at a branch.
   * Priority: product.taxProfile → product.taxRate → branch.taxProfile → 0
   */
  async resolveRate(productId: string, branchId?: string): Promise<{
    rate: number;
    inclusive: boolean;
    source: string;
  }> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { taxProfile: true },
    });
    if (!product) throw new AppError('Product not found', 404);

    if (product.taxProfile) {
      return {
        rate: Number(product.taxProfile.rate),
        inclusive: product.taxProfile.inclusive,
        source: `product-profile:${product.taxProfile.code}`,
      };
    }

    if (Number(product.taxRate) > 0) {
      return {
        rate: Number(product.taxRate),
        inclusive: false,
        source: 'product.taxRate',
      };
    }

    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        include: { taxProfile: true },
      });
      if (branch?.taxProfile) {
        return {
          rate: Number(branch.taxProfile.rate),
          inclusive: branch.taxProfile.inclusive,
          source: `branch-profile:${branch.taxProfile.code}`,
        };
      }
    }

    return { rate: 0, inclusive: false, source: 'none' };
  }
}

export const taxProfilesService = new TaxProfilesService();
