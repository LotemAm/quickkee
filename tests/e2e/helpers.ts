import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../dist_chrome');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        '--no-first-run',
      ],
    });
    await use(ctx);
    await ctx.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;

const E2E_KDBX = path.resolve(__dirname, 'fixtures/e2e.kdbx');

export async function openExtensionPage(
  context: BrowserContext, extensionId: string, relPath: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relPath}`);
  return page;
}

export async function installDb(page: Page, kdbxPath: string = E2E_KDBX): Promise<void> {
  const b64 = fs.readFileSync(kdbxPath).toString('base64');
  const name = path.basename(kdbxPath);
  await page.waitForFunction(() => Boolean((window as any).__qkTest));
  await page.evaluate(({ data, name }) => (window as any).__qkTest.installDb(name, data), { data: b64, name });
}

export async function swCmd(page: Page, msg: Record<string, unknown>): Promise<any> {
  return page.evaluate((m) => chrome.runtime.sendMessage({ __qk: 'test', ...m }), msg);
}

export async function openPopupForTab(
  context: BrowserContext, extensionId: string, url: string, tabId: number,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/src/pages/popup/index.html` +
    `?qkurl=${encodeURIComponent(url)}&qktab=${tabId}`,
  );
  return page;
}
