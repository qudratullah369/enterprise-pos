/**
 * FIFO Inventory Service
 * ======================
 * Core costing engine for the enterprise POS.
 *
 * Rules:
 * - Incoming stock (purchases, transfers in) creates new InventoryLot records.
 * - Outgoing stock (sales, damage, etc.) consumes from the oldest lots first (FIFO).
 * - Every consumption is recorded in FifoConsumption for accurate COGS & audit.
 * - Cost of Goods Sold is calculated precisely from the lots that were actually used.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

const prisma = new PrismaClient();

export interface ConsumeResult {
  totalCost: Prisma.Decimal;
  consumptions: Array<{
    lotId: string;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    totalCost: Prisma.Decimal;
  }>;
}

export class FifoService {
  /**
   * Consume quantity of a product from a branch using FIFO.
   * Returns the total cost of goods and the list of lot consumptions.
   * Throws if insufficient stock.
   */
  async consume(
    productId: string,
    branchId: string,
    quantity: number | Prisma.Decimal,
    saleItemId: string,
    tx?: Prisma.TransactionClient
  ): Promise<ConsumeResult> {
    const client = tx ?? prisma;
    const qtyNeeded = new Prisma.Decimal(quantity);

    if (qtyNeeded.lte(0)) {
      throw new AppError('Quantity to consume must be positive', 400);
    }

    // Fetch open lots ordered by receivedAt ASC (oldest first) — true FIFO
    const lots = await client.inventoryLot.findMany({
      where: {
        productId,
        branchId,
        quantity: { gt: 0 },
      },
      orderBy: { receivedAt: 'asc' },
      // lock rows if using serializable / for update (PostgreSQL)
    });

    let remaining = qtyNeeded;
    const consumptions: ConsumeResult['consumptions'] = [];
    let totalCost = new Prisma.Decimal(0);

    for (const lot of lots) {
      if (remaining.lte(0)) break;

      const available = new Prisma.Decimal(lot.quantity);
      const take = Prisma.Decimal.min(available, remaining);

      const lineCost = take.mul(lot.unitCost);
      totalCost = totalCost.add(lineCost);

      // Update lot remaining quantity
      await client.inventoryLot.update({
        where: { id: lot.id },
        data: { quantity: available.sub(take) },
      });

      // Record the exact consumption for audit & COGS
      await client.fifoConsumption.create({
        data: {
          saleItemId,
          inventoryLotId: lot.id,
          quantity: take,
          unitCost: lot.unitCost,
          totalCost: lineCost,
        },
      });

      consumptions.push({
        lotId: lot.id,
        quantity: take,
        unitCost: lot.unitCost,
        totalCost: lineCost,
      });

      remaining = remaining.sub(take);
    }

    if (remaining.gt(0)) {
      throw new AppError(
        `Insufficient stock for product ${productId}. Short by ${remaining.toString()}`,
        400
      );
    }

    return { totalCost, consumptions };
  }

  /**
   * Create a new inventory lot (from purchase receipt, transfer, adjustment, etc.)
   */
  async createLot(params: {
    productId: string;
    branchId: string;
    quantity: number | Prisma.Decimal;
    unitCost: number | Prisma.Decimal;
    purchaseItemId?: string;
    lotNumber?: string;
    expiryDate?: Date;
    receivedAt?: Date;
    tx?: Prisma.TransactionClient;
  }) {
    const client = params.tx ?? prisma;
    const qty = new Prisma.Decimal(params.quantity);
    const cost = new Prisma.Decimal(params.unitCost);

    if (qty.lte(0)) {
      throw new AppError('Lot quantity must be positive', 400);
    }

    return client.inventoryLot.create({
      data: {
        productId: params.productId,
        branchId: params.branchId,
        purchaseItemId: params.purchaseItemId,
        lotNumber: params.lotNumber,
        quantity: qty,
        originalQty: qty,
        unitCost: cost,
        receivedAt: params.receivedAt ?? new Date(),
        expiryDate: params.expiryDate,
      },
    });
  }

  /**
   * Get current on-hand quantity and FIFO valuation for a product at a branch.
   */
  async getStockValuation(productId: string, branchId: string) {
    const lots = await prisma.inventoryLot.findMany({
      where: {
        productId,
        branchId,
        quantity: { gt: 0 },
      },
      orderBy: { receivedAt: 'asc' },
    });

    let totalQty = new Prisma.Decimal(0);
    let totalValue = new Prisma.Decimal(0);

    const breakdown = lots.map((lot) => {
      const qty = new Prisma.Decimal(lot.quantity);
      const value = qty.mul(lot.unitCost);
      totalQty = totalQty.add(qty);
      totalValue = totalValue.add(value);
      return {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        quantity: qty,
        unitCost: lot.unitCost,
        value,
        receivedAt: lot.receivedAt,
        expiryDate: lot.expiryDate,
      };
    });

    return {
      productId,
      branchId,
      quantityOnHand: totalQty,
      inventoryValue: totalValue,
      averageCost: totalQty.gt(0) ? totalValue.div(totalQty) : new Prisma.Decimal(0),
      lots: breakdown,
    };
  }

  /**
   * Restore stock to lots when a sale is voided / returned (reverse FIFO consumption).
   * We put the quantity back onto the original lots that were consumed.
   */
  async restoreFromConsumptions(
    saleItemId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma;

    const consumptions = await client.fifoConsumption.findMany({
      where: { saleItemId },
    });

    for (const c of consumptions) {
      await client.inventoryLot.update({
        where: { id: c.inventoryLotId },
        data: {
          quantity: { increment: c.quantity },
        },
      });
    }

    // Optionally soft-delete or keep the consumption records for history
    await client.fifoConsumption.deleteMany({
      where: { saleItemId },
    });
  }
}

export const fifoService = new FifoService();
