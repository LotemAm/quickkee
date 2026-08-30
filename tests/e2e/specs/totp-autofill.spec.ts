import kdbxweb from 'kdbxweb';
import { test, expect, openExtensionPage, installDb, openPopupForTab, reReadKdbx, swCmd } from '../helpers';

const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

function findEntry(db: kdbxweb.Kdbx, title: string): kdbxweb.KdbxEntry | undefined {
  const stack = [...db.groups];
  while (stack.length) {
    const group = stack.pop()!;
    const entry = group.entries.find(candidate => candidate.fields.get('Title')?.toString() === title);
    if (entry) return entry;
    stack.push(...group.groups);
  }
}

async function addTotp(page: import('@playwright/test').Page, url: string) {
  return page.evaluate(async ({ pageUrl, secret }) => {
    const res = await chrome.runtime.sendMessage({ type: 'getEntriesForUrl', url: pageUrl }) as
      { ok: boolean; entries?: Array<{ id: string }> };
    const entryId = res.entries![0].id;
    await chrome.runtime.sendMessage({
      type: 'updateEntry', entryId, fields: {},
      totp: { secret, algorithm: 'SHA1', digits: 6, period: 300 },
    });
    return entryId;
  }, { pageUrl: url, secret: TOTP_SECRET });
}

test('TOTP fills through normal autofill and the focused inline picker shows a live bar', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();
  await addTotp(seed, http.otpUrl);

  const site = await context.newPage();
  await site.goto(http.otpUrl);
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.otpUrl });
  const popup = await openPopupForTab(context, extensionId, http.otpUrl, tabId!);
  await popup.getByRole('button', { name: 'Autofill' }).click();

  await expect(site.locator('#username')).toHaveValue('e2e-user');
  await expect(site.locator('#password')).toHaveValue('e2e-pass');
  await expect(site.locator('#otp')).toHaveValue(/^\d{6}$/);

  await site.locator('#otp').fill('');
  await site.locator('h1').click();
  await site.locator('#otp').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await expect(site.locator('[role="progressbar"]')).toBeVisible();
  await site.getByText('Localhost Login').click();
  await expect(site.locator('#otp')).toHaveValue(/^\d{6}$/);
  await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
});

test('TOTP lifecycle: create, use from every surface, then remove it', async ({ context, extensionId, http }) => {
  test.slow();
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.otpUrl);
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.otpUrl });
  const popup = await openPopupForTab(context, extensionId, http.otpUrl, tabId!);

  await popup.getByRole('button', { name: 'Add entry' }).click();
  await popup.getByPlaceholder('Title').fill('TOTP Lifecycle');
  await popup.getByPlaceholder('Username').fill('totp-user');
  await popup.getByPlaceholder('Password').fill('totp-pass');
  await popup.getByLabel('TOTP setup key or URI').fill(TOTP_SECRET);
  await popup.getByRole('button', { name: 'Create & Save' }).click();
  await expect(popup.getByText('TOTP Lifecycle')).toBeVisible();

  // Inline picker: the focused OTP field offers only TOTP-capable entries and fills a code.
  await site.locator('#otp').click();
  await expect(site.getByText('TOTP Lifecycle')).toBeVisible();
  await expect(site.locator('[role="progressbar"]')).toBeVisible();
  await site.getByText('TOTP Lifecycle').click();
  await expect(site.locator('#otp')).toHaveValue(/^\d{6}$/);

  // Sidebar: opening the saved entry renders a live code and supports copying it.
  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'TOTP Lifecycle' }).click();
  await expect(panel.getByLabel(/^Current TOTP code \d{6}$/)).toHaveText(/^\d{6}$/);
  await panel.getByRole('button', { name: 'Copy TOTP code' }).click();
  await expect(panel.getByText('Authenticator code copied')).toBeVisible();

  // Extension popup: the same entry exposes and copies its current code.
  const entryCard = popup.locator('.card', { hasText: 'TOTP Lifecycle' });
  await entryCard.getByRole('button', { name: 'Show authenticator code' }).click();
  await expect(entryCard.getByLabel(/^Current TOTP code \d{6}$/)).toHaveText(/^\d{6}$/);
  await entryCard.getByRole('button', { name: 'Copy TOTP code' }).click();
  await expect(popup.getByText('Authenticator code copied')).toBeVisible();

  // Remove only the authenticator configuration, keeping the credential entry intact.
  await panel.getByRole('button', { name: 'TOTP settings' }).click();
  await panel.getByRole('button', { name: 'Remove TOTP' }).click();
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  const saveButton = panel.getByRole('button', { name: /Save/ });
  await expect(saveButton).toContainText('Save *');
  await saveButton.click();
  await expect(saveButton).not.toContainText('Save *');
  await expect(panel.getByLabel(/^Current TOTP code/)).toHaveCount(0);

  await expect.poll(async () => {
    const entry = findEntry(await reReadKdbx(panel), 'TOTP Lifecycle');
    return { exists: Boolean(entry), hasTotp: entry?.fields.has('otp') ?? false };
  }).toEqual({ exists: true, hasTotp: false });

  const refreshedPopup = await openPopupForTab(context, extensionId, http.otpUrl, tabId!);
  const refreshedCard = refreshedPopup.locator('.card', { hasText: 'TOTP Lifecycle' });
  await expect(refreshedCard).toBeVisible();
  await expect(refreshedCard.getByRole('button', { name: 'Show authenticator code' })).toHaveCount(0);

  await site.locator('#otp').fill('');
  await site.locator('h1').click();
  await site.locator('#otp').click();
  await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
});
