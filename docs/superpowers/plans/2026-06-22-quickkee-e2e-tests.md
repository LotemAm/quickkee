# QuickKee E2E Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the README "Manual Verification Checklist" (7 steps) as Playwright E2E tests against the real built Chrome extension, run them, and write a fix plan per failure.

**Architecture:** Playwright launches a persistent Chromium context with the real `dist_chrome/` build loaded as an unpacked extension. Test-only seams (build-flag gated, stripped from the production build) bypass the native File System Access picker, expose service-worker badge/matcher/lock state, and let the popup target a fixture tab. Hermetic local HTTP + self-signed HTTPS servers provide the page surfaces. Persistence is verified by re-reading the `.kdbx` with kdbxweb.

**Tech Stack:** `@playwright/test`, Vite (mode-based env flag), `kdbxweb` + `hash-wasm`, `selfsigned`, Node `http`/`https`.

## Global Constraints

- Chrome only; MV3. (No Firefox E2E.)
- Test seams MUST be gated on `import.meta.env.VITE_QK_TEST === '1'` so the default `build:chrome` strips them. Never ship seam behavior.
- Extension is loaded headed (MV3 extensions do not load under legacy headless).
- Fixture vault password: `correct horse`.
- Matcher matches by **hostname** (`src/background/matcher.ts`): `localhost` != `127.0.0.1`. Use `localhost` for the saved/matching origin and `127.0.0.1` for the unsaved/non-matching origin (same server, same port).
- Badge colors (from `src/background/icon.ts` / SW): match = `#16a34a`, no-match/gray = `#6b7280`, cert error = `#dc2626` text `!`.
- All new test code lives under `tests/e2e/`. Do not restructure existing `src/` beyond the guarded seam edits named in tasks.

---

## File Structure

- `playwright.config.ts` (create) — runner config, headed, single worker.
- `.env.test` (create) — `VITE_QK_TEST=1` (loaded only for `--mode test`).
- `package.json` (modify) — add `@playwright/test`, `selfsigned`; add `build:chrome:test`, `test:e2e` scripts.
- `src/background/fileHandle.ts` (modify) — add `saveTestBytes` + test-mode `loadHandle` returning a fake handle backed by IndexedDB bytes.
- `src/shared/testSeam.ts` (create) — exposes `globalThis.__qkTest.installDb` on extension pages (gated).
- `src/pages/popup/index.tsx`, `src/pages/panel/index.tsx`, `src/pages/options/index.tsx` (modify) — side-effect import of `testSeam`.
- `src/pages/background/index.ts` (modify) — gated SW test message listener (`badge`/`match`/`lock`/`armShort`/`tabId`/`warned`) + ignore test messages in the main listener.
- `src/pages/popup/Popup.tsx` (modify) — gated tab override from `?qkurl=&qktab=` query params.
- `tests/e2e/servers.ts` (create) — local HTTP login-page server + self-signed HTTPS server.
- `tests/e2e/fixtures/make-e2e-fixture.mjs` (create) — generates `tests/e2e/fixtures/e2e.kdbx`.
- `tests/e2e/fixtures/e2e.kdbx` (generated, committed).
- `tests/e2e/helpers.ts` (create) — Playwright `test` fixture (context/extensionId/http/https) + `installDb`, `openPopup`, `swCmd`, `reReadKdbx` helpers.
- `tests/e2e/specs/*.spec.ts` (create) — one spec per checklist step.

---

## Task 1: Playwright harness + extension loading

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/helpers.ts`
- Create: `tests/e2e/specs/smoke.spec.ts`

**Interfaces:**
- Produces: `tests/e2e/helpers.ts` exporting `test` (extended Playwright fixture with `context: BrowserContext` and `extensionId: string`) and `expect`.

- [ ] **Step 1: Add dev dependencies and scripts**

Run:
```bash
yarn add -D @playwright/test selfsigned
npx playwright install chromium
```

Then add to `package.json` `"scripts"`:
```json
"build:chrome:test": "vite build --config vite.config.chrome.ts --mode test",
"test:e2e": "yarn build:chrome:test && playwright test"
```

- [ ] **Step 2: Create `.env.test`**

Create `.env.test`:
```
VITE_QK_TEST=1
```

- [ ] **Step 3: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
});
```

