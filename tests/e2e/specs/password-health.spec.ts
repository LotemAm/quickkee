import { test, expect, openExtensionPage, installDb, swCmd } from '../helpers';

const REUSE_SECRET = 'K8z-Mosaic-Copper-River-938475';
const WEAK_SECRET = 'qwerty123';
const STRONG_SECRET = 'K9v-Mosaic-Copper-River-246810';

test('panel: local password health report is redacted, filterable, and opens entries', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
  expect(await swCmd(popup, { cmd: 'passwordHealthPrepare' })).toEqual({ ok: true });

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Health view' }).click();

  await expect(panel.getByText('Checks run locally while your vault is unlocked.')).toBeVisible();
  await expect(panel.getByText('3 of 4 login entries need attention')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reused 2' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Weak / empty 1' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /TOTP info/ })).toHaveCount(0);
  await expect(panel.getByText('Strong Login')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Reused 2' }).click();
  await expect(panel.getByText('Localhost Login')).toBeVisible();
  await expect(panel.getByText('Reused Login')).toBeVisible();
  await expect(panel.getByText('Weak Login')).not.toBeVisible();

  await panel.getByRole('button', { name: 'Weak / empty 1' }).click();
  await expect(panel.getByText('Weak Login')).toBeVisible();
  await expect(panel.getByText('Reused Login')).not.toBeVisible();

  const html = await panel.locator('body').evaluate(body => body.outerHTML);
  expect(html).not.toContain(REUSE_SECRET);
  expect(html).not.toContain(WEAK_SECRET);
  expect(html).not.toContain(STRONG_SECRET);

  const weakRow = panel.locator('article', { hasText: 'Weak Login' });
  await weakRow.getByRole('button', { name: 'Open entry' }).click();
  await expect(panel.getByRole('button', { name: 'Vault view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Apply changes' })).toBeVisible();
  await expect(panel.locator('div.mb-3', { hasText: 'Title' }).locator('input')).toHaveValue('Weak Login');

  await panel.getByRole('button', { name: 'Health view' }).click();
  await expect(panel.getByText('3 of 4 login entries need attention')).toBeVisible();
  await panel.getByRole('button', { name: 'Lock database' }).click();
  await expect(panel.getByPlaceholder('Master password')).toBeVisible();
  await expect(panel.getByText('Password Health')).not.toBeVisible();
});
