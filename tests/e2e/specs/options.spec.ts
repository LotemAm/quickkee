import { test, expect, openExtensionPage } from '../helpers';

test('options: changing settings persists to chrome.storage.local across reload', async ({ context, extensionId }) => {
  const opts = await openExtensionPage(context, extensionId, 'src/pages/options/index.html');
  const offer = opts.getByRole('checkbox', { name: 'Offer to save submitted credentials' });
  await expect(offer).toBeChecked();

  // Change auto-close to 24h and select the Dark theme (both save-on-change).
  await opts.getByRole('combobox').first().selectOption('24');
  await opts.getByRole('button', { name: 'Dark' }).click();
  await offer.uncheck();

  // Both controls persist asynchronously; wait for those writes before navigating.
  await expect.poll(() => opts.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    return {
      autoCloseHours: stored.settings?.autoCloseHours,
      theme: stored.settings?.theme,
      offerToSaveCredentials: stored.settings?.offerToSaveCredentials,
    };
  })).toEqual({ autoCloseHours: 24, theme: 'dark', offerToSaveCredentials: false });

  // Reload and confirm the controls reflect the saved values.
  await opts.reload();
  await expect(opts.getByRole('combobox').first()).toHaveValue('24');
  await expect(opts.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(opts.getByRole('checkbox', { name: 'Offer to save submitted credentials' })).not.toBeChecked();

  // And confirm the underlying storage.
  const stored = await opts.evaluate(() => chrome.storage.local.get('settings'));
  expect(stored.settings.autoCloseHours).toBe(24);
  expect(stored.settings.theme).toBe('dark');
  expect(stored.settings.offerToSaveCredentials).toBe(false);
});
