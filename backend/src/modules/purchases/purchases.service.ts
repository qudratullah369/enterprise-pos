/**
 * Purchases Service
 * Purchase Orders → Receive stock → create FIFO lots
 */

import { PrismaClient, Prisma, PurchaseStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';
import { fifoService } from '../inventory/fifo.service.js';

const prisma = new PrismaClient();

export interface PurchaseItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
  taxRate?: number;
}

export interface CreatePurchaseInput {
  supplierId: string;
  branchId: string;
  items: PurchaseItemInput[];
  expectedDate?: Date;
  notes?: string;
}

export class PurchasesService {
  async create(input: CreatePurchaseInput) {
    if (!input.items.length) throw new AppError('Purchase must have at least one item', 400);

    return prisma.$transaction(async (tx) => {
      const productIds = input.items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
      });
      if (products.length !== productIds.length) {
        throw new AppError('One or more products not found', 404);
      }

      let subtotal = new Prisma.Decimal(0);
      let taxAmount = new Prisma.Decimal(0);

      const lineData = input.items.map((item) => {
        const qty = new Prisma.Decimal(item.quantity);
        const cost = new Prisma.Decimal(item.unitCost);
        const taxRate = new Prisma.Decimal(item.taxRate ?? 0);
        const lineNet = qty.mul(cost);
        const lineTax = lineNet.mul(taxRate).div(100);
        subtotal = subtotal.add(lineNet);
        taxAmount = taxAmount.add(lineTax);
        return {
          productId: item.productId,
          quantity: qty,
          unitCost: cost,
          taxRate,
          lineTotal: lineNet.add(lineTax),
        };
      });

      const poNumber = await this.generatePoNumber(tx);

      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: input.supplierId,
          branchId: input.branchId,
          status: PurchaseStatus.ORDERED,
          expectedDate: input.expectedDate,
          notes: input.notes,
          subtotal,
          taxAmount,
          totalAmount: subtotal.add(taxAmount),
          items: {
            create: lineData.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitCost: l.unitCost,
              taxRate: l.taxRate,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          branch: true,
        },
      });

      return po;
    });
  }

  /**
   * Receive items on a PO. Creates InventoryLots (FIFO) and updates receivedQty.
   * Can be partial.
   */
  async receive(
    poId: string,
    items: Array<{ purchaseItemId: string; quantity: number; lotNumber?: string; expiryDate?: Date }>,
    userId?: string
  ) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });
      if (!po) throw new AppError('Purchase order not found', 404);
      if (po.status === PurchaseStatus.CANCELLED || po.status === PurchaseStatus.RECEIVED) {
        throw new AppError(`Cannot receive on PO with status ${po.status}`, 400);
      }

      for (const recv of items) {
        const line = po.items.find((i) => i.id === recv.purchaseItemId);
        if (!line) throw new AppError(`Purchase item ${recv.purchaseItemId} not found`, 404);

        const qty = new Prisma.Decimal(recv.quantity);
        if (qty.lte(0)) throw new AppError('Receive quantity must be positive', 400);

        const remaining = new Prisma.Decimal(line.quantity).sub(line.receivedQty);
        if (qty.gt(remaining)) {
          throw new AppError(
            `Cannot receive more than remaining (${remaining}) for item ${line.id}`,
            400
          );
        }

        // Create FIFO lot
        await fifoService.createLot({
          productId: line.productId,
          branchId: po.branchId,
          quantity: qty,
          unitCost: line.unitCost,
          purchaseItemId: line.id,
          lotNumber: recv.lotNumber,
          expiryDate: recv.expiryDate,
          tx,
        });

        // Update received qty
        await tx.purchaseItem.update({
          where: { id: line.id },
          data: { receivedQty: { increment: qty } },
        });

        // Stock movement
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            branchId: po.branchId,
            type: 'PURCHASE',
            quantity: qty,
            unitCost: line.unitCost,
            referenceId: po.id,
            referenceType: 'PURCHASE_ORDER',
            createdById: userId,
            notes: `PO ${po.poNumber}`,
          },
        });

        // Update product last cost
        await tx.product.update({
          where: { id: line.productId },
          data: { costPrice: line.unitCost },
        });
      }

      // Recalculate status
      const updatedItems = await tx.purchaseItem.findMany({ where: { purchaseOrderId: poId } });
      const allReceived = updatedItems.every((i) =>
        new Prisma.Decimal(i.receivedQty).gte(i.quantity)
      );
      const anyReceived = updatedItems.some((i) => new Prisma.Decimal(i.receivedQty).gt(0));

      const newStatus = allReceived
        ? PurchaseStatus.RECEIVED
        : anyReceived
          ? PurchaseStatus.PARTIAL
          : PurchaseStatus.ORDERED;

      return tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: newStatus,
          receivedDate: allReceived ? new Date() : undefined,
        },
        include: {
          items: { include: { product: true, inventoryLots: true } },
          supplier: true,
          branch: true,
        },
      });
    });
  }

  async findById(id: string) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: { include: { product: true, inventoryLots: true } },
        supplier: true,
        branch: true,
      },
    });
    if (!po) throw new AppError('Purchase order not found', 404);
    return po;
  }

  async list(params: { branchId?: string; status?: PurchaseStatus; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 30, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (params.branchId) where.branchId = params.branchId;
    if (params.status) where.status = params.status;

    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { supplier: true, branch: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  private async generatePoNumber(tx: Prisma.TransactionClient): Promise<string> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PO-${today}-`;
    const last = await tx.purchaseOrder.findFirst({
      where: { poNumber: { startsWith: prefix } },
      orderBy: { poNumber: 'desc' },
    });
    let seq = 1;
    if (last) {
      seq = parseInt(last.poNumber.split('-').pop() || '0', 10) + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }
}

export const purchasesService = new PurchasesService();
