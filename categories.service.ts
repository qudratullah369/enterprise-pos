/**
 * Categories Service
 * Supports hierarchical categories (parent / children).
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export class CategoriesService {
  async create(data: { name: string; description?: string; parentId?: string }) {
    if (data.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new AppError('Parent category not found', 404);
    }

    // Prevent duplicate names under the same parent
    const existing = await prisma.category.findFirst({
      where: {
        name: { equals: data.name, mode: 'insensitive' },
        parentId: data.parentId ?? null,
      },
    });
    if (existing) {
      throw new AppError('A category with this name already exists at this level', 409);
    }

    return prisma.category.create({
      data: {
        name: data.name,
        description: data.description,
        parentId: data.parentId,
      },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async update(
    id: string,
    data: Partial<{ name: string; description: string | null; parentId: string | null }>
  ) {
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) throw new AppError('Category not found', 404);

    if (data.parentId !== undefined && data.parentId !== null) {
      if (data.parentId === id) {
        throw new AppError('A category cannot be its own parent', 400);
      }
      // Prevent cycles: parent cannot be a descendant of this category
      const isDescendant = await this.isDescendant(data.parentId, id);
      if (isDescendant) {
        throw new AppError('Cannot set a descendant category as parent (cycle detected)', 400);
      }
      const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new AppError('Parent category not found', 404);
    }

    return prisma.category.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        parentId: data.parentId,
      },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async findById(id: string) {
    const cat = await prisma.category.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true } },
        children: {
          select: {
            id: true,
            name: true,
            description: true,
            _count: { select: { products: true, children: true } },
          },
          orderBy: { name: 'asc' },
        },
        _count: { select: { products: true } },
      },
    });
    if (!cat) throw new AppError('Category not found', 404);
    return cat;
  }

  /**
   * Flat list with optional search + pagination.
   */
  async list(params: { search?: string; parentId?: string | null; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 100, 200);
    const skip = (page - 1) * limit;

    const where: Prisma.CategoryWhereInput = {};
    if (params.search) {
      where.name = { contains: params.search, mode: 'insensitive' };
    }
    if (params.parentId !== undefined) {
      where.parentId = params.parentId; // null = root categories
    }

    const [items, total] = await Promise.all([
      prisma.category.findMany({
        where,
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { products: true, children: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.category.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Full tree (root → children recursively).
   * Suitable for category pickers and navigation.
   */
  async getTree() {
    const all = await prisma.category.findMany({
      include: {
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    type Node = (typeof all)[0] & { children: Node[] };
    const map = new Map<string, Node>();
    const roots: Node[] = [];

    for (const cat of all) {
      map.set(cat.id, { ...cat, children: [] });
    }

    for (const cat of all) {
      const node = map.get(cat.id)!;
      if (cat.parentId && map.has(cat.parentId)) {
        map.get(cat.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async delete(id: string) {
    const cat = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!cat) throw new AppError('Category not found', 404);
    if (cat._count.children > 0) {
      throw new AppError('Cannot delete a category that has sub-categories. Move or delete children first.', 400);
    }
    if (cat._count.products > 0) {
      throw new AppError('Cannot delete a category that still has products. Reassign products first.', 400);
    }

    await prisma.category.delete({ where: { id } });
    return { id };
  }

  /** Check whether `candidateId` is a descendant of `ancestorId`. */
  private async isDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
    let current = await prisma.category.findUnique({ where: { id: candidateId } });
    const visited = new Set<string>();
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      if (visited.has(current.parentId)) break; // safety
      visited.add(current.parentId);
      current = await prisma.category.findUnique({ where: { id: current.parentId } });
    }
    return false;
  }
}

export const categoriesService = new CategoriesService();
