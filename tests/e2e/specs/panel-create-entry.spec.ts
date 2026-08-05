import { test, expect, openExtensionPage, installDb, reReadKdbx, allEntryTitles } from '../helpers';

test('panel: create an entry in the selected group via the + button', async ({ context, extensionId }) => {
  // Unlock through the popup first (shared vault state via SW).
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');

  // Select the "Sites" group so the new entry lands there instead of the root group.
  const sitesGroup = panel.getByRole('button', { name: 'Sites' });
  await expect(sitesGroup).toBeVisible();
  await sitesGroup.click();

  const addBtn = panel.getByRole('button', { name: 'Add entry' });
  await expect(addBtn).toBeEnabled();
  await addBtn.click();

  await panel.getByRole('button', { name: 'Create' }).waitFor();

  const titleInput = panel.locator('div.mb-3', { hasText: 'Title' }).locator('input');
  const pwInput = panel.locator('div.mb-3', { hasText: 'Password' }).locator('input');
  await titleInput.fill('New Site Entry');
  await pwInput.fill('brand-new-pass');
  await panel.getByRole('button', { name: 'Create' }).click();

  // On success the drawer switches to normal edit mode for the new entry.
  await expect(panel.getByRole('button', { name: 'Apply changes' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'New Site Entry' })).toBeVisible();

  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await expect(saveBtn).toContainText('Save *');
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  await expect.poll(async () => {
    const db = await reReadKdbx(panel);
    return allEntryTitles(db);
  }).toContain('New Site Entry');
});
