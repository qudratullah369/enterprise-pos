/**
 * Branches Service
 * Multi-branch support for enterprise POS.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export class BranchesService {
  async list(params: { search?: string; activeOnly?: boolean; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.BranchWhereInput = {};
    if (params.activeOnly !== false) where.isActive = true;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { code: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              users: true,
              sales: true,
              inventoryLots: true,
            },
          },
        },
      }),
      prisma.branch.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string) {
    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, sales: true, products: true, inventoryLots: true },
        },
      },
    });
    if (!branch) throw new AppError('Branch not found', 404);
    return branch;
  }

  async create(data: {
    code: string;
    name: string;
    address?: string;
    phone?: string;
    currencyCode?: string;
    currencySymbol?: string;
    taxProfileId?: string;
  }) {
    const exists = await prisma.branch.findUnique({ where: { code: data.code } });
    if (exists) throw new AppError('Branch code already exists', 409);

    return prisma.branch.create({
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        address: data.address,
        phone: data.phone,
        currencyCode: data.currencyCode ?? 'USD',
        currencySymbol: data.currencySymbol ?? '$',
        taxProfileId: data.taxProfileId,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      address: string | null;
      phone: string | null;
      isActive: boolean;
      currencyCode: string;
      currencySymbol: string;
      taxProfileId: string | null;
    }>
  ) {
    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new AppError('Branch not found', 404);

    return prisma.branch.update({
      where: { id },
      data,
    });
  }

  /**
   * Summary stats for a branch (used by switcher / dashboard).
   */
  async summary(id: string) {
    const branch = await this.findById(id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todaySales, openRegisters, productCount] = await Promise.all([
      prisma.sale.aggregate({
        where: {
          branchId: id,
          status: 'COMPLETED',
          createdAt: { gte: today, lt: tomorrow },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.cashRegister.count({
        where: { branchId: id, closedAt: null },
      }),
      prisma.product.count({
        where: { OR: [{ branchId: id }, { branchId: null }], isActive: true },
      }),
    ]);

    return {
      branch,
      todaySales: todaySales._sum.totalAmount ?? 0,
      todayTransactions: todaySales._count,
      openRegisters,
      productCount,
    };
  }
}

export const branchesService = new BranchesService();
