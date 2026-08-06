import { test, expect } from '@playwright/test';

const API = process.env.API_URL || 'http://localhost:4000';

test.describe('API health', () => {
  test('GET /health returns ok', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
