import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import jwt from 'jsonwebtoken';

import app from '../../../app.js';
import { env } from '../../../config/env.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind test HTTP server');
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// Valid cuid v1 format — 25 chars, starts with 'c'
const BRANCH_A = 'cjld2cjxh0000qzrmn831i7rn';
const BRANCH_B = 'cjld2cjxh0001qzrmn831i7rn';
const PRODUCT_ID = 'cjld2cjxh0002qzrmn831i7rn';

function mint(payload: Record<string, unknown>): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1h' });
}

function validBody(branchId: string) {
  return {
    branchId,
    items: [{ productId: PRODUCT_ID, quantity: 1 }],
    paymentMethod: 'CASH',
    paidAmount: 10,
  };
}

describe('POST /api/sales — branch isolation regression (HTTP)', () => {
  it('T3-A: no Authorization header -> 401 Authentication required', async () => {
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody(BRANCH_A)),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      message: 'Authentication required',
    });
  });

  it('T3-B: ACCOUNTANT role -> 403 Insufficient permissions (role gate runs before branch gate)', async () => {
    const token = mint({
      userId: 'test-acct',
      email: 'acct@test.local',
      role: 'ACCOUNTANT',
      branchId: BRANCH_A,
    });

    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validBody(BRANCH_A)),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      message: 'Insufficient permissions',
    });
  });

  it('T3-C: CASHIER of branch-A -> body.branchId = branch-B -> 403 forbidden', async () => {
    const token = mint({
      userId: 'test-cashier',
      email: 'cashier@test.local',
      role: 'CASHIER',
      branchId: BRANCH_A,
    });

    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validBody(BRANCH_B)), // <-- other branch!
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      message: 'Access to requested branch is forbidden',
    });
  });
});