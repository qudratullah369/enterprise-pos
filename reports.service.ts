/**
 * Reports Service
 * Daily sales, profit & loss (using FIFO COGS), inventory valuation, etc.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export class ReportsService {
  /**
   * Daily sales summary for a branch (or all branches if branchId omitted)
   */
  async dailySalesReport(date: Date, branchId?: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const where: Prisma.SaleWhereInput = {
      createdAt: { gte: start, lte: end },
      status: 'COMPLETED',
    };
    if (branchId) where.branchId = branchId;

    const sales = await prisma.sale.findMany({
      where,
      include: {
        items: true,
        cashier: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let grossSales = new Prisma.Decimal(0);
    let totalDiscount = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);
    let totalCogs = new Prisma.Decimal(0);
    let netSales = new Prisma.Decimal(0);

    for (const sale of sales) {
      grossSales = grossSales.add(sale.subtotal);
      totalDiscount = totalDiscount.add(sale.discountAmount);
      totalTax = totalTax.add(sale.taxAmount);
      netSales = netSales.add(sale.totalAmount);

      for (const item of sale.items) {
        totalCogs = totalCogs.add(item.costOfGoods);
      }
    }

    const grossProfit = netSales.sub(totalTax).sub(totalCogs); // simplified

    return {
      date: start.toISOString().slice(0, 10),
      branchId: branchId ?? 'ALL',
      transactionCount: sales.length,
      grossSales,
      totalDiscount,
      totalTax,
      netSales,
      totalCogs,
      grossProfit,
      sales,
    };
  }

  /**
   * Inventory valuation using current FIFO lots
   */
  async inventoryValuation(branchId?: string) {
    const where: Prisma.InventoryLotWhereInput = {
      quantity: { gt: 0 },
    };
    if (branchId) where.branchId = branchId;

    const lots = await prisma.inventoryLot.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
        branch: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ productId: 'asc' }, { receivedAt: 'asc' }],
    });

    // Group by product
    const byProduct = new Map<
      string,
      {
        product: (typeof lots)[0]['product'];
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
        lots: typeof lots;
      }
    >();

    let totalValue = new Prisma.Decimal(0);
    let totalQty = new Prisma.Decimal(0);

    for (const lot of lots) {
      const qty = new Prisma.Decimal(lot.quantity);
      const value = qty.mul(lot.unitCost);
      totalValue = totalValue.add(value);
      totalQty = totalQty.add(qty);

      const existing = byProduct.get(lot.productId);
      if (existing) {
        existing.quantity = existing.quantity.add(qty);
        existing.value = existing.value.add(value);
        existing.lots.push(lot);
      } else {
        byProduct.set(lot.productId, {
          product: lot.product,
          quantity: qty,
          value,
          lots: [lot],
        });
      }
    }

    return {
      branchId: branchId ?? 'ALL',
      totalValue,
      totalQuantity: totalQty,
      products: Array.from(byProduct.values()),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Dashboard KPIs for the main analytics screen.
   */
  async dashboard(branchId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const saleWhere: Prisma.SaleWhereInput = {
      createdAt: { gte: today, lt: tomorrow },
      status: 'COMPLETED',
    };
    if (branchId) saleWhere.branchId = branchId;

    const [salesAgg, itemsAgg, lowStockCount, openRegisters, topProducts, recentSales] =
      await Promise.all([
        prisma.sale.aggregate({
          where: saleWhere,
          _sum: { totalAmount: true, taxAmount: true, discountAmount: true },
          _count: true,
        }),
        prisma.saleItem.aggregate({
          where: {
            sale: saleWhere,
          },
          _sum: { costOfGoods: true },
        }),
        // Approximate low-stock: products with reorderLevel and sum of lots
        prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          branchId
            ? `SELECT COUNT(*)::bigint AS count FROM (
                 SELECT p.id FROM products p
                 LEFT JOIN inventory_lots l ON l."productId" = p.id AND l."branchId" = $1 AND l.quantity > 0
                 WHERE p."isActive" = true AND p."trackInventory" = true
                 GROUP BY p.id, p."reorderLevel"
                 HAVING COALESCE(SUM(l.quantity), 0) <= p."reorderLevel"
               ) sub`
            : `SELECT COUNT(*)::bigint AS count FROM (
                 SELECT p.id FROM products p
                 LEFT JOIN inventory_lots l ON l."productId" = p.id AND l.quantity > 0
                 WHERE p."isActive" = true AND p."trackInventory" = true
                 GROUP BY p.id, p."reorderLevel"
                 HAVING COALESCE(SUM(l.quantity), 0) <= p."reorderLevel"
               ) sub`,
          ...(branchId ? [branchId] : [])
        ).catch(() => [{ count: 0n }]),
        prisma.cashRegister.count({
          where: {
            closedAt: null,
            ...(branchId ? { branchId } : {}),
          },
        }),
        prisma.saleItem.groupBy({
          by: ['productId'],
          where: { sale: saleWhere },
          _sum: { quantity: true, lineTotal: true },
          orderBy: { _sum: { lineTotal: 'desc' } },
          take: 5,
        }),
        prisma.sale.findMany({
          where: saleWhere,
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            paymentMethod: true,
            createdAt: true,
            cashier: { select: { firstName: true, lastName: true } },
          },
        }),
      ]);

    const netSales = salesAgg._sum.totalAmount ?? new Prisma.Decimal(0);
    const totalCogs = itemsAgg._sum.costOfGoods ?? new Prisma.Decimal(0);
    const grossProfit = new Prisma.Decimal(netSales).sub(totalCogs);

    // Resolve top product names
    const productIds = topProducts.map((t) => t.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const trend = await this.salesTrend(7, branchId);

    return {
      date: today.toISOString().slice(0, 10),
      branchId: branchId ?? 'ALL',
      kpis: {
        netSales,
        totalCogs,
        grossProfit,
        transactionCount: salesAgg._count,
        totalTax: salesAgg._sum.taxAmount ?? 0,
        totalDiscount: salesAgg._sum.discountAmount ?? 0,
        lowStockCount: Number(lowStockCount[0]?.count ?? 0),
        openRegisters,
      },
      topProducts: topProducts.map((t) => ({
        productId: t.productId,
        name: productMap.get(t.productId)?.name ?? 'Unknown',
        sku: productMap.get(t.productId)?.sku,
        quantity: t._sum.quantity,
        revenue: t._sum.lineTotal,
      })),
      recentSales,
      salesTrend: trend,
    };
  }

  /**
   * Last N days sales totals (for trend chart).
   */
  async salesTrend(days = 7, branchId?: string) {
    const result: Array<{ date: string; total: number; count: number }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(today);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const where: Prisma.SaleWhereInput = {
        createdAt: { gte: start, lt: end },
        status: 'COMPLETED',
      };
      if (branchId) where.branchId = branchId;

      const agg = await prisma.sale.aggregate({
        where,
        _sum: { totalAmount: true },
        _count: true,
      });

      result.push({
        date: start.toISOString().slice(0, 10),
        total: Number(agg._sum.totalAmount ?? 0),
        count: agg._count,
      });
    }

    return result;
  }

  /**
   * CSV export for daily sales (Excel-compatible).
   */
  async exportDailySalesCsv(date: Date, branchId?: string): Promise<string> {
    const report = await this.dailySalesReport(date, branchId);
    const header = [
      'Invoice',
      'Date',
      'Cashier',
      'Subtotal',
      'Discount',
      'Tax',
      'Total',
      'COGS',
      'Gross Profit',
      'Status',
    ].join(',');

    const rows = report.sales.map((s) => {
      const cogs = s.items.reduce(
        (sum, i) => sum.add(i.costOfGoods),
        new Prisma.Decimal(0)
      );
      const profit = new Prisma.Decimal(s.totalAmount).sub(s.taxAmount).sub(cogs);
      return [
        s.invoiceNumber,
        s.createdAt.toISOString(),
        `"${s.cashier.firstName} ${s.cashier.lastName}"`,
        Number(s.subtotal).toFixed(2),
        Number(s.discountAmount).toFixed(2),
        Number(s.taxAmount).toFixed(2),
        Number(s.totalAmount).toFixed(2),
        Number(cogs).toFixed(4),
        Number(profit).toFixed(2),
        s.status,
      ].join(',');
    });

    const summary = [
      '',
      `"SUMMARY for ${report.date}"`,
      `Transactions,${report.transactionCount}`,
      `Gross Sales,${Number(report.grossSales).toFixed(2)}`,
      `Net Sales,${Number(report.netSales).toFixed(2)}`,
      `Total COGS,${Number(report.totalCogs).toFixed(4)}`,
      `Gross Profit,${Number(report.grossProfit).toFixed(2)}`,
    ].join('\n');

    return [header, ...rows, '', summary].join('\n');
  }

  /**
   * CSV export for inventory valuation.
   */
  async exportInventoryCsv(branchId?: string): Promise<string> {
    const report = await this.inventoryValuation(branchId);
    const header = ['SKU', 'Product', 'Quantity', 'Value', 'Avg Cost'].join(',');

    const rows = report.products.map((p) => {
      const avg = p.quantity.gt(0) ? p.value.div(p.quantity) : new Prisma.Decimal(0);
      return [
        p.product.sku,
        `"${p.product.name.replace(/"/g, '""')}"`,
        Number(p.quantity).toFixed(4),
        Number(p.value).toFixed(4),
        Number(avg).toFixed(4),
      ].join(',');
    });

    const footer = [
      '',
      `Total Quantity,${Number(report.totalQuantity).toFixed(4)}`,
      `Total Value,${Number(report.totalValue).toFixed(4)}`,
      `Generated,${report.generatedAt}`,
    ].join('\n');

    return [header, ...rows, footer].join('\n');
  }
}

export const reportsService = new ReportsService();
