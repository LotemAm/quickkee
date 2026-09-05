import { test, expect, openExtensionPage, installDb, openPopupForTab, getTabId, swCmd } from '../helpers';

test('saved site: badge count, copy, autofill', async ({ context, extensionId, http }) => {
  // Install + unlock the vault via the popup.
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  // Open the matching site (localhost) and let the SW update its badge.
  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');
  const tabId = await getTabId(seed, http.url);

  // Badge: matcher state AND visible chrome.action badge.
  await expect.poll(async () => (await swCmd(seed, { cmd: 'match', url: http.url, tabId })).count).toBe(1);
  await expect.poll(async () => (await swCmd(seed, { cmd: 'badge', tabId })).text).toBe('1');

  // Open the popup pointed at that tab; entry is listed.
  const popup = await openPopupForTab(context, extensionId, http.url, tabId);
  await expect(popup.getByText('Localhost Login')).toBeVisible();

  // Copy username -> clipboard (read it back in the popup page, before auto-clear).
  await popup.getByRole('button', { name: 'Copy user' }).click();
  const copied = await popup.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe('e2e-user');

  // Autofill -> the content script fills the form on the site tab.
  await popup.getByRole('button', { name: 'Autofill' }).click();
  await expect(site.locator('#username')).toHaveValue('e2e-user');
  await expect(site.locator('#password')).toHaveValue('e2e-pass');
});
