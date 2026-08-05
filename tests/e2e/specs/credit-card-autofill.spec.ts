import { test, expect, openExtensionPage, installDb } from '../helpers';

/** Marks the seeded "Localhost Login" entry as a card (number/CVV/cardholder/expiry) via
 *  a direct `updateEntry` SW call — bypasses the panel UI, which is already covered by
 *  credit-card-marking.spec.ts, keeping this spec focused on the autofill wiring itself. */
async function markAsCard(page: import('@playwright/test').Page, url: string, expires = new Date(2029, 4, 1).getTime()) {
  return page.evaluate(async ({ pageUrl, expires }) => {
    const res = await chrome.runtime.sendMessage({ type: 'getEntriesForUrl', url: pageUrl }) as
      { ok: boolean; entries?: Array<{ id: string }> };
    const entryId = res.entries![0].id;
    await chrome.runtime.sendMessage({
      type: 'updateEntry', entryId, expires,
      fields: { 'QK-IsCard': '1', UserName: '4111111111111111', Password: '123', 'Cardholder Name': 'Jane Doe' },
    });
    return entryId;
  }, { pageUrl: url, expires });
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

test('card form with <select>-based expiry (real-world shape, e.g. fill.dev) fills month/year by matching option value', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  // Expiry within the fixture <select>'s available option range (2026-2028).
  await markAsCard(seed, http.url, new Date(2027, 4, 1).getTime());

  const site = await context.newPage();
  await site.goto(http.cardSelectUrl);
  await site.waitForLoadState('load');

  await site.locator('input[autocomplete="cc-number"]').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await site.getByText('Localhost Login').click();

  await expect(site.locator('input[autocomplete="cc-number"]')).toHaveValue('4111111111111111');
  await expect(site.locator('input[autocomplete="cc-name"]')).toHaveValue('Jane Doe');
  await expect(site.locator('input[autocomplete="cc-csc"]')).toHaveValue('123');
  await expect(site.locator('select[autocomplete="cc-exp-month"]')).toHaveValue('5');
  await expect(site.locator('select[autocomplete="cc-exp-year"]')).toHaveValue('2027');
});

test('a card entry with no URL (not tied to one site) still shows in the inline card popup', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  await markAsCard(seed, http.url);
  // Clear the URL entirely: a card isn't tied to one site, so it should still surface
  // in the inline card popup even though its URL no longer matches the page.
  await seed.evaluate(async (pageUrl) => {
    const res = await chrome.runtime.sendMessage({ type: 'getEntriesForUrl', url: pageUrl }) as
      { ok: boolean; entries?: Array<{ id: string }> };
    await chrome.runtime.sendMessage({ type: 'updateEntry', entryId: res.entries![0].id, fields: { URL: '' } });
  }, http.url);

  const site = await context.newPage();
  await site.goto(http.cardUrl);
  await site.waitForLoadState('load');

  await site.locator('input[autocomplete="cc-number"]').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await site.getByText('Localhost Login').click();
  await expect(site.locator('input[autocomplete="cc-number"]')).toHaveValue('4111111111111111');
});

test('card form embedded in an <iframe> (e.g. Google Wallet\'s payment dialog) still triggers the inline popup', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  await markAsCard(seed, http.url);

  const site = await context.newPage();
  await site.goto(http.cardIframeUrl);
  await site.waitForLoadState('load');

  const frame = site.frameLocator('iframe');
  await frame.locator('input[autocomplete="cc-number"]').click();
  await expect(frame.getByText('Localhost Login')).toBeVisible();
  await frame.getByText('Localhost Login').click();

  await expect(frame.locator('input[autocomplete="cc-number"]')).toHaveValue('4111111111111111');
  await expect(frame.locator('input[autocomplete="cc-name"]')).toHaveValue('Jane Doe');
  await expect(frame.locator('input[autocomplete="cc-csc"]')).toHaveValue('123');
});
