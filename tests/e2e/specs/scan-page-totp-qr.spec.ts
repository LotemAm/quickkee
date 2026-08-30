import kdbxweb from 'kdbxweb';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, installDb, openExtensionPage, reReadKdbx, SCANNED_TOTP_SECRET, test } from '../helpers';

function findEntry(db: kdbxweb.Kdbx, title: string): kdbxweb.KdbxEntry | undefined {
  const groups = [...db.groups];
  while (groups.length) {
    const group = groups.pop()!;
    const entry = group.entries.find(candidate => candidate.fields.get('Title')?.toString() === title);
    if (entry) return entry;
    groups.push(...group.groups);
  }
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
}

async function openBrowserActionPopup(context: BrowserContext, extensionId: string, extensionPage: Page): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async () => chrome.action.openPopup());
  await expect.poll(async () => extensionPage.evaluate(extensionOrigin => {
    return chrome.extension.getViews({ type: 'popup' })
      .filter(view => view.location.origin === extensionOrigin).length;
  }, `chrome-extension://${extensionId}`)).toBe(1);
}

async function popupText(extensionPage: Page): Promise<string> {
  return extensionPage.evaluate(() => chrome.extension.getViews({ type: 'popup' })[0]?.document.body.innerText ?? '');
}

async function clickPopupButton(extensionPage: Page, name: string): Promise<void> {
  const clicked = await extensionPage.evaluate(label => {
    const view = chrome.extension.getViews({ type: 'popup' })[0];
    const button = Array.from(view?.document.querySelectorAll('button') ?? [])
      .find(candidate => candidate.getAttribute('aria-label')?.trim() === label
        || candidate.textContent?.trim() === label);
    button?.click();
    return Boolean(button);
  }, name);
  expect(clicked).toBe(true);
}

test('scans a visible TOTP QR from a realistic account page and persists it', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.totpQrUrl);
  await expect(site.getByRole('heading', { name: 'Security overview' })).toBeVisible();
  await expect(site.getByText('Recent sign-ins')).toBeVisible();
  await expect(site.getByRole('button', { name: 'Download recovery codes' })).toBeVisible();
  await expect(site.getByRole('img', { name: 'Authenticator setup QR code' })).toBeVisible();
  await site.bringToFront();

  await openBrowserActionPopup(context, extensionId, seed);
  await expect.poll(() => popupText(seed)).toContain('Localhost Login');
  await clickPopupButton(seed, 'Add entry');
  await clickPopupButton(seed, 'Scan page QR');

  await expect.poll(() => popupText(seed), { timeout: 15_000 }).toContain('Confirm the scanned account and destination.');
  const preview = await popupText(seed);
  expect(preview).toContain('QuickKee E2E');
  expect(preview).toContain('qr-user@localhost');
  expect(preview).toContain('SHA-1');
  expect(preview).toContain('6 digits');
  expect(preview).toContain('30 seconds');
  await clickPopupButton(seed, 'Add authenticator code');
  await expect.poll(() => popupText(seed)).toContain('Authenticator code saved.');

  await expect.poll(async () => {
    const entry = findEntry(await reReadKdbx(seed), 'Localhost Login');
    const otp = entry?.fields.get('otp');
    return {
      protected: otp instanceof kdbxweb.ProtectedValue,
      value: otp instanceof kdbxweb.ProtectedValue ? otp.getText() : '',
    };
  }).toEqual({
    protected: true,
    value: `otpauth://totp/QuickKee%20E2E:qr-user%40localhost?secret=${SCANNED_TOTP_SECRET}&period=30&digits=6&issuer=QuickKee%20E2E`,
  });
});
