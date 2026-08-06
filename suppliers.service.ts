import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export class SuppliersService {
  async create(data: {
    code: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
  }) {
    const exists = await prisma.supplier.findUnique({ where: { code: data.code } });
    if (exists) throw new AppError('Supplier code already exists', 409);
    return prisma.supplier.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; contactName: string; email: string; phone: string; address: string; isActive: boolean }>) {
    const s = await prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new AppError('Supplier not found', 404);
    return prisma.supplier.update({ where: { id }, data });
  }

  async findById(id: string) {
    const s = await prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new AppError('Supplier not found', 404);
    return s;
  }

  async list(params: { search?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const where: Prisma.SupplierWhereInput = { isActive: true };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { code: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, skip, take: limit }),
      prisma.supplier.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
}

export const suppliersService = new SuppliersService();
