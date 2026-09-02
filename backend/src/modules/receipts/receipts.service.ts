/**
 * Receipt Service
 * Generates ESC/POS binary + printable HTML for a completed sale.
 */

import { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';
import { EscPosBuilder } from '../../shared/utils/escpos.js';

const prisma = new PrismaClient();

export class ReceiptsService {
  async getSaleReceipt(saleId: string) {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: {
          include: {
            product: { select: { name: true, sku: true, unit: true } },
          },
        },
        payments: true,
        cashier: { select: { firstName: true, lastName: true } },
        customer: { select: { name: true, phone: true } },
        branch: { select: { name: true, address: true, phone: true, code: true } },
      },
    });

    if (!sale) throw new AppError('Sale not found', 404);

    const escpos = this.buildEscPos(sale);
    const html = this.buildHtml(sale);
    const text = this.buildPlainText(sale);

    return {
      saleId: sale.id,
      invoiceNumber: sale.invoiceNumber,
      escposBase64: escpos.toBase64(),
      html,
      text,
      meta: {
        branch: sale.branch.name,
        cashier: `${sale.cashier.firstName} ${sale.cashier.lastName}`,
        createdAt: sale.createdAt,
        totalAmount: sale.totalAmount,
        paymentMethod: sale.paymentMethod,
      },
    };
  }

  private buildEscPos(sale: any): EscPosBuilder {
    const b = new EscPosBuilder();
    b.init();
    b.align(1).bold(true).size(true, true);
    b.text(sale.branch.name || 'STORE');
    b.normalSize().bold(false);
    if (sale.branch.address) b.text(sale.branch.address);
    if (sale.branch.phone) b.text(`Tel: ${sale.branch.phone}`);
    b.line();
    b.align(0);
    b.text(`Invoice: ${sale.invoiceNumber}`);
    b.text(`Date: ${new Date(sale.createdAt).toLocaleString()}`);
    b.text(`Cashier: ${sale.cashier.firstName} ${sale.cashier.lastName}`);
    if (sale.customer) b.text(`Customer: ${sale.customer.name}`);
    b.line();

    for (const item of sale.items) {
      const qty = Number(item.quantity);
      if (qty <= 0) continue;
      const name = item.product.name.slice(0, 28);
      b.text(name);
      b.row(
        `  ${qty} x ${Number(item.unitPrice).toFixed(2)}`,
        Number(item.lineTotal).toFixed(2)
      );
    }

    b.line();
    b.row('Subtotal', Number(sale.subtotal).toFixed(2));
    if (Number(sale.discountAmount) > 0) {
      b.row('Discount', `-${Number(sale.discountAmount).toFixed(2)}`);
    }
    b.row('Tax', Number(sale.taxAmount).toFixed(2));
    b.bold(true);
    b.row('TOTAL', Number(sale.totalAmount).toFixed(2));
    b.bold(false);
    b.row('Paid', Number(sale.paidAmount).toFixed(2));
    if (Number(sale.changeAmount) > 0) {
      b.row('Change', Number(sale.changeAmount).toFixed(2));
    }
    b.row('Method', sale.paymentMethod);
    b.line();
    b.align(1);
    b.text('Thank you for your purchase!');
    b.text(sale.branch.code || '');
    b.feed(3);
    b.cut();
    return b;
  }

  private buildPlainText(sale: any): string {
    const lines: string[] = [];
    const W = 42;
    const row = (l: string, r: string) => {
      const space = Math.max(1, W - l.length - r.length);
      return l + ' '.repeat(space) + r;
    };

    lines.push(sale.branch.name || 'STORE');
    if (sale.branch.address) lines.push(sale.branch.address);
    lines.push('-'.repeat(W));
    lines.push(`Invoice: ${sale.invoiceNumber}`);
    lines.push(`Date: ${new Date(sale.createdAt).toLocaleString()}`);
    lines.push(`Cashier: ${sale.cashier.firstName} ${sale.cashier.lastName}`);
    if (sale.customer) lines.push(`Customer: ${sale.customer.name}`);
    lines.push('-'.repeat(W));

    for (const item of sale.items) {
      const qty = Number(item.quantity);
      if (qty <= 0) continue;
      lines.push(item.product.name);
      lines.push(
        row(`  ${qty} x ${Number(item.unitPrice).toFixed(2)}`, Number(item.lineTotal).toFixed(2))
      );
    }

    lines.push('-'.repeat(W));
    lines.push(row('Subtotal', Number(sale.subtotal).toFixed(2)));
    if (Number(sale.discountAmount) > 0) {
      lines.push(row('Discount', `-${Number(sale.discountAmount).toFixed(2)}`));
    }
    lines.push(row('Tax', Number(sale.taxAmount).toFixed(2)));
    lines.push(row('TOTAL', Number(sale.totalAmount).toFixed(2)));
    lines.push(row('Paid', Number(sale.paidAmount).toFixed(2)));
    if (Number(sale.changeAmount) > 0) {
      lines.push(row('Change', Number(sale.changeAmount).toFixed(2)));
    }
    lines.push(row('Method', sale.paymentMethod));
    lines.push('-'.repeat(W));
    lines.push('Thank you for your purchase!');
    return lines.join('\n');
  }

  private buildHtml(sale: any): string {
    const itemsHtml = sale.items
      .filter((i: any) => Number(i.quantity) > 0)
      .map(
        (i: any) => `
      <tr>
        <td style="padding:4px 0">${i.product.name}</td>
        <td style="text-align:center">${Number(i.quantity)}</td>
        <td style="text-align:right">${Number(i.unitPrice).toFixed(2)}</td>
        <td style="text-align:right">${Number(i.lineTotal).toFixed(2)}</td>
      </tr>`
      )
      .join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${sale.invoiceNumber}</title>
<style>
  body { font-family: 'Courier New', monospace; max-width: 320px; margin: 0 auto; padding: 16px; font-size: 13px; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #666; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { border-bottom: 1px solid #333; text-align: left; padding: 4px 0; font-size: 11px; }
  .totals td { padding: 2px 0; }
  .total-row { font-weight: bold; font-size: 15px; border-top: 1px dashed #333; }
  hr { border: none; border-top: 1px dashed #999; margin: 10px 0; }
  @media print { body { margin: 0; } }
</style></head><body>
  <h1>${sale.branch.name || 'STORE'}</h1>
  ${sale.branch.address ? `<div class="center muted">${sale.branch.address}</div>` : ''}
  ${sale.branch.phone ? `<div class="center muted">Tel: ${sale.branch.phone}</div>` : ''}
  <hr>
  <div>Invoice: <strong>${sale.invoiceNumber}</strong></div>
  <div>Date: ${new Date(sale.createdAt).toLocaleString()}</div>
  <div>Cashier: ${sale.cashier.firstName} ${sale.cashier.lastName}</div>
  ${sale.customer ? `<div>Customer: ${sale.customer.name}</div>` : ''}
  <hr>
  <table>
    <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <hr>
  <table class="totals">
    <tr><td>Subtotal</td><td style="text-align:right">${Number(sale.subtotal).toFixed(2)}</td></tr>
    ${Number(sale.discountAmount) > 0 ? `<tr><td>Discount</td><td style="text-align:right">-${Number(sale.discountAmount).toFixed(2)}</td></tr>` : ''}
    <tr><td>Tax</td><td style="text-align:right">${Number(sale.taxAmount).toFixed(2)}</td></tr>
    <tr class="total-row"><td>TOTAL</td><td style="text-align:right">${Number(sale.totalAmount).toFixed(2)}</td></tr>
    <tr><td>Paid (${sale.paymentMethod})</td><td style="text-align:right">${Number(sale.paidAmount).toFixed(2)}</td></tr>
    ${Number(sale.changeAmount) > 0 ? `<tr><td>Change</td><td style="text-align:right">${Number(sale.changeAmount).toFixed(2)}</td></tr>` : ''}
  </table>
  <hr>
  <div class="center">Thank you for your purchase!</div>
  <div class="center muted">${sale.branch.code || ''}</div>
</body></html>`;
  }
}

export const receiptsService = new ReceiptsService();
