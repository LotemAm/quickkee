import kdbxweb from 'kdbxweb';
import type { BrowserContext, Page } from '@playwright/test';
import {
  test, expect, openExtensionPage, installDb, reReadKdbx, swCmd,
  closedCredentialPromptText, clickClosedCredentialAction,
  closedCredentialPromptPrimaryDisabled, selectClosedCredentialDestination,
} from '../helpers';
import { OTP_FIELD_KEY } from '../../../src/shared/entry';

async function unlock(context: BrowserContext, extensionId: string): Promise<Page> {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();
  return seed;
}

function entries(db: kdbxweb.Kdbx): kdbxweb.KdbxEntry[] {
  const out: kdbxweb.KdbxEntry[] = [];
  const visit = (group: kdbxweb.KdbxGroup) => {
    out.push(...group.entries);
    group.groups.forEach(visit);
  };
  db.groups.forEach(visit);
  return out;
}

function field(entry: kdbxweb.KdbxEntry, key: string): string {
  const value = entry.fields.get(key);
  return value instanceof kdbxweb.ProtectedValue ? value.getText() : value?.toString() ?? '';
}

test('new submitted credentials require Save and persist exactly one root entry', async ({ context, extensionId, http }) => {
  const seed = await unlock(context, extensionId);
  const site = await context.newPage();
  await site.goto(http.newCredentialLoginUrl);
  await site.locator('#username').fill('new-user');
  await site.locator('#password').fill('new-password-value');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await expect(site).toHaveURL(/\/credential-landing$/);
  await expect(site.locator('[data-quickkee-credential-prompt]')).toBeVisible();

  const promptText = await closedCredentialPromptText(site);
  expect(promptText).toContain('Save this login?');
  expect(promptText).toContain('127.0.0.1');
  expect(promptText).not.toContain('new-password-value');
  expect(promptText.toLowerCase()).not.toContain('succeeded');

  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: site.url() });
  const safe = await swCmd(seed, { cmd: 'credentialPending', tabId, url: site.url() });
  expect(JSON.stringify(safe.prompt)).not.toContain('new-password-value');

  await clickClosedCredentialAction(site, 'primary');
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);
  await expect.poll(async () => entries(await reReadKdbx(seed)).filter(entry => field(entry, 'UserName') === 'new-user').length).toBe(1);
  const db = await reReadKdbx(seed);
  const saved = entries(db).find(entry => field(entry, 'UserName') === 'new-user')!;
  expect(field(saved, 'Title')).toBe('127.0.0.1');
  expect(field(saved, 'Password')).toBe('new-password-value');
  expect(field(saved, 'URL')).toBe(`http://127.0.0.1:${http.port}/`);
  expect(db.getDefaultGroup().entries.map(entry => entry.uuid.id)).toContain(saved.uuid.id);
});

test('password-change submission offers Update and preserves unrelated fields and TOTP', async ({ context, extensionId, http }) => {
  const seed = await unlock(context, extensionId);
  expect(await swCmd(seed, { cmd: 'credentialPrepare', url: http.credentialLoginUrl })).toMatchObject({ ok: true });
  const site = await context.newPage();
  await site.goto(http.passwordChangeUrl);
  await site.locator('#username').fill('e2e-user');
  await site.locator('#current').fill('e2e-pass');
  await site.locator('#next').fill('changed-password-value');
  await site.locator('#confirm').fill('changed-password-value');
  await site.getByRole('button', { name: 'Change password' }).click();
  await expect(site.locator('[data-quickkee-credential-prompt]')).toBeVisible();
  expect(await closedCredentialPromptText(site)).toContain('Update this password?');

  await clickClosedCredentialAction(site, 'primary');
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);
  await expect.poll(async () => {
    const entry = entries(await reReadKdbx(seed)).find(candidate => field(candidate, 'Title') === 'Localhost Login');
    return entry ? field(entry, 'Password') : '';
  }).toBe('changed-password-value');
  const db = await reReadKdbx(seed);
  const updated = entries(db).find(entry => field(entry, 'Title') === 'Localhost Login')!;
  expect(field(updated, 'Notes')).toBe('keep-note');
  expect(field(updated, 'CustomField')).toBe('keep-custom');
  expect(field(updated, OTP_FIELD_KEY)).toContain('otpauth://');
  expect(entries(db).filter(entry => field(entry, 'Title') === 'Localhost Login')).toHaveLength(1);
});