- [ ] **Step 4: Create the harness fixture `tests/e2e/helpers.ts`**

```ts
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

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
```

- [ ] **Step 5: Write the smoke spec `tests/e2e/specs/smoke.spec.ts`**

```ts
import { test, expect } from '../helpers';

test('extension loads and exposes a service worker id', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});
```

- [ ] **Step 6: Build and run the smoke test**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/smoke.spec.ts
```
Expected: PASS — 1 passed. (A Chromium window opens briefly.)

- [ ] **Step 7: Commit**

```bash
git add package.json yarn.lock playwright.config.ts .env.test tests/e2e/helpers.ts tests/e2e/specs/smoke.spec.ts
git commit -m "test(e2e): playwright harness loads the unpacked extension"
```

---

## Task 2: File seam + Spec 1 (first-run unlock)

**Files:**
- Modify: `src/background/fileHandle.ts`
- Create: `src/shared/testSeam.ts`
- Modify: `src/pages/popup/index.tsx`, `src/pages/panel/index.tsx`, `src/pages/options/index.tsx`
- Modify: `tests/e2e/helpers.ts`
- Create: `tests/e2e/fixtures/make-e2e-fixture.mjs`
- Create: `tests/e2e/fixtures/e2e.kdbx` (generated)
- Create: `tests/e2e/specs/unlock.spec.ts`

**Interfaces:**
- Produces (`fileHandle.ts`): `saveTestBytes(name: string, bytes: ArrayBuffer): Promise<void>`; test-mode `loadHandle()` returns a fake `FileSystemFileHandle` backed by IndexedDB bytes.
- Produces (`testSeam.ts`): side-effect module attaching `globalThis.__qkTest = { installDb(name: string, b64: string): Promise<void> }` when gated on.
- Produces (`helpers.ts`): `installDb(page, kdbxPath?): Promise<void>`, `openExtensionPage(context, extensionId, relPath): Promise<Page>`.

- [ ] **Step 1: Generate the e2e fixture vault**

Create `tests/e2e/fixtures/make-e2e-fixture.mjs`:
```js
import * as kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';
import { writeFileSync } from 'node:fs';

kdbxweb.CryptoEngine.setArgon2Impl(async (pwd, salt, mem, iter, len, par, type, ver) => {
  const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
  return fn({ password: new Uint8Array(pwd), salt: new Uint8Array(salt),
    parallelism: par, iterations: iter, memorySize: mem, hashLength: len,
    outputType: 'binary', version: ver });
});

const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
const db = kdbxweb.Kdbx.create(creds, 'QuickKee E2E');
const group = db.createGroup(db.getDefaultGroup(), 'Sites');
const e = db.createEntry(group);
e.fields.set('Title', 'Localhost Login');
e.fields.set('UserName', 'e2e-user');
e.fields.set('Password', kdbxweb.ProtectedValue.fromString('e2e-pass'));
e.fields.set('URL', 'http://localhost');
const buf = await db.save();
writeFileSync(new URL('./e2e.kdbx', import.meta.url), Buffer.from(buf));
console.log('wrote e2e.kdbx');
```

Run:
```bash
node tests/e2e/fixtures/make-e2e-fixture.mjs
```
Expected: prints `wrote e2e.kdbx`; file `tests/e2e/fixtures/e2e.kdbx` exists.

- [ ] **Step 2: Add the file seam to `src/background/fileHandle.ts`**

Append after the existing `clearHandle`:
```ts
const TEST = import.meta.env.VITE_QK_TEST === '1';
const BYTES_KEY = 'testBytes', NAME_KEY = 'testName';

export async function saveTestBytes(name: string, bytes: ArrayBuffer): Promise<void> {
  await tx('readwrite', s => s.put(bytes, BYTES_KEY));
  await tx('readwrite', s => s.put(name, NAME_KEY));
}

