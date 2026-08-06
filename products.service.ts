/**
 * Products Service
 * CRUD + barcode / SKU lookup + stock summary
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';
import { fifoService } from '../inventory/fifo.service.js';

const prisma = new PrismaClient();

export interface CreateProductInput {
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  categoryId?: string;
  unit?: string;
  costPrice: number;
  sellingPrice: number;
  taxRate?: number;
  reorderLevel?: number;
  trackInventory?: boolean;
  branchId?: string;
}

export interface UpdateProductInput {
  sku?: string;
  barcode?: string | null;
  name?: string;
  description?: string | null;
  categoryId?: string | null;
  unit?: string;
  costPrice?: number;
  sellingPrice?: number;
  taxRate?: number;
  reorderLevel?: number;
  isActive?: boolean;
  trackInventory?: boolean;
}

export class ProductsService {
  async create(data: CreateProductInput) {
    const existing = await prisma.product.findFirst({
      where: {
        OR: [
          { sku: data.sku },
          ...(data.barcode ? [{ barcode: data.barcode }] : []),
        ],
      },
    });
    if (existing) {
      throw new AppError('SKU or barcode already exists', 409);
    }

    return prisma.product.create({
      data: {
        sku: data.sku,
        barcode: data.barcode,
        name: data.name,
        description: data.description,
        categoryId: data.categoryId,
        unit: data.unit ?? 'pcs',
        costPrice: data.costPrice,
        sellingPrice: data.sellingPrice,
        taxRate: data.taxRate ?? 0,
        reorderLevel: data.reorderLevel ?? 10,
        trackInventory: data.trackInventory ?? true,
        branchId: data.branchId,
      },
      include: { category: true },
    });
  }

  async update(id: string, data: UpdateProductInput) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new AppError('Product not found', 404);

    if (data.sku || data.barcode) {
      const conflict = await prisma.product.findFirst({
        where: {
          id: { not: id },
          OR: [
            ...(data.sku ? [{ sku: data.sku }] : []),
            ...(data.barcode ? [{ barcode: data.barcode }] : []),
          ],
        },
      });
      if (conflict) throw new AppError('SKU or barcode already exists', 409);
    }

    return prisma.product.update({
      where: { id },
      data: {
        ...data,
        costPrice: data.costPrice !== undefined ? new Prisma.Decimal(data.costPrice) : undefined,
        sellingPrice: data.sellingPrice !== undefined ? new Prisma.Decimal(data.sellingPrice) : undefined,
        taxRate: data.taxRate !== undefined ? new Prisma.Decimal(data.taxRate) : undefined,
      },
      include: { category: true },
    });
  }

  async findById(id: string) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!product) throw new AppError('Product not found', 404);
    return product;
  }

  async findByBarcode(barcode: string) {
    const product = await prisma.product.findUnique({
      where: { barcode },
      include: { category: true },
    });
    if (!product || !product.isActive) {
      throw new AppError('Product not found for barcode', 404);
    }
    return product;
  }

  async findBySku(sku: string) {
    const product = await prisma.product.findUnique({
      where: { sku },
      include: { category: true },
    });
    if (!product || !product.isActive) {
      throw new AppError('Product not found for SKU', 404);
    }
    return product;
  }

  async list(params: {
    search?: string;
    categoryId?: string;
    branchId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.branchId) where.OR = [{ branchId: params.branchId }, { branchId: null }];
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { sku: { contains: params.search, mode: 'insensitive' } },
        { barcode: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getStock(productId: string, branchId: string) {
    return fifoService.getStockValuation(productId, branchId);
  }

  async lowStock(branchId?: string) {
    // Products where sum of lot quantities <= reorderLevel
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        trackInventory: true,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      include: {
        inventoryLots: {
          where: {
            quantity: { gt: 0 },
            ...(branchId ? { branchId } : {}),
          },
        },
      },
    });

    return products
      .map((p) => {
        const onHand = p.inventoryLots.reduce(
          (sum, lot) => sum.add(lot.quantity),
          new Prisma.Decimal(0)
        );
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          reorderLevel: p.reorderLevel,
          quantityOnHand: onHand,
          isLow: onHand.lte(p.reorderLevel),
        };
      })
      .filter((p) => p.isLow);
  }
}

export const productsService = new ProductsService();
