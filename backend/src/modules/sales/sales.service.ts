/**
 * Sales Service
 * Handles complete sale lifecycle with FIFO COGS calculation.
 */

import { PrismaClient, Prisma, PaymentMethod, SaleStatus } from '@prisma/client';
import { fifoService } from '../inventory/fifo.service.js';
import { AppError } from '../../shared/errors/AppError.js';
import { assertBranchAccess } from '../../shared/authorization/branch.js';

const prisma = new PrismaClient();

export interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number; // optional override
  discount?: number;
}

export interface CreateSaleInput {
  branchId: string;
  cashierId: string;
  customerId?: string;
  items: SaleItemInput[];
  paymentMethod: PaymentMethod;
  paidAmount: number;
  discountAmount?: number;
  notes?: string;
}

export class SalesService {
  /**
   * Create a complete sale:
   * 1. Validate products & stock
   * 2. Calculate totals
   * 3. Consume inventory via FIFO (inside transaction)
   * 4. Record COGS on each sale line
   * 5. Create payment record
   * 6. Generate invoice number
   */
  async createSale(input: CreateSaleInput) {
    if (!input.items || input.items.length === 0) {
      throw new AppError('Sale must contain at least one item', 400);
    }

    return prisma.$transaction(async (tx) => {
      // ── 1. Load products ──────────────────────────────────────────────────
      const productIds = input.items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
      });

      if (products.length !== productIds.length) {
        throw new AppError('One or more products not found or inactive', 404);
      }

      const productMap = new Map(products.map((p) => [p.id, p]));

      // ── 2. Build line items & calculate totals ────────────────────────────
      let subtotal = new Prisma.Decimal(0);
      let taxAmount = new Prisma.Decimal(0);

      const lineData: Array<{
        productId: string;
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        discount: Prisma.Decimal;
        taxRate: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
      }> = [];

      for (const item of input.items) {
        const product = productMap.get(item.productId)!;
        const qty = new Prisma.Decimal(item.quantity);
        const unitPrice = new Prisma.Decimal(item.unitPrice ?? product.sellingPrice);
        const discount = new Prisma.Decimal(item.discount ?? 0);
        const taxRate = new Prisma.Decimal(product.taxRate);

        const lineNet = qty.mul(unitPrice).sub(discount);
        const lineTax = lineNet.mul(taxRate).div(100);
        const lineTotal = lineNet.add(lineTax);

        subtotal = subtotal.add(lineNet);
        taxAmount = taxAmount.add(lineTax);

        lineData.push({
          productId: item.productId,
          quantity: qty,
          unitPrice,
          discount,
          taxRate,
          taxAmount: lineTax,
          lineTotal,
        });
      }

      const discountAmount = new Prisma.Decimal(input.discountAmount ?? 0);
      const totalAmount = subtotal.add(taxAmount).sub(discountAmount);
      const paidAmount = new Prisma.Decimal(input.paidAmount);
      const changeAmount = paidAmount.sub(totalAmount);

      if (changeAmount.lt(0)) {
        throw new AppError('Paid amount is less than total', 400);
      }

      // ── 3. Generate invoice number ────────────────────────────────────────
      const invoiceNumber = await this.generateInvoiceNumber(input.branchId, tx);

      // ── 4. Create Sale header ─────────────────────────────────────────────
      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          branchId: input.branchId,
          cashierId: input.cashierId,
          customerId: input.customerId,
          status: SaleStatus.COMPLETED,
          subtotal,
          discountAmount,
          taxAmount,
          totalAmount,
          paidAmount,
          changeAmount,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
        },
      });

      // ── 5. Create sale items + FIFO consume ───────────────────────────────
      let totalCogs = new Prisma.Decimal(0);

      for (const line of lineData) {
        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineTotal: line.lineTotal,
            costOfGoods: 0, // will update after FIFO
          },
        });

        // FIFO consumption
        const { totalCost } = await fifoService.consume(
          line.productId,
          input.branchId,
          line.quantity,
          saleItem.id,
          tx
        );

        await tx.saleItem.update({
          where: { id: saleItem.id },
          data: { costOfGoods: totalCost },
        });

        totalCogs = totalCogs.add(totalCost);

        // Stock movement log
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            branchId: input.branchId,
            type: 'SALE',
            quantity: line.quantity.neg(),
            unitCost: totalCost.div(line.quantity),
            referenceId: sale.id,
            referenceType: 'SALE',
            createdById: input.cashierId,
          },
        });
      }

      // ── 6. Payment record ─────────────────────────────────────────────────
      await tx.salePayment.create({
        data: {
          saleId: sale.id,
          method: input.paymentMethod,
          amount: paidAmount,
        },
      });

      // Return full sale with items
      return tx.sale.findUnique({
        where: { id: sale.id },
        include: {
          items: {
            include: {
              product: true,
              fifoConsumptions: true,
            },
          },
          payments: true,
          cashier: { select: { id: true, firstName: true, lastName: true } },
          customer: true,
          branch: true,
        },
      });
    });
  }

  /**
   * Void a sale and restore inventory via reverse FIFO.
   */
  async voidSale(params: {
    saleId: string;
    user: { userId: string; role: string; branchId?: string | null };
    reason: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: params.saleId },
        include: { items: true },
      });

      if (!sale) throw new AppError('Sale not found', 404);

      // Branch isolation
      assertBranchAccess(
        { role: params.user.role, branchId: params.user.branchId },
        sale.branchId,
      );

      if (sale.status === SaleStatus.VOIDED) {
        throw new AppError('Sale is already voided', 400);
      }
      if (sale.status === SaleStatus.REFUNDED) {
        throw new AppError('Sale is already fully refunded', 400);
      }

      // Restore stock for each item
      for (const item of sale.items) {
        await fifoService.restoreFromConsumptions(item.id, tx);

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            branchId: sale.branchId,
            type: 'RETURN_SALE',
            quantity: item.quantity, // positive = back into stock
            unitCost: item.costOfGoods.div(item.quantity),
            referenceId: sale.id,
            referenceType: 'SALE_VOID',
            createdById: params.user.userId,
            notes: params.reason,
          },
        });
      }

      return tx.sale.update({
        where: { id: params.saleId },
        data: {
          status: SaleStatus.VOIDED,
          voidedAt: new Date(),
          voidedById: params.user.userId,
          voidReason: params.reason,
        },
        include: { items: true },
      });
    });
  }

  /**
   * Partial or full refund of a completed sale.
   * Restores inventory proportionally from the original FIFO consumptions
   * and records a negative payment.
   */
  async refundSale(
    saleId: string,
    refundedById: string,
    items: Array<{ saleItemId: string; quantity: number }>,
    reason: string
  ) {
    if (!items.length) {
      throw new AppError('At least one item must be refunded', 400);
    }

    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: {
            include: { fifoConsumptions: true },
          },
          payments: true,
        },
      });

      if (!sale) throw new AppError('Sale not found', 404);
      if (sale.status === SaleStatus.VOIDED) {
        throw new AppError('Cannot refund a voided sale', 400);
      }
      if (sale.status === SaleStatus.REFUNDED) {
        throw new AppError('Sale is already fully refunded', 400);
      }

      const itemMap = new Map(sale.items.map((i) => [i.id, i]));
      let refundSubtotal = new Prisma.Decimal(0);
      let refundTax = new Prisma.Decimal(0);
      let anyFull = true;

      for (const refund of items) {
        const saleItem = itemMap.get(refund.saleItemId);
        if (!saleItem) {
          throw new AppError(`Sale item ${refund.saleItemId} not found on this sale`, 404);
        }

        const qty = new Prisma.Decimal(refund.quantity);
        if (qty.lte(0)) {
          throw new AppError('Refund quantity must be positive', 400);
        }
        if (qty.gt(saleItem.quantity)) {
          throw new AppError(
            `Cannot refund more than sold quantity for item ${saleItem.id}`,
            400
          );
        }

        // Proportional money amounts
        const ratio = qty.div(saleItem.quantity);
        const lineRefundNet = saleItem.unitPrice.mul(qty).sub(saleItem.discount.mul(ratio));
        const lineRefundTax = saleItem.taxAmount.mul(ratio);
        refundSubtotal = refundSubtotal.add(lineRefundNet);
        refundTax = refundTax.add(lineRefundTax);

        // Restore stock from original FIFO consumptions (proportional / sequential)
        const consumptions = saleItem.fifoConsumptions;
        let remainingToRestore = qty;

        // Restore newest consumption first (reverse of FIFO consume order)
        for (let i = consumptions.length - 1; i >= 0 && remainingToRestore.gt(0); i--) {
          const c = consumptions[i];
          const available = new Prisma.Decimal(c.quantity);
          const restoreQty = Prisma.Decimal.min(available, remainingToRestore);

          await tx.inventoryLot.update({
            where: { id: c.inventoryLotId },
            data: { quantity: { increment: restoreQty } },
          });

          if (restoreQty.eq(available)) {
            await tx.fifoConsumption.delete({ where: { id: c.id } });
          } else {
            await tx.fifoConsumption.update({
              where: { id: c.id },
              data: {
                quantity: available.sub(restoreQty),
                totalCost: available.sub(restoreQty).mul(c.unitCost),
              },
            });
          }

          remainingToRestore = remainingToRestore.sub(restoreQty);
        }

        // Update sale item quantity & totals
        const newQty = saleItem.quantity.sub(qty);
        if (newQty.eq(0)) {
          // Fully refunded this line – keep record but zero it for clarity
          await tx.saleItem.update({
            where: { id: saleItem.id },
            data: {
              quantity: 0,
              lineTotal: 0,
              taxAmount: 0,
              discount: 0,
              costOfGoods: 0,
            },
          });
        } else {
          anyFull = false;
          const newRatio = newQty.div(saleItem.quantity);
          await tx.saleItem.update({
            where: { id: saleItem.id },
            data: {
              quantity: newQty,
              lineTotal: saleItem.lineTotal.mul(newRatio),
              taxAmount: saleItem.taxAmount.mul(newRatio),
              discount: saleItem.discount.mul(newRatio),
              costOfGoods: saleItem.costOfGoods.mul(newRatio),
            },
          });
        }

        // Stock movement
        await tx.stockMovement.create({
          data: {
            productId: saleItem.productId,
            branchId: sale.branchId,
            type: 'RETURN_SALE',
            quantity: qty,
            unitCost: saleItem.costOfGoods.div(saleItem.quantity),
            referenceId: sale.id,
            referenceType: 'SALE_REFUND',
            createdById: refundedById,
            notes: reason,
          },
        });
      }

      const refundTotal = refundSubtotal.add(refundTax);

      // Negative payment record
      await tx.salePayment.create({
        data: {
          saleId: sale.id,
          method: sale.paymentMethod,
          amount: refundTotal.neg(),
          reference: `REFUND: ${reason.slice(0, 80)}`,
        },
      });

      // Determine new status
      const remainingItems = await tx.saleItem.findMany({ where: { saleId } });
      const allZero = remainingItems.every((i) => new Prisma.Decimal(i.quantity).eq(0));
      const newStatus = allZero ? SaleStatus.REFUNDED : SaleStatus.PARTIAL_REFUND;

      // Adjust sale header totals
      const newSubtotal = sale.subtotal.sub(refundSubtotal);
      const newTax = sale.taxAmount.sub(refundTax);
      const newTotal = sale.totalAmount.sub(refundTotal);

      return tx.sale.update({
        where: { id: saleId },
        data: {
          status: newStatus,
          subtotal: newSubtotal,
          taxAmount: newTax,
          totalAmount: newTotal,
          notes: sale.notes
            ? `${sale.notes}\n[REFUND] ${reason}`
            : `[REFUND] ${reason}`,
        },
        include: {
          items: { include: { product: true, fifoConsumptions: true } },
          payments: true,
          cashier: { select: { id: true, firstName: true, lastName: true } },
          customer: true,
          branch: true,
        },
      });
    });
  }

  private async generateInvoiceNumber(

    branchId: string,
    tx: Prisma.TransactionClient
  ): Promise<string> {
    const today = new Date();
    const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `INV-${datePart}-`;

    const last = await tx.sale.findFirst({
      where: {
        branchId,
        invoiceNumber: { startsWith: prefix },
      },
      orderBy: { invoiceNumber: 'desc' },
    });

    let seq = 1;
    if (last) {
      const lastSeq = parseInt(last.invoiceNumber.split('-').pop() || '0', 10);
      seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(5, '0')}`;
  }
}

export const salesService = new SalesService();