function makeFakeHandle(name: string): FileSystemFileHandle {
  return {
    name, kind: 'file',
    async getFile() {
      const b = await tx<ArrayBuffer>('readonly', s => s.get(BYTES_KEY));
      return new File([b], name);
    },
    async createWritable() {
      const parts: BlobPart[] = [];
      return {
        async write(data: BlobPart) { parts.push(data); },
        async close() { const buf = await new Blob(parts).arrayBuffer(); await tx('readwrite', s => s.put(buf, BYTES_KEY)); },
      };
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  } as unknown as FileSystemFileHandle;
}
```

Then change `loadHandle` to honor test mode:
```ts
export async function loadHandle(): Promise<FileSystemFileHandle | null> {
  if (TEST) {
    const name = await tx<string | undefined>('readonly', s => s.get(NAME_KEY));
    return name ? makeFakeHandle(name) : null;
  }
  return (await tx<FileSystemFileHandle | undefined>('readonly', s => s.get(KEY))) ?? null;
}
```

- [ ] **Step 3: Create `src/shared/testSeam.ts`**

```ts
import { saveTestBytes } from '../background/fileHandle';

if (import.meta.env.VITE_QK_TEST === '1') {
  (globalThis as unknown as { __qkTest: unknown }).__qkTest = {
    async installDb(name: string, b64: string) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await saveTestBytes(name, bytes.buffer);
    },
  };
}
```

- [ ] **Step 4: Import the seam for side effect in each page entry**

Add as the FIRST import line in `src/pages/popup/index.tsx`, `src/pages/panel/index.tsx`, and `src/pages/options/index.tsx`:
```ts
import '../../shared/testSeam';
```

- [ ] **Step 5: Add `installDb` + `openExtensionPage` helpers to `tests/e2e/helpers.ts`**

Add imports at top:
```ts
import fs from 'node:fs';
import { type Page } from '@playwright/test';
```
Add exports at the bottom:
```ts
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
  await page.waitForFunction(() => Boolean((window as any).__qkTest));
  await page.evaluate((data) => (window as any).__qkTest.installDb('e2e.kdbx', data), b64);
}
```

- [ ] **Step 6: Write the failing unlock spec `tests/e2e/specs/unlock.spec.ts`**

```ts
import { test, expect, openExtensionPage, installDb } from '../helpers';

