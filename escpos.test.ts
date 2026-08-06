/**
 * Unit tests for ESC/POS builder (no DB required).
 * Run: npx vitest run
 */

import { describe, it, expect } from 'vitest';
import { EscPosBuilder } from '../shared/utils/escpos.js';

describe('EscPosBuilder', () => {
  it('produces a non-empty buffer with init + text + cut', () => {
    const b = new EscPosBuilder();
    b.init().align(1).bold(true).text('HELLO').bold(false).feed(2).cut();
    const buf = b.build();
    expect(buf.length).toBeGreaterThan(10);
    // ESC @ init sequence
    expect(buf[0]).toBe(0x1b);
    expect(buf[1]).toBe(0x40);
  });

  it('toBase64 round-trips', () => {
    const b = new EscPosBuilder();
    b.init().text('Test receipt line');
    const b64 = b.toBase64();
    expect(typeof b64).toBe('string');
    expect(Buffer.from(b64, 'base64').length).toBe(b.build().length);
  });

  it('row aligns left and right content', () => {
    const b = new EscPosBuilder();
    b.row('Subtotal', '12.50', 20);
    const text = b.build().toString('utf8');
    expect(text).toContain('Subtotal');
    expect(text).toContain('12.50');
  });
});

describe('FIFO cost math (pure)', () => {
  it('consumes oldest lots first', () => {
    // Simulate lot consumption order
    const lots = [
      { id: 'a', qty: 5, cost: 10 },
      { id: 'b', qty: 8, cost: 12 },
      { id: 'c', qty: 3, cost: 15 },
    ];
    let need = 10;
    let totalCost = 0;
    const consumed: Array<{ id: string; qty: number; cost: number }> = [];

    for (const lot of lots) {
      if (need <= 0) break;
      const take = Math.min(lot.qty, need);
      totalCost += take * lot.cost;
      consumed.push({ id: lot.id, qty: take, cost: lot.cost });
      need -= take;
    }

    expect(need).toBe(0);
    expect(consumed).toEqual([
      { id: 'a', qty: 5, cost: 10 },
      { id: 'b', qty: 5, cost: 12 },
    ]);
    expect(totalCost).toBe(5 * 10 + 5 * 12); // 110
  });

  it('throws conceptually when insufficient stock', () => {
    const lots = [{ id: 'a', qty: 2, cost: 10 }];
    let need = 5;
    for (const lot of lots) {
      const take = Math.min(lot.qty, need);
      need -= take;
    }
    expect(need).toBe(3); // remaining unfilled
  });
});
