import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd, reReadKdbx, allEntryTitles } from '../helpers';

test('saved site: "Add entry" button creates a second entry from the popup', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  // localhost already has a matching entry -> list shows, no auto CreateForm.
  const site = await context.newPage();
  await site.goto(http.url);
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.url });

  const popup = await openPopupForTab(context, extensionId, http.url, tabId);
  await expect(popup.getByText('Localhost Login')).toBeVisible();
  await expect(popup.getByText(`New entry for ${http.url}`)).not.toBeVisible();

  // Click "Add entry" -> CreateForm replaces the list.
  await popup.getByRole('button', { name: 'Add entry' }).click();
  await expect(popup.getByText(`New entry for ${http.url}`)).toBeVisible();
  await expect(popup.getByText('Localhost Login')).not.toBeVisible();

  await popup.getByPlaceholder('Title').fill('Second Entry');
  await popup.getByPlaceholder('Username').fill('seconduser');
  await popup.getByRole('button', { name: 'Create & Save' }).click();

  // Back to the list, showing both entries; persisted to the .kdbx.
  await expect(popup.getByText('Localhost Login')).toBeVisible();
  await expect(popup.getByText('Second Entry')).toBeVisible();
  await expect.poll(async () => allEntryTitles(await reReadKdbx(seed))).toContain('Second Entry');
});

test('saved site: Cancel returns to the list without creating an entry', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.url);
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.url });

  const popup = await openPopupForTab(context, extensionId, http.url, tabId);
  await popup.getByRole('button', { name: 'Add entry' }).click();
  await expect(popup.getByText(`New entry for ${http.url}`)).toBeVisible();

  await popup.getByRole('button', { name: 'Cancel' }).click();
  await expect(popup.getByText('Localhost Login')).toBeVisible();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
});
