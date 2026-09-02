import { test, expect } from '@playwright/test';

test.describe('POS terminal smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('cashier@pos.local');
    await page.getByLabel('Password').fill('cashier123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/Terminal|John|Cashier/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('can open terminal and see product area or cart', async ({ page }) => {
    // Navigate to Terminal if not already there
    const terminalBtn = page.getByRole('button', { name: 'Terminal' });
    if (await terminalBtn.isVisible().catch(() => false)) {
      await terminalBtn.click();
    }
    // Search box or cart should be present
    const search = page.getByPlaceholder(/search products/i);
    const cart = page.getByText(/current sale|cart is empty/i);
    await expect(search.or(cart).first()).toBeVisible({ timeout: 10_000 });
  });
});