test('first run: install db, enter password, vault opens', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();

  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();

  // Locked view shows the Unlock button; unlocked view shows the search box.
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
});
```

- [ ] **Step 7: Run to verify it fails (before seam wired into a fresh build)**

Run:
```bash
yarn build:chrome:test && npx playwright test tests/e2e/specs/unlock.spec.ts
```
Expected: PASS once the build includes Steps 2–4. If it FAILS with "`__qkTest` undefined", confirm `.env.test` is loaded (build log shows mode `test`) and the seam import is present.

- [ ] **Step 8: Confirm production build strips the seam**

Run:
```bash
yarn build:chrome && grep -rl "__qkTest" dist_chrome || echo "SEAM ABSENT"
```
Expected: prints `SEAM ABSENT`.

- [ ] **Step 9: Commit**

```bash
git add src/background/fileHandle.ts src/shared/testSeam.ts src/pages/popup/index.tsx src/pages/panel/index.tsx src/pages/options/index.tsx tests/e2e/helpers.ts tests/e2e/fixtures/make-e2e-fixture.mjs tests/e2e/fixtures/e2e.kdbx tests/e2e/specs/unlock.spec.ts
git commit -m "test(e2e): file seam + first-run unlock spec"
```

---

## Task 3: SW test handler + popup tab override

**Files:**
- Modify: `src/pages/background/index.ts`
- Modify: `src/pages/popup/Popup.tsx`
- Modify: `tests/e2e/helpers.ts`

**Interfaces:**
- Produces (SW listener, gated): responds to `{ __qk: 'test', cmd, ... }` messages:
  - `{ cmd: 'badge', tabId }` → `{ text: string, color: number[] }`
  - `{ cmd: 'match', url, tabId }` → `{ count: number, cert: boolean }`
  - `{ cmd: 'lock' }` → `{ ok: true }`
  - `{ cmd: 'armShort', hours }` → `{ ok: true }`
  - `{ cmd: 'tabId', url }` → `{ id: number | undefined }` (first tab whose url starts with `url`)
  - `{ cmd: 'warned' }` → `{ tabs: number[] }`
- Produces (Popup): in test mode, `?qkurl=<full-url>&qktab=<id>` query params set the target tab directly.
- Produces (`helpers.ts`): `swCmd(page, msg): Promise<any>`, `openPopupForTab(context, extensionId, url, tabId): Promise<Page>`.

- [ ] **Step 1: Ignore test messages in the main SW listener**

In `src/pages/background/index.ts`, change the existing `onMessage` listener to early-return on test messages:
```ts
chrome.runtime.onMessage.addListener((req: Request, _s, sendResponse) => {
  if ((req as unknown as { __qk?: string }).__qk === 'test') return false;
  handle_(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // async
});
```

- [ ] **Step 2: Add the gated SW test listener**

Append to the end of `src/pages/background/index.ts`:
```ts
if (import.meta.env.VITE_QK_TEST === '1') {
  chrome.runtime.onMessage.addListener((req: any, _s, send) => {
    if (!req || req.__qk !== 'test') return false;
    (async () => {
      switch (req.cmd) {
        case 'badge': {
          const text = await chrome.action.getBadgeText({ tabId: req.tabId });
          const color = await chrome.action.getBadgeBackgroundColor({ tabId: req.tabId });
          send({ text, color });
          break;
        }
        case 'match':
          send({ count: vault.isOpen() ? vault.entriesForUrl(req.url).length : 0, cert: warnedTabs.has(req.tabId) });
          break;
        case 'lock': doLock(); send({ ok: true }); break;
        case 'armShort': autolock.arm(req.hours); send({ ok: true }); break;
        case 'tabId': {
          const tabs = await chrome.tabs.query({});
          send({ id: tabs.find(t => t.url?.startsWith(req.url))?.id });
          break;
        }
        case 'warned': send({ tabs: Array.from(warnedTabs) }); break;
        default: send({});
      }
    })();
    return true;
  });
}
```

- [ ] **Step 3: Add the popup tab override**

In `src/pages/popup/Popup.tsx`, replace the active-tab effect:
```ts
  useEffect(() => { chrome.tabs.query({ active: true, currentWindow: true })
    .then(([t]) => t?.id && t.url && setTab({ id: t.id, url: t.url })); }, []);
```
with:
```ts
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (import.meta.env.VITE_QK_TEST === '1' && p.get('qkurl')) {
      setTab({ id: Number(p.get('qktab')), url: p.get('qkurl')! });
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([t]) => t?.id && t.url && setTab({ id: t.id, url: t.url }));
  }, []);
```

- [ ] **Step 4: Add `swCmd` + `openPopupForTab` helpers to `tests/e2e/helpers.ts`**

Append:
```ts
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
```

- [ ] **Step 5: Write a test verifying the SW handler responds**

Create `tests/e2e/specs/sw-handler.spec.ts`:
```ts
import { test, expect, openExtensionPage, installDb, swCmd } from '../helpers';

test('sw test handler reports locked match count of 0 before unlock', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  const r = await swCmd(popup, { cmd: 'match', url: 'http://localhost/', tabId: -1 });
  expect(r).toEqual({ count: 0, cert: false });
});
```

- [ ] **Step 6: Build and run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/sw-handler.spec.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/background/index.ts src/pages/popup/Popup.tsx tests/e2e/helpers.ts tests/e2e/specs/sw-handler.spec.ts
git commit -m "test(e2e): sw test-query handler + popup tab override"
```

---

## Task 4: Local fixture servers

**Files:**
- Create: `tests/e2e/servers.ts`
- Modify: `tests/e2e/helpers.ts`

**Interfaces:**
- Produces (`servers.ts`): `startHttpFixture(): Promise<{ port: number; url: string; altUrl: string; close(): Promise<void> }>` (login page; `url` uses `localhost`, `altUrl` uses `127.0.0.1`, same port); `startHttpsFixture(): Promise<{ port: number; url: string; close(): Promise<void> }>` (self-signed HTTPS).
- Produces (`helpers.ts`): the `test` fixture gains `http` and `https` fixtures with those shapes.

