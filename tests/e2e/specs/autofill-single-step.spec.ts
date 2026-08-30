import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd } from '../helpers';

test('single-step login: autofill fills email-only field when no password field present', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.singleUrl);
  await site.waitForLoadState('load');
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.singleUrl });
  expect(typeof tabId).toBe('number');

  const popup = await openPopupForTab(context, extensionId, http.singleUrl, tabId);
  await expect(popup.getByText('Localhost Login')).toBeVisible();

  await popup.getByRole('button', { name: 'Autofill' }).click();
  await expect(site.locator('#email')).toHaveValue('e2e-user');
});
