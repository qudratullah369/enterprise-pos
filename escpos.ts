/**
 * Minimal ESC/POS command builder for thermal printers.
 * Produces a Buffer that can be sent to a USB/network printer
 * or returned to the frontend for browser-based printing libraries.
 *
 * Compatible with most 80mm / 58mm Epson, Star, and generic ESC/POS devices.
 */

export class EscPosBuilder {
  private chunks: Buffer[] = [];

  private push(...bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  private pushStr(text: string) {
    this.chunks.push(Buffer.from(text, 'utf8'));
    return this;
  }

  /** Initialize printer */
  init() {
    return this.push(0x1b, 0x40); // ESC @
  }

  /** Align: 0=left, 1=center, 2=right */
  align(mode: 0 | 1 | 2 = 0) {
    return this.push(0x1b, 0x61, mode);
  }

  /** Bold on/off */
  bold(on = true) {
    return this.push(0x1b, 0x45, on ? 1 : 0);
  }

  /** Double height/width */
  size(doubleHeight = false, doubleWidth = false) {
    const n = (doubleHeight ? 0x10 : 0) | (doubleWidth ? 0x20 : 0);
    return this.push(0x1d, 0x21, n);
  }

  /** Normal size */
  normalSize() {
    return this.push(0x1d, 0x21, 0);
  }

  text(line: string) {
    return this.pushStr(line + '\n');
  }

  /** Horizontal line (uses dashes) */
  line(char = '-', width = 42) {
    return this.text(char.repeat(width));
  }

  /** Two-column row: left + right-aligned value */
  row(left: string, right: string, width = 42) {
    const space = Math.max(1, width - left.length - right.length);
    return this.text(left + ' '.repeat(space) + right);
  }

  feed(lines = 1) {
    return this.push(0x1b, 0x64, lines); // ESC d n
  }

  /** Cut paper (full cut) */
  cut() {
    return this.push(0x1d, 0x56, 0x00);
  }

  /** Open cash drawer (pin 2) */
  openDrawer() {
    return this.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /** Base64 for easy transport over JSON */
  toBase64(): string {
    return this.build().toString('base64');
  }
}
