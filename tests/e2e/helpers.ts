import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { startHttpFixture, startHttpsFixture } from './servers';
export { SCANNED_TOTP_SECRET } from './servers';
import kdbxweb from 'kdbxweb';
import { registerArgon2 } from '../../src/background/crypto';

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

/** Stop the actual extension service worker using Chromium's lifecycle control. */
export async function stopExtensionWorker(page: Page, extensionId: string): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const versions = new Map<string, { scriptURL: string; runningStatus: string }>();
  const stopped = new Set<string>();
  try {
    client.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
      for (const version of updates) {
        versions.set(version.versionId, version);
        if (version.runningStatus === 'stopped') stopped.add(version.versionId);
      }
    });
    await client.send('ServiceWorker.enable');
    const running = () => [...versions].find(([, version]) =>
      version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && version.runningStatus === 'running');
    await expect.poll(() => running()?.[0], { timeout: 5000 }).toBeDefined();
    const versionId = running()![0];
    stopped.delete(versionId);
    await client.send('ServiceWorker.stopWorker', { versionId });
    // UnlockScreen may immediately wake a new worker. Preserve the observed stop transition.
    await expect.poll(() => stopped.has(versionId), { timeout: 5000 }).toBe(true);
  } finally { await client.detach(); }
}

/** A real Chromium WebAuthn implementation backed by CDP's internal virtual
 * authenticator. This proves browser PRF behavior, not physical hardware. */
export async function addPrfAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  });
}

export async function openEntryEditorMore(page: Page): Promise<void> {
  const section = page.locator('details', {
    has: page.locator('summary', { hasText: /^More/ }),
  });
  await expect(section).not.toHaveAttribute('open', '');
  await section.locator('summary').click();
  await expect(section).toHaveAttribute('open', '');
  await expect(page.getByLabel('Group', { exact: true })).toBeVisible();
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

/** Resolve a browser tab or fail before sending a command with a missing ID. */
export async function getTabId(page: Page, url: string): Promise<number> {
  const { id } = await swCmd(page, { cmd: 'tabId', url });
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
    throw new Error(`Expected a non-negative integer tab ID for ${url}, received ${String(id)}`);
  }
  return id;
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

/** Reads the current vault bytes back out of the extension page's IndexedDB and decrypts them. */
export async function reReadKdbx(page: Page, password = 'correct horse'): Promise<kdbxweb.Kdbx> {
  registerArgon2();
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

type CdpClient = Awaited<ReturnType<BrowserContext['newCDPSession']>>;
type WithNodes<T> = (nodes: CdpNode[], client: CdpClient) => Promise<T>;

async function withClosedHostNodes<T>(page: Page, hostAttribute: string, run: WithNodes<T>): Promise<T> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    const documentResult = await client.send('DOM.getDocument', { depth: -1, pierce: true }) as unknown as { root: CdpNode };
    const nodes = descendants(documentResult.root);
    const host = nodes.find(node => attribute(node, hostAttribute) === 'true');
    if (!host) throw new Error(`QuickKee host ${hostAttribute} not found`);
    return await run(descendants(host), client);
  } finally { await client.detach(); }
}

function withPromptNodes<T>(page: Page, run: WithNodes<T>): Promise<T> {
  return withClosedHostNodes(page, 'data-quickkee-credential-prompt', run);
}

function nodesText(nodes: CdpNode[]): string {
  return nodes.filter(node => node.nodeName === '#text').map(node => node.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
}

export async function closedCredentialPromptText(page: Page): Promise<string> {
  return withPromptNodes(page, async nodes => nodesText(nodes));
}

export async function closedInlinePopupText(page: Page): Promise<string> {
  return withClosedHostNodes(page, 'data-quickkee-popup', async nodes => nodesText(nodes));
}

export async function closedInlinePopupProgress(page: Page): Promise<{ remaining: number; width: string }> {
  return withClosedHostNodes(page, 'data-quickkee-popup', async nodes => {
    const bar = nodes.find(node => attribute(node, 'role') === 'progressbar' && attribute(node, 'aria-label') === 'TOTP time remaining');
    if (!bar) throw new Error('Inline TOTP progress bar not found');
    return { remaining: Number(attribute(bar, 'aria-valuenow')), width: attribute(bar.children![0], 'style') ?? '' };
  });
}

export async function clickClosedInlineEntry(page: Page, title: string): Promise<void> {
  await withClosedHostNodes(page, 'data-quickkee-popup', async (nodes, client) => {
    const row = nodes.find(node => attribute(node, 'class')?.split(' ').includes('e') &&
      node.children?.some(child => attribute(child, 'class') === 't' && nodesText(descendants(child)) === title));
    if (!row) throw new Error(`Inline entry ${title} not found`);
    await clickCdpNode(row, client);
  });
}

/** Page-world attacks must remain synthetic; successful selection uses browser input below. */
export async function attemptSyntheticInlineSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector('[data-quickkee-popup]')!;
    const target = host.shadowRoot?.querySelector('.e') ?? host;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
    for (const key of ['ArrowDown', 'Enter']) {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
  });
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

export async function selectClosedCredentialGroup(page: Page, optionIndex = 1): Promise<void> {
  await withPromptNodes(page, async (nodes, client) => {
    const select = nodes.find(node => node.nodeName === 'SELECT' && attribute(node, 'aria-label') === 'Group');
    if (!select) throw new Error('Credential group select not found');
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
    await clickCdpNode(button, client);
  });
}

/** For main-frame nodes. Use the focused frame's keyboard for iframe selections. */
async function clickCdpNode(node: CdpNode, client: CdpClient): Promise<void> {
  const { object } = await client.send('DOM.resolveNode', { backendNodeId: node.backendNodeId });
  const result = await client.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function(){ const r=this.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; }',
    returnByValue: true,
  });
  const point = result.result.value as { x: number; y: number };
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}
