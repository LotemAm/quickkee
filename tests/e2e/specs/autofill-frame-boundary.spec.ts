import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd } from '../helpers';

const secretFields = ['username', 'password', 'otp', 'cc-number', 'cc-name', 'cc-exp', 'cc-csc'];

async function unlock(context: BrowserContext, extensionId: string): Promise<Page> {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();
  return seed;
}

async function configureEntry(seed: Page, url: string, kind: 'login' | 'totp' | 'card', urlLess = false): Promise<string> {
  return seed.evaluate(async ({ url, kind, urlLess }) => {
    const { entries } = await chrome.runtime.sendMessage({ type: 'getEntriesForUrl', url });
    const entryId = entries[0].id;
    const response = await chrome.runtime.sendMessage({
      type: 'updateEntry', entryId,
      fields: {
        ...(urlLess ? { URL: '' } : {}),
        ...(kind === 'card' ? { 'QK-IsCard': '1', UserName: '4111111111111111', Password: '123', 'Cardholder Name': 'Jane Doe' } : {}),
      },
      ...(kind === 'card' ? { expires: new Date(2029, 4, 1).getTime() } : {}),
      ...(kind === 'totp' ? { totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 300 } } : {}),
    });
    if (!response.ok) throw new Error(response.error);
    return entryId;
  }, { url, kind, urlLess });
}

async function popupFill(seed: Page, context: BrowserContext, extensionId: string, url: string, entryId: string) {
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url });
  const popup = await openPopupForTab(context, extensionId, url, tabId!);
  // Await the real popup route's completion before checking every recipient's values.
  expect(await popup.evaluate(({ entryId, tabId }) => chrome.runtime.sendMessage({
    type: 'fillRequest', entryId, tabId,
  }), { entryId, tabId })).toEqual({ ok: true });
}

for (const kind of ['login', 'totp'] as const) {
  test(`popup ${kind} fills matching documents and leaves every unrelated field empty`, async ({ context, extensionId, http }) => {
    const seed = await unlock(context, extensionId);
    const entryId = await configureEntry(seed, http.url, kind);
    const site = await context.newPage();
    await site.goto(http.autofillFramesUrl);
    await popupFill(seed, context, extensionId, http.autofillFramesUrl, entryId);

    for (const recipient of [site, site.frameLocator('#matching')]) {
      await expect(recipient.locator('#username')).toHaveValue('e2e-user');
      await expect(recipient.locator('#password')).toHaveValue('e2e-pass');
      await expect(recipient.locator('#otp')).toHaveValue(kind === 'totp' ? /^\d{6}$/ : '');
      for (const id of secretFields.slice(3)) await expect(recipient.locator(`#${id}`)).toHaveValue('');
    }
    for (const id of secretFields) await expect(site.frameLocator('#unrelated').locator(`#${id}`)).toHaveValue('');
  });
}

for (const urlLess of [false, true]) {
  test(`popup ${urlLess ? 'URLless' : 'URL-bound'} cards stay within their authorized documents`, async ({ context, extensionId, http }) => {
    const seed = await unlock(context, extensionId);
    const entryId = await configureEntry(seed, http.url, 'card', urlLess);
    const site = await context.newPage();
    await site.goto(http.autofillFramesUrl);
    await popupFill(seed, context, extensionId, http.autofillFramesUrl, entryId);

    const values = { 'cc-number': '4111111111111111', 'cc-name': 'Jane Doe', 'cc-csc': '123', 'cc-exp': '05/29' };
    for (const [id, value] of Object.entries(values)) {
      await expect(site.locator(`#${id}`)).toHaveValue(value);
      await expect(site.frameLocator('#matching').locator(`#${id}`)).toHaveValue(urlLess ? '' : value);
    }
    for (const recipient of [site, site.frameLocator('#matching')]) {
      for (const id of secretFields.slice(0, 3)) await expect(recipient.locator(`#${id}`)).toHaveValue('');
    }
    for (const id of secretFields) await expect(site.frameLocator('#unrelated').locator(`#${id}`)).toHaveValue('');
  });
}

test('explicit URLless inline card selection fills only its own unrelated iframe', async ({ context, extensionId, http }) => {
  const seed = await unlock(context, extensionId);
  await configureEntry(seed, http.url, 'card', true);
  const site = await context.newPage();
  await site.goto(http.autofillFramesUrl);
  const frame = site.frameLocator('#unrelated');
  await frame.locator('#cc-number').click();
  await expect(frame.locator('[data-quickkee-popup]')).toBeVisible();
  expect(await frame.locator('[data-quickkee-popup]').evaluate(element => element.shadowRoot)).toBeNull();
  await frame.locator('#cc-number').press('Enter');
  await expect(frame.locator('#cc-number')).toHaveValue('4111111111111111');
  await expect(frame.locator('#cc-name')).toHaveValue('Jane Doe');
  await expect(frame.locator('#cc-csc')).toHaveValue('123');
  await expect(frame.locator('#cc-exp')).toHaveValue('05/29');
  for (const recipient of [site, site.frameLocator('#matching')]) {
    for (const id of secretFields) await expect(recipient.locator(`#${id}`)).toHaveValue('');
  }
  for (const id of secretFields.slice(0, 3)) await expect(frame.locator(`#${id}`)).toHaveValue('');
});