- [ ] **Step 1: Create `tests/e2e/servers.ts`**

```ts
import http from 'node:http';
import https from 'node:https';
import selfsigned from 'selfsigned';
import type { AddressInfo } from 'node:net';

const LOGIN_PAGE = `<!doctype html><html><body>
<h1>Login</h1>
<form>
  <input id="username" name="username" type="text" autocomplete="username" />
  <input id="password" name="password" type="password" autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;

export async function startHttpFixture() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(LOGIN_PAGE);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://localhost:${port}/`,
    altUrl: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}

export async function startHttpsFixture() {
  const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1 });
  const server = https.createServer({ key: pems.private, cert: pems.cert }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body><h1>insecure</h1></body></html>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `https://localhost:${port}/`,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}
```

- [ ] **Step 2: Wire `http` / `https` fixtures into `tests/e2e/helpers.ts`**

Add import:
```ts
import { startHttpFixture, startHttpsFixture } from './servers';
```
Extend the generic of `base.extend<...>` and add the two fixtures:
```ts
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  http: Awaited<ReturnType<typeof startHttpFixture>>;
  https: Awaited<ReturnType<typeof startHttpsFixture>>;
}>({
  // ...existing context + extensionId fixtures unchanged...
  http: async ({}, use) => { const s = await startHttpFixture(); await use(s); await s.close(); },
  https: async ({}, use) => { const s = await startHttpsFixture(); await use(s); await s.close(); },
});
```

- [ ] **Step 3: Write a test that the login page serves on both hostnames**

Create `tests/e2e/specs/servers.spec.ts`:
```ts
import { test, expect } from '../helpers';

