/**
 * Cash Register / Shift Service
 * =============================
 * Manages open/close of cash drawer sessions per cashier + branch.
 * Provides expected cash calculation from completed sales in the session window.
 */

import { PrismaClient, Prisma, PaymentMethod, SaleStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export class CashRegistersService {
  /**
   * Open a new cash register session for a user at a branch.
   * Only one open session per user is allowed.
   */
  async open(params: {
    branchId: string;
    userId: string;
    openingFloat: number;
    notes?: string;
  }) {
    // Ensure no open session already exists for this user
    const existing = await prisma.cashRegister.findFirst({
      where: {
        userId: params.userId,
        closedAt: null,
      },
    });

    if (existing) {
      throw new AppError(
        'You already have an open cash register session. Close it before opening a new one.',
        409
      );
    }

    // Validate branch exists
    const branch = await prisma.branch.findUnique({ where: { id: params.branchId } });
    if (!branch || !branch.isActive) {
      throw new AppError('Branch not found or inactive', 404);
    }

    return prisma.cashRegister.create({
      data: {
        branchId: params.branchId,
        userId: params.userId,
        openingFloat: new Prisma.Decimal(params.openingFloat),
        notes: params.notes,
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  /**
   * Get the currently open session for a user (or null).
   */
  async getOpenSession(userId: string) {
    return prisma.cashRegister.findFirst({
      where: { userId, closedAt: null },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { openedAt: 'desc' },
    });
  }

  /**
   * Close a cash register session.
   * Calculates expected cash from cash payments during the session.
   */
  async close(params: {
    registerId: string;
    userId: string; // the user closing (must own the session or be manager)
    closingCash: number;
    notes?: string;
    isManagerOverride?: boolean;
  }) {
    const register = await prisma.cashRegister.findUnique({
      where: { id: params.registerId },
    });

    if (!register) {
      throw new AppError('Cash register session not found', 404);
    }
    if (register.closedAt) {
      throw new AppError('This session is already closed', 400);
    }
    if (register.userId !== params.userId && !params.isManagerOverride) {
      throw new AppError('You can only close your own cash register session', 403);
    }

    // Calculate expected cash:
    // openingFloat + sum of CASH payments from completed sales in this window
    // (by this cashier at this branch)
    const salesSummary = await prisma.sale.aggregate({
      where: {
        branchId: register.branchId,
        cashierId: register.userId,
        status: SaleStatus.COMPLETED,
        paymentMethod: PaymentMethod.CASH,
        createdAt: { gte: register.openedAt },
      },
      _sum: { totalAmount: true },
    });

    // Also include mixed payments that have a cash component via SalePayment
    const cashPayments = await prisma.salePayment.aggregate({
      where: {
        method: PaymentMethod.CASH,
        sale: {
          branchId: register.branchId,
          cashierId: register.userId,
          status: SaleStatus.COMPLETED,
          createdAt: { gte: register.openedAt },
        },
      },
      _sum: { amount: true },
    });

    // Prefer detailed payment lines if they exist, otherwise fall back to totalAmount of pure CASH sales
    const cashFromPayments = cashPayments._sum.amount ?? new Prisma.Decimal(0);
    const cashFromPureSales =
      cashFromPayments.gt(0)
        ? new Prisma.Decimal(0) // already counted via payments
        : (salesSummary._sum.totalAmount ?? new Prisma.Decimal(0));

    const expectedCash = new Prisma.Decimal(register.openingFloat)
      .add(cashFromPayments)
      .add(cashFromPureSales);

    const closingCash = new Prisma.Decimal(params.closingCash);
    const difference = closingCash.sub(expectedCash);

    return prisma.cashRegister.update({
      where: { id: params.registerId },
      data: {
        closingCash,
        expectedCash,
        difference,
        closedAt: new Date(),
        notes: params.notes ?? register.notes,
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  /**
   * Get a summary of sales activity during an open or closed session.
   */
  async getSessionSummary(registerId: string) {
    const register = await prisma.cashRegister.findUnique({
      where: { id: registerId },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!register) {
      throw new AppError('Cash register session not found', 404);
    }

    const endTime = register.closedAt ?? new Date();

    const sales = await prisma.sale.findMany({
      where: {
        branchId: register.branchId,
        cashierId: register.userId,
        createdAt: { gte: register.openedAt, lte: endTime },
        status: { in: [SaleStatus.COMPLETED, SaleStatus.VOIDED] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        paymentMethod: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const completed = sales.filter((s) => s.status === SaleStatus.COMPLETED);
    const voided = sales.filter((s) => s.status === SaleStatus.VOIDED);

    const byMethod: Record<string, Prisma.Decimal> = {};
    let totalSales = new Prisma.Decimal(0);

    for (const s of completed) {
      const method = s.paymentMethod;
      byMethod[method] = (byMethod[method] ?? new Prisma.Decimal(0)).add(s.totalAmount);
      totalSales = totalSales.add(s.totalAmount);
    }

    return {
      register,
      summary: {
        totalSales,
        saleCount: completed.length,
        voidCount: voided.length,
        byPaymentMethod: byMethod,
      },
      sales,
    };
  }

  /**
   * List recent sessions (for managers / admin).
   */
  async list(params: {
    branchId?: string;
    userId?: string;
    openOnly?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const where: Prisma.CashRegisterWhereInput = {};
    if (params.branchId) where.branchId = params.branchId;
    if (params.userId) where.userId = params.userId;
    if (params.openOnly) where.closedAt = null;

    const [items, total] = await Promise.all([
      prisma.cashRegister.findMany({
        where,
        include: {
          branch: { select: { id: true, code: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { openedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.cashRegister.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
}

export const cashRegistersService = new CashRegistersService();
