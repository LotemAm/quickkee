import { test, expect, openExtensionPage, installDb } from '../helpers';

test('first install opens the focused welcome and the choices support keyboard navigation', async ({ context, extensionId }) => {
  const welcomeUrl = `chrome-extension://${extensionId}/src/pages/welcome/index.html`;
  await expect.poll(() => context.pages().some(page => page.url() === welcomeUrl)).toBe(true);
  const welcome = context.pages().find(page => page.url() === welcomeUrl)!;
  await expect(welcome.getByRole('heading', { name: 'Welcome to QuickKee' })).toBeVisible();
  await expect(welcome.getByRole('heading', { name: 'What is KeePass?' })).toBeVisible();
  const create = welcome.getByRole('button', { name: /Create database/ });
  await create.focus();
  await welcome.keyboard.press('Enter');
  await expect(welcome.getByRole('heading', { name: 'New database' })).toBeVisible();
  await welcome.getByRole('button', { name: 'Cancel database creation' }).click();
  await expect(create).toBeFocused();
});

test('welcome creates a database and enters the working vault', async ({ context, extensionId }) => {
  const welcome = await openExtensionPage(context, extensionId, 'src/pages/welcome/index.html');
  // Use the existing isolated database seam; the native picker alone is replaced
  // by a real sandboxed file handle, while creation runs through the service worker.
  await installDb(welcome);
  await welcome.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => {
      const directory = await navigator.storage.getDirectory();
      return directory.getFileHandle('e2e.kdbx', { create: true });
    } });
  });
  await welcome.getByRole('button', { name: /Create database/ }).click();
  await welcome.getByRole('button', { name: 'Choose database location…' }).click();
  await expect(welcome.getByRole('button', { name: 'Database: e2e.kdbx' })).toBeVisible();
  await welcome.getByLabel('Master password', { exact: true }).fill('a new master password');
  await welcome.getByLabel('Confirm master password').fill('a new master password');
  await welcome.getByRole('button', { name: 'Create database', exact: true }).click();
  await expect(welcome.getByRole('heading', { name: 'Your database is ready' })).toBeVisible();
  await welcome.getByRole('link', { name: 'Open database' }).click();
  await expect(welcome).toHaveURL(`chrome-extension://${extensionId}/src/pages/panel/index.html`);
  await expect(welcome.getByRole('button', { name: 'Add entry' })).toBeEnabled();
});

test('welcome opens an existing database and enters the working vault', async ({ context, extensionId }) => {
  const welcome = await openExtensionPage(context, extensionId, 'src/pages/welcome/index.html');
  await installDb(welcome);
  await welcome.getByRole('button', { name: /Open existing database/ }).click();
  await welcome.getByPlaceholder('Master password').fill('correct horse');
  await welcome.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(welcome.getByRole('heading', { name: 'Your database is ready' })).toBeVisible();
  await welcome.getByRole('link', { name: 'Open database' }).click();
  await expect(welcome.getByRole('button', { name: 'Add entry' })).toBeEnabled();
});
