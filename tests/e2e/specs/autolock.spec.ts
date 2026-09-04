import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, openExtensionPage, installDb, swCmd } from '../helpers';

async function unlockedPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
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

test('auto-close survives multiple sync polls and synthetic input, then permits re-unlock', async ({ context, extensionId }) => {
  const popup = await unlockedPopup(context, extensionId);
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

  // Plan 006 handles live lock rendering; keep the existing reload until it lands.
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
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
  });
}