test('http fixture serves a login form on localhost and 127.0.0.1', async ({ context, http }) => {
  const page = await context.newPage();
  await page.goto(http.url);
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await page.goto(http.altUrl);
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
```

- [ ] **Step 4: Run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/servers.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/servers.ts tests/e2e/helpers.ts tests/e2e/specs/servers.spec.ts
git commit -m "test(e2e): local http login + self-signed https fixture servers"
```

---

## Task 5: Spec 2 — saved-site (badge + copy + autofill)

**Files:**
- Create: `tests/e2e/specs/saved-site.spec.ts`

**Interfaces:**
- Consumes: `openExtensionPage`, `installDb`, `openPopupForTab`, `swCmd`, fixture `http`.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd } from '../helpers';

test('saved site: badge count, copy, autofill', async ({ context, extensionId, http }) => {
  // Install + unlock the vault via the popup.
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  // Open the matching site (localhost) and let the SW update its badge.
  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.url });
  expect(typeof tabId).toBe('number');

  // Badge: matcher state AND visible chrome.action badge.
  await expect.poll(async () => (await swCmd(seed, { cmd: 'match', url: http.url, tabId })).count).toBe(1);
  await expect.poll(async () => (await swCmd(seed, { cmd: 'badge', tabId })).text).toBe('1');

  // Open the popup pointed at that tab; entry is listed.
  const popup = await openPopupForTab(context, extensionId, http.url, tabId);
  await expect(popup.getByText('Localhost Login')).toBeVisible();

  // Copy username -> clipboard (read it back in the popup page, before auto-clear).
  await popup.getByRole('button', { name: 'Copy user' }).click();
  const copied = await popup.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe('e2e-user');

  // Autofill -> the content script fills the form on the site tab.
  await popup.getByRole('button', { name: 'Autofill' }).click();
  await expect.poll(() => site.locator('#username').inputValue()).resolves; // settle
  await expect(site.locator('#username')).toHaveValue('e2e-user');
  await expect(site.locator('#password')).toHaveValue('e2e-pass');
});
```

- [ ] **Step 2: Run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/saved-site.spec.ts
```
Expected: PASS. If "Copy user" clipboard read throws a permissions error, that is a real finding — record it for the fix-plan phase (Task 11) and, as the documented mitigation, grant clipboard permission in the `context` fixture via `context.grantPermissions(['clipboard-read', 'clipboard-write'])` keyed to the extension origin.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/saved-site.spec.ts
git commit -m "test(e2e): saved-site badge, copy, autofill"
```

---

## Task 6: Spec 3 — unsaved-site (create, save, revisit)

**Files:**
- Create: `tests/e2e/specs/unsaved-site.spec.ts`

**Interfaces:**
- Consumes: `openExtensionPage`, `installDb`, `openPopupForTab`, `swCmd`, `reReadKdbx` (added here), fixture `http`.

- [ ] **Step 1: Add a `reReadKdbx` helper to `tests/e2e/helpers.ts`**

This re-reads the seam's stored bytes out of the extension's IndexedDB (the same bytes `save` wrote) and decrypts them with kdbxweb — the KeePassXC round-trip equivalent. Append to `helpers.ts`:
```ts
import * as kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';

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
    const open = indexedDB.open('quickkee', 1);
    open.onsuccess = () => {
      const req = open.result.transaction('handles', 'readonly').objectStore('handles').get('testBytes');
      req.onsuccess = () => {
        const buf = req.result as ArrayBuffer;
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
```

- [ ] **Step 2: Write the spec `tests/e2e/specs/unsaved-site.spec.ts`**

```ts
import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd, reReadKdbx, allEntryTitles } from '../helpers';

test('unsaved site: create + save persists and revisit shows the badge', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  // 127.0.0.1 is a non-matching hostname -> no entries -> CreateForm shows.
  const site = await context.newPage();
  await site.goto(http.altUrl);
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.altUrl });

  const popup = await openPopupForTab(context, extensionId, http.altUrl, tabId);
  await expect(popup.getByText(`New entry for ${http.altUrl}`)).toBeVisible();
  await popup.getByPlaceholder('Title').fill('My 127 Site');
  await popup.getByPlaceholder('Username').fill('newuser');
  await popup.getByRole('button', { name: 'Create & Save' }).click();

  // Persisted to the .kdbx: re-read and assert the entry exists.
  await expect.poll(async () => allEntryTitles(await reReadKdbx(seed))).toContain('My 127 Site');

  // Revisit: matcher now counts 1 and the badge shows 1 for that tab.
  await expect.poll(async () => (await swCmd(seed, { cmd: 'match', url: http.altUrl, tabId })).count).toBe(1);
});
```

- [ ] **Step 3: Run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/unsaved-site.spec.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers.ts tests/e2e/specs/unsaved-site.spec.ts
git commit -m "test(e2e): unsaved-site create/save persistence + revisit"
```

---

## Task 7: Spec 4 — side panel edit, Save, kdbxweb round-trip

**Files:**
- Create: `tests/e2e/specs/panel-save.spec.ts`

**Interfaces:**
- Consumes: `openExtensionPage`, `installDb`, `reReadKdbx`, panel UI (`EntryEditor` "Apply changes", panel "Save *").

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, openExtensionPage, installDb, reReadKdbx } from '../helpers';
import * as kdbxweb from 'kdbxweb';

function findEntry(db: kdbxweb.Kdbx, title: string): kdbxweb.KdbxEntry | undefined {
  const stack = [...db.groups];
  while (stack.length) {
    const g = stack.pop()!;
    for (const e of g.entries) if (e.fields.get('Title')?.toString() === title) return e;
    stack.push(...g.groups);
  }
}

