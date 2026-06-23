import { test, expect, openExtensionPage } from '../helpers';
import { makeKdbxB64, mutateKdbxB64, cloudInstall, cloudSetRemote, cloudUploadCount, reReadCloudKdbx } from '../cloudSeam';
import * as kdbxweb from 'kdbxweb';

function find(db: kdbxweb.Kdbx, title: string): kdbxweb.KdbxEntry | undefined {
  const stack = [...db.groups];
  while (stack.length) {
    const g = stack.pop()!;
    for (const e of g.entries) if (e.fields.get('Title')?.toString() === title) return e;
    stack.push(...g.groups);
  }
}

test('open from cloud, edit, save; remote change merges and uploads both edits', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await popup.waitForFunction(() => Boolean((window as any).__qkTest));

  // Build the base DB bytes before the reload so kdbxweb runs in Node context.
  const baseB64 = await makeKdbxB64();

  // Reload to ensure a clean UI state, then install the fake provider so the SW
  // receives it while the popup page is open (preventing any SW restart window).
  await popup.reload();
  await popup.waitForFunction(() => Boolean((window as any).__qkTest));
  await cloudInstall(popup, baseB64);

  // Pick the cloud source and open the file.
  await popup.getByRole('tab', { name: 'Dropbox' }).click();
  await popup.getByRole('button', { name: 'Connect Dropbox' }).click();
  await popup.getByRole('button', { name: 'cloud.kdbx' }).click();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  // Another device pushes a remote version (rev r2) that adds a new entry.
  // Must be derived from the same base DB so kdbxweb merge can reconcile by root UUID.
  const remoteB64 = await mutateKdbxB64(baseB64, db => {
    const root = db.getDefaultGroup();
    const e = db.createEntry(root);
    e.fields.set('Title', 'RemoteOnly');
    e.fields.set('URL', 'https://remote.example');
  });
  await cloudSetRemote(popup, remoteB64);

  // Edit locally via the panel, then Save → triggers download+merge+upload.
  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  const entryBtn = panel.getByRole('button', { name: 'Cloud Login' });
  await expect(entryBtn).toBeVisible();
  await entryBtn.click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();
  const pwInput = panel.locator('input').nth(2);
  await expect(pwInput).not.toHaveValue('');
  await pwInput.fill('locally-edited');
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  // The fake provider recorded an upload of merged bytes.
  await expect.poll(() => cloudUploadCount(panel)).toBeGreaterThan(0);

  // Re-read the uploaded/merged DB from cache: BOTH edits are present.
  await expect.poll(async () => {
    const db = await reReadCloudKdbx(panel);
    const local = find(db, 'Cloud Login')?.fields.get('Password');
    const localVal = local instanceof kdbxweb.ProtectedValue ? local.getText() : local?.toString();
    const hasRemote = Boolean(find(db, 'RemoteOnly'));
    return localVal === 'locally-edited' && hasRemote;
  }).toBe(true);
});
