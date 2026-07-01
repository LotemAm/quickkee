import { test, expect, openExtensionPage, installDb } from '../helpers';

test('inline popup: focus login field shows credential picker and fills on select', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');

  await site.locator('#username').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await site.getByText('Localhost Login').click();

  await expect(site.locator('#username')).toHaveValue('e2e-user');
  await expect(site.locator('#password')).toHaveValue('e2e-pass');
});

test('inline popup: single-step login field also shows picker', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.singleUrl);
  await site.waitForLoadState('load');

  await site.locator('#email').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await site.getByText('Localhost Login').click();

  await expect(site.locator('#email')).toHaveValue('e2e-user');
});