test('panel: edit an entry, Save, and verify via kdbxweb re-read', async ({ context, extensionId }) => {
  // Unlock through the popup first (shared vault state).
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  // Open the panel page, pick the entry, edit the password.
  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Localhost Login' }).click();
  const pwInput = panel.locator('label:has-text("Password") + input, input').nth(2);
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();
  // The third field input is Password (Title, Username, Password, URL order).
  await pwInput.fill('edited-pass-123');
  await panel.getByRole('button', { name: 'Apply changes' }).click();

  // Dirty indicator: the Save button now reads "Save *"; click it and it clears.
  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await expect(saveBtn).toContainText('Save *');
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  // KeePassXC equivalent: re-read the .kdbx and confirm the new password persisted.
  await expect.poll(async () => {
    const db = await reReadKdbx(panel);
    return findEntry(db, 'Localhost Login')?.fields.get('Password')?.toString();
  }).toBe('edited-pass-123');
});
```

- [ ] **Step 2: Run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/panel-save.spec.ts
```
Expected: PASS. If the password-field locator is ambiguous, that is a finding — switch to a precise locator (`panel.locator('input').nth(2)` for Title/Username/Password order) and record it for Task 11.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/panel-save.spec.ts
git commit -m "test(e2e): panel edit/save with kdbxweb round-trip"
```

---

## Task 8: Spec 5 — options persistence

**Files:**
- Create: `tests/e2e/specs/options.spec.ts`

**Interfaces:**
- Consumes: `openExtensionPage`. Options page saves on change to `chrome.storage.local` key `settings`.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, openExtensionPage } from '../helpers';

test('options: changing settings persists to chrome.storage.local across reload', async ({ context, extensionId }) => {
  const opts = await openExtensionPage(context, extensionId, 'src/pages/options/index.html');

  // Change auto-close to 24h and enable dark theme (both save-on-change).
  await opts.getByRole('combobox').first().selectOption('24');
  await opts.getByRole('checkbox', { name: 'Dark theme' }).check();

  // Reload and confirm the controls reflect the saved values.
  await opts.reload();
  await expect(opts.getByRole('combobox').first()).toHaveValue('24');
  await expect(opts.getByRole('checkbox', { name: 'Dark theme' })).toBeChecked();

  // And confirm the underlying storage.
  const stored = await opts.evaluate(() => chrome.storage.local.get('settings'));
  expect(stored.settings.autoCloseHours).toBe(24);
  expect(stored.settings.theme).toBe('dark');
});
```

- [ ] **Step 2: Run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/options.spec.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/options.spec.ts
git commit -m "test(e2e): options persistence"
```

---

## Task 9: Spec 6 — auto-close locks the vault

**Files:**
- Create: `tests/e2e/specs/autolock.spec.ts`

**Interfaces:**
- Consumes: `openExtensionPage`, `installDb`, `swCmd` (`armShort`, `lock`). Uses the real `AutoLock` timer via a sub-second duration.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, openExtensionPage, installDb, swCmd } from '../helpers';

test('auto-close locks the vault and it can be re-unlocked', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  // Arm the real auto-lock timer with ~1.2s (hours = 1.2/3600), then wait it out.
  await swCmd(popup, { cmd: 'armShort', hours: 1.2 / 3600 });
  await expect.poll(
    async () => (await swCmd(popup, { cmd: 'match', url: 'http://localhost/', tabId: -1 })).count,
    { timeout: 8000 },
  ).toBe(0); // count drops to 0 once the vault locks

  // Popup now shows the locked (Unlock) view; re-unlock works.
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Unlock' })).toBeVisible();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
});
```

- [ ] **Step 2: Run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/autolock.spec.ts
```
Expected: PASS. If the lock does not fire within the timeout, that is a real finding (MV3 service-worker `setTimeout` reliability — see the project's known `AutoLock` concern): record it for Task 11, and as the documented fallback assert the lock path directly with `swCmd(popup, { cmd: 'lock' })` while keeping `armShort` coverage as the timer probe.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/autolock.spec.ts
git commit -m "test(e2e): auto-close lock and re-unlock"
```

---

## Task 10: Spec 7 — bad-certificate warning

**Files:**
- Create: `tests/e2e/specs/cert-warning.spec.ts`

**Interfaces:**
- Consumes: `swCmd` (`warned`, `badge`), fixture `https`. The persistent context must NOT ignore HTTPS errors (default), so the self-signed nav triggers `webNavigation.onErrorOccurred`.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, swCmd, openExtensionPage } from '../helpers';

