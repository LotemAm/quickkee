import { test, expect, openExtensionPage, installDb } from '../helpers';

test('first run: install db, enter password, vault opens', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();

  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();

  // Locked view shows the Unlock button; unlocked view shows the search box.
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
});
