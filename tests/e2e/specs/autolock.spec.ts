import { test, expect, openExtensionPage, installDb, swCmd } from '../helpers';

test('auto-close locks the vault and it can be re-unlocked', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  // Arm the real auto-lock timer with ~1.2s (hours = 1.2/3600), then wait it out.
  await swCmd(popup, { cmd: 'armShort', hours: 1.2 / 3600 });
  await expect.poll(
    async () => (await swCmd(popup, { cmd: 'match', url: 'http://localhost/', tabId: -1 })).count,
    { timeout: 8000 },
  ).toBe(0); // count drops to 0 once the vault locks

  // Popup now shows the locked (Unlock) view; re-unlock works.
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
});
