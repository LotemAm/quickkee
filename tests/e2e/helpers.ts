import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { startHttpFixture, startHttpsFixture } from './servers';
import kdbxweb from 'kdbxweb';
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

export async function openEntryEditorMore(page: Page): Promise<void> {
  const section = page.locator('details', {
    has: page.locator('summary', { hasText: /^More/ }),
  });
  await expect(section).not.toHaveAttribute('open', '');
  await section.locator('summary').click();
  await expect(section).toHaveAttribute('open', '');
  await expect(page.getByLabel('Mark as credit card data')).toBeVisible();
}

export async function installDb(page: Page, kdbxPath: string = E2E_KDBX): Promise<void> {
  const b64 = fs.readFileSync(kdbxPath).toString('base64');
  const name = path.basename(kdbxPath);
  await page.waitForFunction(() => Boolean((window as unknown as { __qkTest?: unknown }).__qkTest));
  await page.evaluate(({ data, name }) => (window as unknown as { __qkTest: { installDb(name: string, b64: string): Promise<void> } }).__qkTest.installDb(name, data), { data: b64, name });
}

export interface SwCmdResponse {
  ok?: boolean;
  text?: string;
  color?: [number, number, number, number];
  count?: number;
  cert?: boolean;
  id?: number;
  tabs?: number[];
  prompt?: unknown;
}

export async function swCmd(page: Page, msg: Record<string, unknown>): Promise<SwCmdResponse> {
  return (await page.evaluate((m) => chrome.runtime.sendMessage({ ...m, __qk: 'test' }), msg)) as SwCmdResponse;
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

interface CdpNode {
  nodeName: string;
  nodeValue: string;
  backendNodeId: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
}

function descendants(node: CdpNode): CdpNode[] {
  const nested = [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])];
  return [node, ...nested.flatMap(descendants)];
}

function attribute(node: CdpNode, name: string): string | null {
  const attrs = node.attributes ?? [];
  const index = attrs.indexOf(name);
  return index >= 0 ? attrs[index + 1] : null;
}

async function withPromptNodes<T>(page: Page, run: (nodes: CdpNode[], client: Awaited<ReturnType<BrowserContext['newCDPSession']>>) => Promise<T>): Promise<T> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    const documentResult = await client.send('DOM.getDocument', { depth: -1, pierce: true }) as unknown as { root: CdpNode };
    const nodes = descendants(documentResult.root);
    const host = nodes.find(node => attribute(node, 'data-quickkee-credential-prompt') === 'true');
    if (!host) throw new Error('QuickKee credential prompt not found');
    return await run(descendants(host), client);
  } finally { await client.detach(); }
}

export async function closedCredentialPromptText(page: Page): Promise<string> {
  return withPromptNodes(page, async nodes => nodes.filter(node => node.nodeName === '#text').map(node => node.nodeValue).join(' ').replace(/\s+/g, ' ').trim());
}

export async function closedCredentialPromptPrimaryDisabled(page: Page): Promise<boolean> {
  return withPromptNodes(page, async (nodes, client) => {
    const button = nodes.find(node => attribute(node, 'data-action') === 'primary');
    if (!button) throw new Error('Credential prompt primary action not found');
    const { object } = await client.send('DOM.resolveNode', { backendNodeId: button.backendNodeId });
    const result = await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: 'function(){ return this.disabled; }', returnByValue: true,
    });
    return Boolean(result.result.value);
  });
}

export async function selectClosedCredentialDestination(page: Page, optionIndex = 1): Promise<void> {
  await withPromptNodes(page, async (nodes, client) => {
    const select = nodes.find(node => node.nodeName === 'SELECT');
    if (!select) throw new Error('Credential destination select not found');
    const { object } = await client.send('DOM.resolveNode', { backendNodeId: select.backendNodeId });
    await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function(index){ this.value = this.options[index].value; this.dispatchEvent(new Event("change", { bubbles: true })); }',
      arguments: [{ value: optionIndex }],
    });
  });
}

export async function clickClosedCredentialAction(page: Page, action: 'primary' | 'dismiss'): Promise<void> {
  await withPromptNodes(page, async (nodes, client) => {
    const button = nodes.find(node => attribute(node, 'data-action') === action);
    if (!button) throw new Error(`Credential prompt ${action} action not found`);
    const { object } = await client.send('DOM.resolveNode', { backendNodeId: button.backendNodeId });
    const result = await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function(){ const r=this.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; }',
      returnByValue: true,
    });
    const point = result.result.value as { x: number; y: number };
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  });
}
