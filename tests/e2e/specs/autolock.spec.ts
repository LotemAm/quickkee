import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, openExtensionPage, installDb, swCmd, stopExtensionWorker } from '../helpers';

async function unlockedPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html?qkurl=http%3A%2F%2Flocalhost%2F&qktab=-1');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
  return popup;
}

async function locked(popup: Page): Promise<boolean> {
  return popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'getStatus' })).locked);
}

async function revealBoth(context: BrowserContext, extensionId: string, popup: Page): Promise<Page> {
  // Use a persisted entry so this test does not depend on draft recovery after a worker crash.
  expect(await swCmd(popup, { cmd: 'credentialPrepare', url: 'http://localhost' })).toMatchObject({ ok: true });
  expect(await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save' }))).toMatchObject({ ok: true });
  await popup.getByPlaceholder('Search…').fill('Localhost');
  await popup.getByRole('button', { name: 'Show authenticator code' }).click();
  await expect(popup.getByLabel(/^Current TOTP code /)).toBeVisible();
  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites', exact: true }).click();
  await panel.getByRole('button', { name: 'Localhost Login' }).click();
  await panel.getByRole('button', { name: 'Show Password' }).click();
  const password = panel.locator('div.mb-3', { hasText: 'Password' }).locator('input');
  await expect(password).toHaveValue('e2e-pass');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(panel.getByRole('button', { name: 'Hide Password' })).toBeVisible();
  return panel;
}

async function expectBothLocked(popup: Page, panel: Page) {
  for (const page of [popup, panel]) {
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
    await expect(page.getByLabel('TOTP setup key or URI')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hide Password' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apply changes' })).toHaveCount(0);
    await expect(page.getByLabel(/^Current TOTP code /)).toHaveCount(0);
  }
}

async function reunlockBoth(popup: Page, panel: Page) {
  await popup.bringToFront();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
  await expect(popup.getByPlaceholder('Search…')).toHaveValue('');
  // Playwright forces all pages focused. Release that emulation so activating the
  // panel produces Chromium's native focus transition and exercises reconnect.
  const focusClient = await panel.context().newCDPSession(panel);
  await focusClient.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await panel.bringToFront();
  await focusClient.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await focusClient.detach();
  await expect(panel.getByPlaceholder('Search all entries…')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Apply changes' })).toHaveCount(0);
  await expect(popup.getByLabel('TOTP setup key or URI')).toHaveCount(0);
  await expect(popup.getByLabel(/^Current TOTP code /)).toHaveCount(0);
}

test('manual lock removes secrets from both open views without reload and re-unlock starts fresh', async ({ context, extensionId }) => {
  const popup = await unlockedPopup(context, extensionId);
  const panel = await revealBoth(context, extensionId, popup);
  await panel.getByRole('button', { name: 'Lock database' }).click();
  await expectBothLocked(popup, panel);
  await reunlockBoth(popup, panel);
});

test('auto-close survives multiple sync polls and synthetic input, then permits re-unlock', async ({ context, extensionId }) => {
  const popup = await unlockedPopup(context, extensionId);
  const panel = await revealBoth(context, extensionId, popup);
  // Ten seconds spans the popup's automatic four- and eight-second sync polls.
  await swCmd(popup, { cmd: 'armShort', hours: 10 / 3600 });
  const syntheticTimer = await popup.evaluate(() => window.setInterval(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  }, 1000));
  expect(await locked(popup)).toBe(false);
  await expect.poll(
    () => locked(popup), { timeout: 14_000, intervals: [500] },
  ).toBe(true);
  await popup.evaluate(timer => clearInterval(timer), syntheticTimer);

  await expectBothLocked(popup, panel);
  await reunlockBoth(popup, panel);
});

for (const input of ['keyboard', 'pointer'] as const) {
  test(`real ${input} activity delays auto-close, then the vault eventually locks`, async ({ context, extensionId }) => {
    const popup = await unlockedPopup(context, extensionId);
    await swCmd(popup, { cmd: 'armShort', hours: 6 / 3600 });
    await popup.waitForTimeout(3000);
    if (input === 'keyboard') await popup.keyboard.press('Shift');
    else await popup.getByPlaceholder('Search…').click();

    // Beyond the original six-second deadline, within six seconds of the input.
    await popup.waitForTimeout(4000);
    expect(await locked(popup)).toBe(false);
    await expect.poll(
      () => locked(popup), { timeout: 5000, intervals: [250] },
    ).toBe(true);
    await expect(popup.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  });
}

test('actual worker termination disconnects status ports and both views fail locked without reload', async ({ context, extensionId }) => {
  const popup = await unlockedPopup(context, extensionId);
  const panel = await revealBoth(context, extensionId, popup);
  for (const page of [popup, panel]) {
    await page.evaluate(() => new Promise<void>(resolve => {
      const probe = { disconnected: false, focuses: 0 };
      window.addEventListener('focus', event => { if (event.isTrusted) probe.focuses++; });
      (window as unknown as { statusProbe: typeof probe }).statusProbe = probe;
      const port = chrome.runtime.connect({ name: 'quickkee-vault-status' });
      port.onMessage.addListener(() => resolve());
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; probe.disconnected = true; });
    }));
  }
  await stopExtensionWorker(panel, extensionId);
  for (const page of [popup, panel]) {
    await expect.poll(() => page.evaluate(() => (window as unknown as { statusProbe: { disconnected: boolean } }).statusProbe.disconnected)).toBe(true);
  }
  await expectBothLocked(popup, panel);
  await reunlockBoth(popup, panel);
  expect(await panel.evaluate(() => (window as unknown as { statusProbe: { focuses: number } }).statusProbe.focuses)).toBeGreaterThan(0);
});
