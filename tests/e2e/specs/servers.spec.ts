import { test, expect } from '../helpers';

test('http fixture serves a login form on localhost and 127.0.0.1', async ({ context, http }) => {
  const page = await context.newPage();
  await page.goto(http.url);
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await page.goto(http.altUrl);
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
