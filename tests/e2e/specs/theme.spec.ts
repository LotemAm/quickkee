import { test, expect, openExtensionPage } from '../helpers';

test('options: theme control toggles dark class; system follows OS live', async ({ context, extensionId }) => {
  const opts = await openExtensionPage(context, extensionId, 'src/pages/options/index.html');
  const isDark = () => opts.evaluate(() => document.documentElement.classList.contains('dark'));

  // Start from a known OS preference so System resolves deterministically.
  await opts.emulateMedia({ colorScheme: 'light' });

  // Explicit Light -> never dark.
  await opts.getByRole('button', { name: 'Light' }).click();
  await expect(opts.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(isDark).toBe(false);

  // Explicit Dark -> dark class applied regardless of OS preference.
  await opts.getByRole('button', { name: 'Dark' }).click();
  await expect(opts.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(isDark).toBe(true);

  // System with OS = dark -> resolves to dark.
  await opts.emulateMedia({ colorScheme: 'dark' });
  await opts.getByRole('button', { name: 'System' }).click();
  await expect(opts.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(isDark).toBe(true);

  // Live: flipping the OS preference updates the class without re-clicking.
  await opts.emulateMedia({ colorScheme: 'light' });
  await expect.poll(isDark).toBe(false);
  await opts.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(isDark).toBe(true);

  // The selected mode persists across reloads.
  await opts.reload();
  await expect(opts.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
});