test('stored credentials are suppressed and ambiguous matches require an explicit destination', async ({ context, extensionId, http }) => {
  const seed = await unlock(context, extensionId);
  const site = await context.newPage();
  await site.goto(http.credentialLoginUrl);
  await site.locator('#username').fill('e2e-user');
  await site.locator('#password').fill('e2e-pass');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await site.waitForTimeout(2_000);
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);

  expect(await swCmd(seed, { cmd: 'credentialDuplicate', url: http.credentialLoginUrl, username: 'e2e-user' })).toMatchObject({ ok: true });
  await site.goto(http.credentialLoginUrl);
  await site.locator('#username').fill('e2e-user');
  await site.locator('#password').fill('ambiguous-password-value');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await expect(site.locator('[data-quickkee-credential-prompt]')).toBeVisible();
  expect(await closedCredentialPromptText(site)).toContain('Choose where to save this login');
  expect(await closedCredentialPromptPrimaryDisabled(site)).toBe(true);
  await selectClosedCredentialDestination(site);
  expect(await closedCredentialPromptPrimaryDisabled(site)).toBe(false);
  await clickClosedCredentialAction(site, 'primary');
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);
});

test('Not now on a rejected same-page login makes no success claim and no vault mutation', async ({ context, extensionId, http }) => {
  const seed = await unlock(context, extensionId);
  const before = entries(await reReadKdbx(seed)).length;
  const site = await context.newPage();
  await site.goto(http.rejectedCredentialUrl);
  await site.locator('#username').fill('rejected-user');
  await site.locator('#password').fill('rejected-password-value');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await expect(site.locator('#result')).toHaveText('Credentials rejected by fixture');
  await expect(site.locator('[data-quickkee-credential-prompt]')).toBeVisible();
  const text = (await closedCredentialPromptText(site)).toLowerCase();
  expect(text).not.toContain('success');
  expect(text).not.toContain('rejected-password-value');
  await clickClosedCredentialAction(site, 'dismiss');
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);
  expect(entries(await reReadKdbx(seed))).toHaveLength(before);
});

test('disabled, OTP, card, and locked submissions never prompt or mutate the vault', async ({ context, extensionId, http }) => {
  const seed = await unlock(context, extensionId);
  const before = entries(await reReadKdbx(seed)).length;
  const site = await context.newPage();

  await seed.evaluate(() => chrome.storage.local.set({ settings: { offerToSaveCredentials: false } }));
  await site.goto(http.newCredentialLoginUrl);
  await site.locator('#username').fill('disabled-user');
  await site.locator('#password').fill('disabled-password-value');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await site.waitForTimeout(1_800);
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);
  await seed.evaluate(() => chrome.storage.local.set({ settings: { offerToSaveCredentials: true } }));

  await site.goto(http.otpUrl);
  await site.locator('#username').fill('otp-user'); await site.locator('#password').fill('otp-password-value'); await site.locator('#otp').fill('123456');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await site.waitForTimeout(1_800);
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);

  await site.goto(http.cardUrl);
  await site.locator('#cc-number').fill('4111111111111111'); await site.locator('#cc-csc').fill('123');
  await site.getByRole('button', { name: 'Pay' }).click();
  await site.waitForTimeout(1_800);
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);

  await swCmd(seed, { cmd: 'lock' });
  await site.goto(http.newCredentialLoginUrl);
  await site.locator('#username').fill('locked-user'); await site.locator('#password').fill('locked-password-value');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await site.waitForTimeout(1_800);
  await expect(site.locator('[data-quickkee-credential-prompt]')).toHaveCount(0);
  expect(entries(await reReadKdbx(seed))).toHaveLength(before);
});
