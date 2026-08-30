import { test, expect, openExtensionPage, installDb, reReadKdbx } from '../helpers';
import kdbxweb from 'kdbxweb';

function findEntry(db: kdbxweb.Kdbx, title: string): kdbxweb.KdbxEntry | undefined {
  const stack = [...db.groups];
  while (stack.length) {
    const g = stack.pop()!;
    for (const e of g.entries) if (e.fields.get('Title')?.toString() === title) return e;
    stack.push(...g.groups);
  }
}

test('panel: edit an entry, Save, and verify via kdbxweb re-read', async ({ context, extensionId }) => {
  // Unlock through the popup first (shared vault state via SW).
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  // Open the panel page. Wait for the tree to appear (status poll → unlocked).
  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');

  // The panel's master-detail group tree only lists entries for the currently
  // selected group; it defaults to the root group, but the fixture entry lives
  // in the "Sites" subgroup, so select it before looking for the entry button.
  const sitesGroup = panel.getByRole('button', { name: 'Sites' });
  await expect(sitesGroup).toBeVisible();
  await sitesGroup.click();

  const entryBtn = panel.getByRole('button', { name: 'Localhost Login' });
  await expect(entryBtn).toBeVisible();
  await entryBtn.click();

  // Wait for the Apply changes button to confirm EntryEditor has mounted.
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();

  // A plain positional locator (input.nth(2)) is fragile: the panel's own
  // search box is the first <input> on the page, ahead of EntryEditor's
  // Title/Username/Password/URL fields, so nth(2) actually lands on Username.
  // Scope to the field wrapper that contains the "Password" label instead.
  const pwInput = panel.locator('div.mb-3', { hasText: 'Password' }).locator('input');

  // Wait for the entry data to load from the SW (password field will be non-empty).
  await expect(pwInput).not.toHaveValue('');

  await pwInput.fill('edited-pass-123');
  await expect(pwInput).toHaveValue('edited-pass-123');
  await panel.getByRole('button', { name: 'Apply changes' }).click();

  // Dirty indicator: the Save button now reads "Save *"; click it and it clears.
  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await expect(saveBtn).toContainText('Save *');
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  // KeePassXC equivalent: re-read the .kdbx and confirm the new password persisted.
  await expect.poll(async () => {
    const db = await reReadKdbx(panel);
    const pf = findEntry(db, 'Localhost Login')?.fields.get('Password');
    return pf instanceof kdbxweb.ProtectedValue ? pf.getText() : pf?.toString();
  }).toBe('edited-pass-123');
});
