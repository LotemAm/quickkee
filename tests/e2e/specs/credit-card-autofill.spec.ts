import { test, expect, openExtensionPage, installDb } from '../helpers';

/** Marks the seeded "Localhost Login" entry as a card (number/CVV/cardholder/expiry) via
 *  a direct `updateEntry` SW call — bypasses the panel UI, which is already covered by
 *  credit-card-marking.spec.ts, keeping this spec focused on the autofill wiring itself. */
async function markAsCard(page: import('@playwright/test').Page, url: string) {
  return page.evaluate(async (pageUrl) => {
    const res = await chrome.runtime.sendMessage({ type: 'getEntriesForUrl', url: pageUrl }) as
      { ok: boolean; entries?: Array<{ id: string }> };
    const entryId = res.entries![0].id;
    const expires = new Date(2029, 4, 1).getTime(); // May 2029
    await chrome.runtime.sendMessage({
      type: 'updateEntry', entryId, expires,
      fields: { 'QK-IsCard': '1', UserName: '4111111111111111', Password: '123', 'Cardholder Name': 'Jane Doe' },
    });
    return entryId;
  }, url);
}

test('card form: focusing a detected cc-number field shows only card entries and autofills number/name/cvv/expiry', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  await markAsCard(seed, http.url);

  const site = await context.newPage();
  await site.goto(http.cardUrl);
  await site.waitForLoadState('load');

  await site.locator('input[autocomplete="cc-number"]').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await site.getByText('Localhost Login').click();

  await expect(site.locator('input[autocomplete="cc-number"]')).toHaveValue('4111111111111111');
  await expect(site.locator('input[autocomplete="cc-name"]')).toHaveValue('Jane Doe');
  await expect(site.locator('input[autocomplete="cc-csc"]')).toHaveValue('123');
  await expect(site.locator('input[autocomplete="cc-exp"]')).toHaveValue('05/29');
  await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
});

test('card form popup masks the card number in the entry picker', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  await markAsCard(seed, http.url);

  const site = await context.newPage();
  await site.goto(http.cardUrl);
  await site.waitForLoadState('load');

  await site.locator('input[autocomplete="cc-number"]').click();
  await expect(site.getByText('•••• 1111')).toBeVisible();
});

test('login form excludes card-marked entries from the inline picker', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  await markAsCard(seed, http.url);

  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');

  await site.locator('#username').click();
  // Give the SW round-trip a moment, then assert the (now card-only) entry never appears
  // and the fields stay empty — the only seeded entry for this URL is card-marked.
  await site.waitForTimeout(300);
  await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
  await expect(site.locator('#username')).toHaveValue('');
  await expect(site.locator('#password')).toHaveValue('');
});
