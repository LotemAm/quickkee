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
  // Unlock status is published before asynchronous device enrollment finishes.
  await expect.poll(() => popup.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'getQuickUnlockStatus' });
    return status.ok && status.enrolled;
  })).toBe(true);

  await popup.getByRole('button', { name: 'Lock database' }).click();
  await expect(popup.getByRole('button', { name: 'Quick unlock “e2e.kdbx” with device' })).toBeVisible();
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Quick unlock “e2e.kdbx” with device' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();

  await popup.getByRole('button', { name: 'Quick unlock “e2e.kdbx” with device' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
});
