import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';

import app from '../app.js';

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

describe('app HTTP surface (no DB required)', () => {
  it('T2-A: GET /health -> 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      version: '1.0.0',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('T2-B-1: GET /no-such-route -> 404 Route not found', async () => {
    const res = await fetch(`${baseUrl}/no-such-route`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: 'Route not found',
    });
  });

  it('T2-B-2: GET /api/unknown -> 404 (unknown API path)', async () => {
    const res = await fetch(`${baseUrl}/api/unknown`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: 'Route not found',
    });
  });
});