test('bad certificate: badge shows red ! for the offending tab', async ({ context, extensionId, https }) => {
  // A page to send SW test commands from.
  const probe = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');

  const site = await context.newPage();
  // Navigation to a self-signed origin fails at the cert interstitial; swallow the error.
  await site.goto(https.url).catch(() => {});

  // SW recorded a cert warning for some tab.
  const { tabs } = await (async () => {
    let r = { tabs: [] as number[] };
    await expect.poll(async () => {
      r = await swCmd(probe, { cmd: 'warned' });
      return r.tabs.length;
    }, { timeout: 8000 }).toBeGreaterThan(0);
    return r;
  })();

  // The visible badge for that tab is the red '!'.
  const badge = await swCmd(probe, { cmd: 'badge', tabId: tabs[0] });
  expect(badge.text).toBe('!');
  // #dc2626 -> rgba(220, 38, 38, 255)
  expect(badge.color).toEqual([220, 38, 38, 255]);
});
```

- [ ] **Step 2: Run**

Run:
```bash
yarn test:e2e -- tests/e2e/specs/cert-warning.spec.ts
```
Expected: PASS. If `onErrorOccurred` does not fire (e.g. Chrome served the interstitial without a navigation error event under automation), that is a real finding — record it for Task 11; documented fallback is to assert `shouldWarnCertError` logic at the unit level and mark the live-TLS path as a known E2E limitation.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/cert-warning.spec.ts
git commit -m "test(e2e): bad-certificate warning badge"
```

---

## Task 11: Full run + fix plans + docs

**Files:**
- Create: `docs/superpowers/plans/2026-06-22-<spec>-fix.md` (one per failing spec, only as needed)
- Modify: `README.md`

**Interfaces:**
- Consumes: all specs from Tasks 1–10.

- [ ] **Step 1: Run the full suite**

Run:
```bash
yarn test:e2e
```
Expected: the HTML report lists all specs. Note every failure.

- [ ] **Step 2: Triage each failure**

For EACH failing spec, classify and write a fix-plan doc at `docs/superpowers/plans/2026-06-22-<spec>-fix.md` containing:
- **Symptom** — the exact assertion/error text.
- **Classification** — product bug / test or seam bug / browser-boundary limitation.
- **Root cause** — what actually happened (investigate; do not guess).
- **Fix steps** — concrete edits, or, for a true limitation, the documented downgrade (unit-level coverage + a README note).

Do not apply product fixes in this task — these are handoff plans (the suite's job is to surface issues).

- [ ] **Step 3: Document the suite in `README.md`**

Add a section after "Manual Verification Checklist":
```markdown
## Automated E2E (Playwright)

The manual checklist above is mirrored by a Playwright suite that drives the
real unpacked extension. Test-only seams (gated on `VITE_QK_TEST`, stripped
from `yarn build:chrome`) bypass the native file picker, expose service-worker
badge/match state, and serve local HTTP + self-signed HTTPS fixtures.

```bash
yarn test:e2e
```

Notes:
- Runs headed (MV3 extensions don't load under legacy headless).
- Persistence is verified by re-reading the `.kdbx` with kdbxweb (KeePassXC equivalent).
- Any step that cannot be automated end-to-end is documented as a known limitation in `docs/superpowers/plans/`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/
git commit -m "test(e2e): full-suite docs and fix plans"
```

---

## Self-Review notes

- **Spec coverage:** Checklist steps 1–7 map to Tasks 2, 5, 6, 7, 8, 9, 10 respectively; "Both" badge assertion (match state + `chrome.action`) is in Tasks 5 and 10; self-signed HTTPS in Task 4/10; kdbxweb re-read (KeePassXC equiv) in Tasks 6/7; short-duration + direct-lock seam in Tasks 3/9.
- **Seam gating:** every seam is behind `import.meta.env.VITE_QK_TEST === '1'`; Task 2 Step 8 asserts the production build strips it.
- **Type consistency:** SW handler commands (`badge`/`match`/`lock`/`armShort`/`tabId`/`warned`) are defined in Task 3 and consumed unchanged in Tasks 5/6/9/10; `reReadKdbx`/`allEntryTitles` defined in Task 6 and reused in Task 7; `openPopupForTab` defined in Task 3 used in Tasks 5/6.
- **Known-limitation escape hatches** are written into the spec tasks (clipboard perms, MV3 timer, cert event) so a true browser boundary becomes a documented downgrade, not a silent failure.
```