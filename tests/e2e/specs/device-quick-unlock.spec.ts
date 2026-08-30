import { test, expect, openExtensionPage, installDb, addPrfAuthenticator } from '../helpers';

test('enrolls a local vault, survives lock and reload, and reopens through fresh device verification', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await addPrfAuthenticator(popup);
  await installDb(popup);
  await popup.reload();

  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: /set up device quick unlock/i }).click();
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  await popup.getByRole('button', { name: 'Lock database' }).click();
  await expect(popup.getByRole('button', { name: 'Unlock “e2e.kdbx” with device' })).toBeVisible();
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Unlock “e2e.kdbx” with device' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();

  await popup.getByRole('button', { name: 'Unlock “e2e.kdbx” with device' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
});
