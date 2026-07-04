import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { startHttpFixture, startHttpsFixture } from './servers';
import * as kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../dist_chrome');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  http: Awaited<ReturnType<typeof startHttpFixture>>;
  https: Awaited<ReturnType<typeof startHttpsFixture>>;
}>({
  // Playwright fixture functions take a `use` callback by convention; renamed to `provide`
  // here so eslint-plugin-react-hooks doesn't mistake it for the React `use()` hook.
  // The empty `{}` first param is required by Playwright's own fixture machinery (it inspects
  // the function's source text to see which fixture names are destructured), so it can't be
  // renamed away like `use` was — disable no-empty-pattern here instead.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, provide) => {
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      permissions: ['clipboard-read', 'clipboard-write'],
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        '--no-first-run',
      ],
    });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await provide(ctx);
    await ctx.close();
  },
  extensionId: async ({ context }, provide) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await provide(new URL(sw.url()).host);
  },
  // eslint-disable-next-line no-empty-pattern
  http: async ({}, provide) => { const s = await startHttpFixture(); await provide(s); await s.close(); },
  // eslint-disable-next-line no-empty-pattern
  https: async ({}, provide) => { const s = await startHttpsFixture(); await provide(s); await s.close(); },
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
  return page.evaluate((m) => chrome.runtime.sendMessage({ ...m, __qk: 'test' }), msg);
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

let argonReady = false;
function ensureArgon() {
  if (argonReady) return;
  kdbxweb.CryptoEngine.setArgon2Impl(async (pwd, salt, mem, iter, len, par, type, ver) => {
    const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
    return fn({ password: new Uint8Array(pwd), salt: new Uint8Array(salt),
      parallelism: par, iterations: iter, memorySize: mem, hashLength: len,
      outputType: 'binary', version: ver });
  });
  argonReady = true;
}

/** Reads the current vault bytes back out of the extension page's IndexedDB and decrypts them. */
export async function reReadKdbx(page: Page, password = 'correct horse'): Promise<kdbxweb.Kdbx> {
  ensureArgon();
  const b64: string = await page.evaluate(() => new Promise<string>((res, rej) => {
    const open = indexedDB.open('quickkee', 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    open.onsuccess = () => {
      const req = open.result.transaction('handles', 'readonly').objectStore('handles').get('testBytes');
      req.onsuccess = () => {
        const buf = req.result as ArrayBuffer | undefined;
        if (!buf) { rej(new Error('testBytes not found in IndexedDB (vault not installed?)')); return; }
        const bytes = new Uint8Array(buf);
        let s = ''; for (const b of bytes) s += String.fromCharCode(b);
        res(btoa(s));
      };
      req.onerror = () => rej(req.error);
    };
    open.onerror = () => rej(open.error);
  }));
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password));
  return kdbxweb.Kdbx.load(arr.buffer, creds);
}

export function allEntryTitles(db: kdbxweb.Kdbx): string[] {
  const titles: string[] = [];
  for (const group of db.groups) walk(group, titles);
  return titles;
}
function walk(group: kdbxweb.KdbxGroup, out: string[]) {
  for (const e of group.entries) out.push(e.fields.get('Title')?.toString() ?? '');
  for (const g of group.groups) walk(g, out);
}
