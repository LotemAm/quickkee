import { test, expect, openExtensionPage } from '../helpers';

test('options: changing settings persists to chrome.storage.local across reload', async ({ context, extensionId }) => {
  const opts = await openExtensionPage(context, extensionId, 'src/pages/options/index.html');

  // Change auto-close to 24h and enable dark theme (both save-on-change).
  await opts.getByRole('combobox').first().selectOption('24');
  await opts.getByRole('checkbox', { name: 'Dark theme' }).check();

  // Reload and confirm the controls reflect the saved values.
  await opts.reload();
  await expect(opts.getByRole('combobox').first()).toHaveValue('24');
  await expect(opts.getByRole('checkbox', { name: 'Dark theme' })).toBeChecked();

  // And confirm the underlying storage.
  const stored = await opts.evaluate(() => chrome.storage.local.get('settings'));
  expect(stored.settings.autoCloseHours).toBe(24);
  expect(stored.settings.theme).toBe('dark');
});
