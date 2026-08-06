import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export class CustomersService {
  async create(data: {
    name: string;
    code?: string;
    email?: string;
    phone?: string;
    address?: string;
    branchId?: string;
  }) {
    if (data.code) {
      const exists = await prisma.customer.findUnique({ where: { code: data.code } });
      if (exists) throw new AppError('Customer code already exists', 409);
    }
    return prisma.customer.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; email: string; phone: string; address: string; isActive: boolean }>) {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new AppError('Customer not found', 404);
    return prisma.customer.update({ where: { id }, data });
  }

  async findById(id: string) {
    const c = await prisma.customer.findUnique({ where: { id } });
    if (!c) throw new AppError('Customer not found', 404);
    return c;
  }

  async list(params: { search?: string; branchId?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const where: Prisma.CustomerWhereInput = { isActive: true };
    if (params.branchId) where.branchId = params.branchId;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { code: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { name: 'asc' }, skip, take: limit }),
      prisma.customer.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
}

export const customersService = new CustomersService();
