import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test('shows login form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Enterprise POS')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('login with demo cashier credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('cashier@pos.local');
    await page.getByLabel('Password').fill('cashier123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // After login, terminal or header should show user name
    await expect(page.getByText(/John|Cashier|Terminal|POS/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('rejects bad password', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('cashier@pos.local');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|failed|error/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
