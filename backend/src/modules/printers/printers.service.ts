/**
 * Printer Bridge Abstraction
 * ==========================
 * Provides a clean interface for sending ESC/POS data to thermal printers.
 *
 * In production you can plug in:
 *  - network (TCP port 9100)
 *  - USB (via node-usb / node-escpos)
 *  - system print spooler
 *
 * This module ships with a "log" driver (dev) and a "network" driver stub.
 */

import { receiptsService } from '../receipts/receipts.service.js';
import { AppError } from '../../shared/errors/AppError.js';
import { env } from '../../config/env.js';

export type PrinterDriver = 'log' | 'network' | 'file';

export interface PrintJobResult {
  success: boolean
  driver: PrinterDriver
  saleId: string
  invoiceNumber: string
  message: string
  bytesSent?: number
}

export class PrintersService {
  /**
   * Print a sale receipt using the configured driver.
   */
  async printSaleReceipt(
    saleId: string,
    options?: { driver?: PrinterDriver; host?: string; port?: number }
  ): Promise<PrintJobResult> {
    const receipt = await receiptsService.getSaleReceipt(saleId);
    const buffer = Buffer.from(receipt.escposBase64, 'base64');
    const driver = options?.driver ?? (env.NODE_ENV === 'production' ? 'network' : 'log');

    switch (driver) {
      case 'log':
        console.log(
          `[Printer:log] Receipt ${receipt.invoiceNumber} (${buffer.length} bytes)\n` +
            receipt.text.slice(0, 500)
        );
        return {
          success: true,
          driver: 'log',
          saleId,
          invoiceNumber: receipt.invoiceNumber,
          message: 'Receipt logged (dev driver). Connect a real printer for production.',
          bytesSent: buffer.length,
        };

      case 'network': {
        const host = options?.host || process.env.PRINTER_HOST || '127.0.0.1';
        const port = options?.port || Number(process.env.PRINTER_PORT || 9100);
        // Network printing requires `net` socket — best-effort attempt
        try {
          await this.sendTcp(host, port, buffer);
          return {
            success: true,
            driver: 'network',
            saleId,
            invoiceNumber: receipt.invoiceNumber,
            message: `Sent ${buffer.length} bytes to ${host}:${port}`,
            bytesSent: buffer.length,
          };
        } catch (err: any) {
          throw new AppError(
            `Network printer failed (${host}:${port}): ${err.message}. ` +
              'Ensure the printer is reachable on port 9100 (raw TCP).',
            502
          );
        }
      }

      case 'file': {
        // Write to /tmp for debugging / CI
        const fs = await import('fs/promises');
        const path = `/tmp/pos-receipt-${receipt.invoiceNumber}.bin`;
        await fs.writeFile(path, buffer);
        return {
          success: true,
          driver: 'file',
          saleId,
          invoiceNumber: receipt.invoiceNumber,
          message: `Written to ${path}`,
          bytesSent: buffer.length,
        };
      }

      default:
        throw new AppError(`Unknown printer driver: ${driver}`, 400);
    }
  }

  private sendTcp(host: string, port: number, data: Buffer): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const net = await import('net');
      const socket = net.createConnection({ host, port }, () => {
        socket.write(data, (err) => {
          if (err) reject(err);
          else {
            socket.end();
            resolve();
          }
        });
      });
      socket.setTimeout(5000);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timed out'));
      });
      socket.on('error', reject);
    });
  }
}

export const printersService = new PrintersService();
