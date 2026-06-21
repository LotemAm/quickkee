# QuickKee MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Chrome MV3 extension that opens a local `.kdbx` file, browses/edits entries and groups, autofills login forms, and saves back to the same file — with a service-worker-owned unlocked vault.

**Architecture:** The background service worker is the single owner of the decrypted database and master key. Popup, side panel, and content script are stateless React/TS views that message the SW. File access uses the File System Access API with a `FileSystemFileHandle` persisted in IndexedDB. Crypto and serialization use `kdbxweb`. Edits are held in memory and written on an explicit Save.

**Tech Stack:** vite-web-extension template (React 19, TypeScript, Tailwind 4, Vite, Manifest V3), `kdbxweb`, `hash-wasm` (Argon2 for kdbx4), `vitest`, `@testing-library/react`.

## Global Constraints

- Manifest V3, Chrome-first. No Firefox build in this plan.
- The master key and decrypted DB live ONLY in service-worker memory. No secret is ever written to `chrome.storage.local` / `.sync`, or sent to a UI context except the specific field values that context displays.
- `kdbxweb.CryptoEngine.setArgon2Impl(...)` MUST be registered before any `Kdbx.load`/`save`, in every context that calls them (SW only, here).
- All SW state mutations flow through the typed message contract in `src/shared/messages.ts`. UI never imports `vault.ts`.
- TDD: write the failing test first for every logic module. UI-shell tasks that cannot be unit-tested list explicit manual verification steps.
- Commit after every task.
- Package manager: `npm` (template default scripts). Adjust to `yarn` only if the scaffold uses it.

---

## File Structure

```
src/
  background/
    index.ts            # SW entry: registers Argon2, message router, keepalive, alarms, tab listeners
    vault.ts            # kdbxweb wrapper: holds DB+creds, open/edit/create/serialize
    fileHandle.ts       # IndexedDB-persisted FileSystemFileHandle, permission re-grant, read/write
    matcher.ts          # URL -> matching entries (registrable domain)
    autolock.ts         # auto-close timer + lock-on-close
    icon.ts             # per-tab badge text + color
    crypto.ts           # setArgon2Impl wiring (hash-wasm)
  pages/
    popup/              # quick search, entry list, copy, autofill, create-entry form
    panel/              # full tree browse + edit
    options/            # settings page
  content/
    index.ts            # field detection + fill executor
  shared/
    messages.ts         # typed request/response union + sendMessage helper
    entry.ts            # EntryView / GroupView / TreeNode view-model types
    pwgen.ts            # password generator
    clipboard.ts        # copy + auto-clear
    settings.ts         # settings load/save (chrome.storage.local, non-secret)
    theme.ts            # dark/light
  test/
    fixtures/test.kdbx  # known-password fixture database
```

---

## Phase 0 — Project bootstrap

### Task 1: Scaffold from template and add dependencies

**Files:**
- Create: whole template tree (via degit/clone), `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Clone the template into the repo**

```bash
npx degit JohnBra/vite-web-extension tmp-template
# move template files into repo root, preserving docs/ and SPEC.md
cp -r tmp-template/. .
rm -rf tmp-template
```

- [ ] **Step 2: Remove unused scaffolded pages**

Delete `src/pages/newtab`, `src/pages/devtools`, `src/pages/panel` ONLY if the template's `panel` differs from our side panel; keep `popup`, `options`, `background`, `content`. Keep `sidepanel`/`panel` dir for our side panel (rename to `panel` if needed). Remove their manifest references in the manifest source file.

- [ ] **Step 3: Install dependencies**

```bash
npm install
npm install kdbxweb hash-wasm
npm install -D vitest @testing-library/react @testing-library/dom jsdom @testing-library/jest-dom
```

- [ ] **Step 4: Add vitest config**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'jsdom', globals: true, setupFiles: [] },
});
```

- [ ] **Step 5: Add test script to package.json**

Add `"test": "vitest run"` and `"test:watch": "vitest"` to `scripts`.

- [ ] **Step 6: Verify build + test wiring**

Run: `npm run build:chrome` → Expected: produces `dist_chrome/`.
Run: `npm test` → Expected: "No test files found" (exit 0) or passes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite-web-extension template + test tooling"
```

---

### Task 2: Manifest permissions and side panel

**Files:**
- Modify: manifest source (e.g. `manifest.js`/`src/manifest.ts` per template)

**Interfaces:**
- Produces: a manifest declaring `sidePanel`, `storage`, `alarms`, `activeTab`, `scripting`, `tabs`, `webNavigation`, host permissions `<all_urls>`, a background service worker (`type: module`), a content script, popup, options, and `side_panel.default_path`.

- [ ] **Step 1: Edit the manifest source** to include:

```jsonc
{
  "manifest_version": 3,
  "permissions": ["storage", "alarms", "activeTab", "scripting", "tabs", "sidePanel", "webNavigation"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "action": { "default_popup": "src/pages/popup/index.html" },
  "options_page": "src/pages/options/index.html",
  "side_panel": { "default_path": "src/pages/panel/index.html" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["src/content/index.ts"], "run_at": "document_idle" }]
}
```
(Match the template's manifest authoring format — it may be a TS object.)

- [ ] **Step 2: Build and load unpacked**

Run: `npm run build:chrome`. Load `dist_chrome` in `chrome://extensions` (Developer mode). Expected: no manifest errors; icon, options, and side panel register.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: configure MV3 manifest (side panel + permissions)"
```

---

## Phase 1 — Crypto & vault core (pure logic, TDD)

### Task 3: Password generator

**Files:**
- Create: `src/shared/pwgen.ts`
- Test: `src/shared/pwgen.test.ts`

**Interfaces:**
- Produces: `interface PwGenOpts { length: number; lower: boolean; upper: boolean; digits: boolean; symbols: boolean }` and `function generatePassword(opts: PwGenOpts): string`. Default exported `DEFAULT_PWGEN: PwGenOpts = { length: 20, lower: true, upper: true, digits: true, symbols: true }`.

- [ ] **Step 1: Write failing tests**

```ts
import { generatePassword, DEFAULT_PWGEN } from './pwgen';

test('respects length', () => {
  expect(generatePassword({ ...DEFAULT_PWGEN, length: 16 })).toHaveLength(16);
});
test('only digits when only digits enabled', () => {
  const pw = generatePassword({ length: 40, lower: false, upper: false, digits: true, symbols: false });
  expect(pw).toMatch(/^[0-9]+$/);
});
test('includes at least one of each enabled class', () => {
  const pw = generatePassword({ length: 8, lower: true, upper: true, digits: true, symbols: true });
  expect(pw).toMatch(/[a-z]/); expect(pw).toMatch(/[A-Z]/);
  expect(pw).toMatch(/[0-9]/); expect(pw).toMatch(/[^a-zA-Z0-9]/);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export interface PwGenOpts { length: number; lower: boolean; upper: boolean; digits: boolean; symbols: boolean }
export const DEFAULT_PWGEN: PwGenOpts = { length: 20, lower: true, upper: true, digits: true, symbols: true };

const SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.<>?' };

function rand(max: number): number {
  const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % max;
}

export function generatePassword(opts: PwGenOpts): string {
  const classes = (['lower','upper','digits','symbols'] as const).filter(k => opts[k]).map(k => SETS[k]);
  if (classes.length === 0) throw new Error('no character class enabled');
  const all = classes.join('');
  const out: string[] = classes.map(c => c[rand(c.length)]); // guarantee one per class
  while (out.length < opts.length) out.push(all[rand(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, opts.length).join('');
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: password generator"`

---

### Task 4: URL matcher (registrable domain)

**Files:**
- Create: `src/background/matcher.ts`
- Test: `src/background/matcher.test.ts`

**Interfaces:**
- Produces: `function siteKey(url: string): string | null` (lowercased host, `www.` stripped) and `function urlMatches(entryUrl: string, pageUrl: string): boolean`. Used by `icon.ts` and `getEntriesForUrl`.

- [ ] **Step 1: Write failing tests**

```ts
import { siteKey, urlMatches } from './matcher';

test('siteKey strips scheme/path/www', () => {
  expect(siteKey('https://www.GitHub.com/login')).toBe('github.com');
});
test('siteKey null for invalid', () => { expect(siteKey('not a url')).toBeNull(); });
test('matches same host', () => {
  expect(urlMatches('https://github.com', 'https://github.com/login')).toBe(true);
});
test('matches subdomain of entry host', () => {
  expect(urlMatches('https://github.com', 'https://gist.github.com/x')).toBe(true);
});
test('no match different domain', () => {
  expect(urlMatches('https://github.com', 'https://gitlab.com')).toBe(false);
});
test('bare entry value (no scheme) still matches', () => {
  expect(urlMatches('github.com', 'https://github.com/login')).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

```ts
function parseHost(value: string): string | null {
  if (!value) return null;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  try { return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}
export function siteKey(url: string): string | null { return parseHost(url); }
export function urlMatches(entryUrl: string, pageUrl: string): boolean {
  const e = parseHost(entryUrl); const p = parseHost(pageUrl);
  if (!e || !p) return false;
  return p === e || p.endsWith(`.${e}`);
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: URL matcher"`

---

### Task 5: Argon2 crypto wiring + kdbx fixture

**Files:**
- Create: `src/background/crypto.ts`, `src/test/fixtures/make-fixture.mjs`, `src/test/fixtures/test.kdbx`
- Test: `src/background/crypto.test.ts`

**Interfaces:**
- Produces: `function registerArgon2(): void` (idempotent; calls `kdbxweb.CryptoEngine.setArgon2Impl`). The fixture `test.kdbx` opens with password `correct horse` and contains one group `Sites` with one entry: Title `GitHub`, UserName `octocat`, Password `s3cr3t`, URL `https://github.com`, plus a custom field `Token=abc123`.

- [ ] **Step 1: Write the fixture generator** (run once to create the binary fixture; checked in)

```js
// src/test/fixtures/make-fixture.mjs
import * as kdbxweb from 'kdbxweb';
import { argon2id } from 'hash-wasm';
import { writeFileSync } from 'node:fs';
kdbxweb.CryptoEngine.setArgon2Impl(async (pwd, salt, mem, iter, len, par, type, ver) => {
  const hash = await argon2id({ password: new Uint8Array(pwd), salt: new Uint8Array(salt),
    parallelism: par, iterations: iter, memorySize: mem, hashLength: len, outputType: 'binary' });
  return hash;
});
const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
const db = kdbxweb.Kdbx.create(creds, 'QuickKee Test');
const group = db.createGroup(db.getDefaultGroup(), 'Sites');
const e = db.createEntry(group);
e.fields.set('Title', 'GitHub'); e.fields.set('UserName', 'octocat');
e.fields.set('Password', kdbxweb.ProtectedValue.fromString('s3cr3t'));
e.fields.set('URL', 'https://github.com'); e.fields.set('Token', 'abc123');
const buf = await db.save();
writeFileSync(new URL('./test.kdbx', import.meta.url), Buffer.from(buf));
console.log('wrote test.kdbx');
```

Run: `node src/test/fixtures/make-fixture.mjs` → Expected: "wrote test.kdbx".

- [ ] **Step 2: Implement crypto.ts**

```ts
import * as kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';
let registered = false;
export function registerArgon2(): void {
  if (registered) return; registered = true;
  kdbxweb.CryptoEngine.setArgon2Impl(async (pwd, salt, mem, iter, len, par, type, ver) => {
    const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
    return fn({ password: new Uint8Array(pwd), salt: new Uint8Array(salt),
      parallelism: par, iterations: iter, memorySize: mem, hashLength: len, outputType: 'binary' });
  });
}
```

- [ ] **Step 3: Write failing test**

```ts
import * as kdbxweb from 'kdbxweb';
import { readFileSync } from 'node:fs';
import { registerArgon2 } from './crypto';

test('opens fixture with correct password', async () => {
  registerArgon2();
  const buf = readFileSync(new URL('../test/fixtures/test.kdbx', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
  const db = await kdbxweb.Kdbx.load(ab, creds);
  expect(db.meta.name).toBe('QuickKee Test');
});
test('rejects wrong password', async () => {
  registerArgon2();
  const buf = readFileSync(new URL('../test/fixtures/test.kdbx', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('wrong'));
  await expect(kdbxweb.Kdbx.load(ab, creds)).rejects.toBeTruthy();
});
```

- [ ] **Step 4: Run** — `npm test` → PASS (fixture opens; wrong pw rejects).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: argon2 wiring + test fixture"`

---

### Task 6: Vault module (open, read, edit, create, serialize)

**Files:**
- Create: `src/background/vault.ts`, `src/shared/entry.ts`
- Test: `src/background/vault.test.ts`

**Interfaces:**
- `src/shared/entry.ts` produces:
```ts
export interface EntryField { key: string; value: string; protected: boolean }
export interface EntryView { id: string; title: string; username: string; url: string;
  password: string; fields: EntryField[]; expired: boolean }
export interface TreeNode { groupId: string; name: string;
  entries: { id: string; title: string; username: string; url: string; expired: boolean }[];
  children: TreeNode[] }
```
- `vault.ts` produces a class `Vault` with: `open(bytes: ArrayBuffer, password: string|null, keyFile: ArrayBuffer|null): Promise<void>`, `isOpen(): boolean`, `lock(): void`, `getTree(): TreeNode`, `getEntry(id): EntryView | null`, `entriesForUrl(pageUrl): EntryView[]`, `createEntry(groupId, fields): string`, `updateEntry(id, fields): void`, `updateGroup(id, fields): void`, `serialize(): Promise<ArrayBuffer>`, `dirty: boolean`. (Uses `registerArgon2()` in `open`.)

- [ ] **Step 1: Write failing tests** (use the fixture)

```ts
import { readFileSync } from 'node:fs';
import { Vault } from './vault';
function fixture() { const b = readFileSync(new URL('../test/fixtures/test.kdbx', import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }

test('open + read entry by url', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const matches = v.entriesForUrl('https://github.com/login');
  expect(matches).toHaveLength(1);
  expect(matches[0].username).toBe('octocat');
  expect(matches[0].password).toBe('s3cr3t');
  expect(matches[0].fields.find(f => f.key === 'Token')?.value).toBe('abc123');
});
test('tree exposes group + entry', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const tree = v.getTree();
  const sites = tree.children.find(c => c.name === 'Sites');
  expect(sites?.entries[0].title).toBe('GitHub');
});
test('edit marks dirty and round-trips through serialize', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { UserName: 'newuser' });
  expect(v.dirty).toBe(true);
  const bytes = await v.serialize();
  const v2 = new Vault(); await v2.open(bytes, 'correct horse', null);
  expect(v2.getEntry(id)?.username).toBe('newuser');
});
test('create entry appears in url matches', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const root = v.getTree().groupId;
  const id = v.createEntry(root, { Title: 'Ex', URL: 'https://example.com', UserName: 'u', Password: 'p' });
  expect(v.getEntry(id)?.title).toBe('Ex');
  expect(v.entriesForUrl('https://example.com')[0].id).toBe(id);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement vault.ts**

```ts
import * as kdbxweb from 'kdbxweb';
import { registerArgon2 } from './crypto';
import { urlMatches } from './matcher';
import type { EntryView, EntryField, TreeNode } from '../shared/entry';

const STD = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
const str = (v: unknown): string =>
  v == null ? '' : v instanceof kdbxweb.ProtectedValue ? v.getText() : String(v);

export class Vault {
  private db: kdbxweb.Kdbx | null = null;
  dirty = false;

  async open(bytes: ArrayBuffer, password: string | null, keyFile: ArrayBuffer | null): Promise<void> {
    registerArgon2();
    const pv = password ? kdbxweb.ProtectedValue.fromString(password) : null;
    const creds = new kdbxweb.Credentials(pv, keyFile);
    this.db = await kdbxweb.Kdbx.load(bytes, creds);
    this.dirty = false;
  }
  isOpen() { return this.db !== null; }
  lock() { this.db = null; this.dirty = false; }

  private get root() { if (!this.db) throw new Error('locked'); return this.db.getDefaultGroup(); }
  private findEntry(id: string): kdbxweb.KdbxEntry | null {
    if (!this.db) return null;
    for (const g of this.allGroups(this.root)) for (const e of g.entries)
      if (e.uuid.id === id) return e;
    return null;
  }
  private findGroup(id: string): kdbxweb.KdbxGroup | null {
    for (const g of this.allGroups(this.root)) if (g.uuid.id === id) return g;
    return null;
  }
  private *allGroups(g: kdbxweb.KdbxGroup): Generator<kdbxweb.KdbxGroup> {
    yield g; for (const c of g.groups) yield* this.allGroups(c);
  }
  private toView(e: kdbxweb.KdbxEntry): EntryView {
    const fields: EntryField[] = [];
    e.fields.forEach((v, k) => { if (!STD.has(k)) fields.push({ key: k, value: str(v), protected: v instanceof kdbxweb.ProtectedValue }); });
    const exp = e.times.expires === true && e.times.expiryTime ? e.times.expiryTime.getTime() < Date.now() : false;
    return { id: e.uuid.id, title: str(e.fields.get('Title')), username: str(e.fields.get('UserName')),
      url: str(e.fields.get('URL')), password: str(e.fields.get('Password')), fields, expired: exp };
  }

  getEntry(id: string): EntryView | null { const e = this.findEntry(id); return e ? this.toView(e) : null; }
  entriesForUrl(pageUrl: string): EntryView[] {
    const out: EntryView[] = [];
    for (const g of this.allGroups(this.root)) for (const e of g.entries)
      if (urlMatches(str(e.fields.get('URL')), pageUrl)) out.push(this.toView(e));
    return out;
  }
  getTree(): TreeNode {
    const build = (g: kdbxweb.KdbxGroup): TreeNode => ({
      groupId: g.uuid.id, name: str(g.name),
      entries: g.entries.map(e => { const v = this.toView(e);
        return { id: v.id, title: v.title, username: v.username, url: v.url, expired: v.expired }; }),
      children: g.groups.map(build),
    });
    return build(this.root);
  }
  createEntry(groupId: string, fields: Record<string, string>): string {
    if (!this.db) throw new Error('locked');
    const g = this.findGroup(groupId) ?? this.root;
    const e = this.db.createEntry(g);
    this.applyFields(e, fields); this.dirty = true; return e.uuid.id;
  }
  updateEntry(id: string, fields: Record<string, string>): void {
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    this.applyFields(e, fields); e.times.update(); this.dirty = true;
  }
  updateGroup(id: string, fields: Record<string, string>): void {
    const g = this.findGroup(id); if (!g) throw new Error('no group');
    if (fields.Name != null) g.name = fields.Name; this.dirty = true;
  }
  private applyFields(e: kdbxweb.KdbxEntry, fields: Record<string, string>) {
    for (const [k, val] of Object.entries(fields)) {
      const prot = k === 'Password' || (e.fields.get(k) instanceof kdbxweb.ProtectedValue);
      e.fields.set(k, prot ? kdbxweb.ProtectedValue.fromString(val) : val);
    }
  }
  async serialize(): Promise<ArrayBuffer> {
    if (!this.db) throw new Error('locked');
    const buf = await this.db.save(); this.dirty = false; return buf;
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS (all four vault tests).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: vault module (open/read/edit/create/serialize)"`

---

## Phase 2 — Persistence & messaging

### Task 7: File handle persistence

**Files:**
- Create: `src/background/fileHandle.ts`
- Test: `src/background/fileHandle.test.ts`

**Interfaces:**
- Produces: `saveHandle(handle: FileSystemFileHandle): Promise<string>` (stores in IndexedDB `quickkee/handles`, returns id `"db"`), `loadHandle(): Promise<FileSystemFileHandle | null>`, `clearHandle(): Promise<void>`, `ensurePermission(h, mode: 'read'|'readwrite'): Promise<boolean>`, `readBytes(h): Promise<ArrayBuffer>`, `writeBytes(h, bytes): Promise<void>`.

- [ ] **Step 1: Write failing tests** (mock IndexedDB via `fake-indexeddb`)

```bash
npm install -D fake-indexeddb
```

```ts
import 'fake-indexeddb/auto';
import { saveHandle, loadHandle, clearHandle } from './fileHandle';

const fakeHandle = { name: 'db.kdbx', kind: 'file' } as unknown as FileSystemFileHandle;

test('round-trips a handle through IndexedDB', async () => {
  await saveHandle(fakeHandle);
  const got = await loadHandle();
  expect(got?.name).toBe('db.kdbx');
});
test('clear removes it', async () => {
  await saveHandle(fakeHandle); await clearHandle();
  expect(await loadHandle()).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

```ts
const DB = 'quickkee', STORE = 'handles', KEY = 'db';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(db => new Promise<T>((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }));
}
export async function saveHandle(h: FileSystemFileHandle): Promise<string> {
  await tx('readwrite', s => s.put(h, KEY)); return KEY;
}
export async function loadHandle(): Promise<FileSystemFileHandle | null> {
  return (await tx<FileSystemFileHandle | undefined>('readonly', s => s.get(KEY))) ?? null;
}
export async function clearHandle(): Promise<void> { await tx('readwrite', s => s.delete(KEY)); }

export async function ensurePermission(h: FileSystemFileHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  const opts = { mode } as FileSystemHandlePermissionDescriptor;
  // @ts-expect-error: queryPermission is experimental
  if ((await h.queryPermission(opts)) === 'granted') return true;
  // @ts-expect-error: requestPermission is experimental
  return (await h.requestPermission(opts)) === 'granted';
}
export async function readBytes(h: FileSystemFileHandle): Promise<ArrayBuffer> {
  const file = await h.getFile(); return file.arrayBuffer();
}
export async function writeBytes(h: FileSystemFileHandle, bytes: ArrayBuffer): Promise<void> {
  const w = await h.createWritable(); await w.write(bytes); await w.close();
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: IndexedDB file-handle persistence"`

---

### Task 8: Message contract

**Files:**
- Create: `src/shared/messages.ts`
- Test: `src/shared/messages.test.ts`

**Interfaces:**
- Produces a discriminated union `Request` and `Response`, plus `function sendToSW<T extends Request>(req: T): Promise<ResponseFor<T>>` (wraps `chrome.runtime.sendMessage`). Request types: `unlock`, `lock`, `getStatus`, `getEntriesForUrl`, `getEntry`, `getTree`, `createEntry`, `updateEntry`, `updateGroup`, `save`, `generatePassword`, `fillRequest`. (Unlock carries `password: string | null` and `keyFile: number[] | null` — keyfile bytes as a transferable array; handle already persisted.)

- [ ] **Step 1: Write failing test** (type-shape + helper behavior with a mocked chrome)

```ts
import { sendToSW } from './messages';
test('sendToSW forwards to chrome.runtime.sendMessage', async () => {
  const calls: any[] = [];
  (globalThis as any).chrome = { runtime: { sendMessage: (m: any) => { calls.push(m); return Promise.resolve({ ok: true }); } } };
  const res = await sendToSW({ type: 'lock' });
  expect(calls[0]).toEqual({ type: 'lock' });
  expect(res).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { EntryView, TreeNode } from './entry';
import type { PwGenOpts } from './pwgen';

export type Request =
  | { type: 'unlock'; password: string | null; keyFile: number[] | null }
  | { type: 'lock' }
  | { type: 'getStatus' }
  | { type: 'getEntriesForUrl'; url: string }
  | { type: 'getEntry'; entryId: string }
  | { type: 'getTree' }
  | { type: 'createEntry'; groupId: string; fields: Record<string, string> }
  | { type: 'updateEntry'; entryId: string; fields: Record<string, string> }
  | { type: 'updateGroup'; groupId: string; fields: Record<string, string> }
  | { type: 'save' }
  | { type: 'generatePassword'; opts?: PwGenOpts }
  | { type: 'fillRequest'; entryId: string; tabId: number };

export type Ok<T = {}> = { ok: true } & T;
export type Err = { ok: false; error: string };
export type Response =
  | Ok | Err
  | Ok<{ locked: boolean; dbName?: string; dirty: boolean }>
  | Ok<{ entries: EntryView[] }>
  | Ok<{ entry: EntryView | null }>
  | Ok<{ tree: TreeNode }>
  | Ok<{ entryId: string }>
  | Ok<{ password: string }>;

export function sendToSW(req: Request): Promise<Response> {
  return chrome.runtime.sendMessage(req) as Promise<Response>;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: typed SW message contract"`

---

### Task 9: Settings module

**Files:**
- Create: `src/shared/settings.ts`
- Test: `src/shared/settings.test.ts`

**Interfaces:**
- Produces: `interface Settings { autoCloseHours: number; clipboardClearSeconds: number; pwgen: PwGenOpts; theme: 'dark'|'light' }`, `DEFAULT_SETTINGS`, `loadSettings(): Promise<Settings>`, `saveSettings(s: Settings): Promise<void>` (uses `chrome.storage.local`, key `settings`). Non-secret only.

- [ ] **Step 1: Write failing test** (mock `chrome.storage.local`)

```ts
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';
beforeEach(() => {
  let store: any = {};
  (globalThis as any).chrome = { storage: { local: {
    get: (k: string) => Promise.resolve({ [k]: store[k] }),
    set: (o: any) => { Object.assign(store, o); return Promise.resolve(); } } } };
});
test('returns defaults when empty', async () => {
  expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
});
test('persists and merges', async () => {
  await saveSettings({ ...DEFAULT_SETTINGS, autoCloseHours: 4 });
  expect((await loadSettings()).autoCloseHours).toBe(4);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { DEFAULT_PWGEN, type PwGenOpts } from './pwgen';
export interface Settings { autoCloseHours: number; clipboardClearSeconds: number; pwgen: PwGenOpts; theme: 'dark' | 'light' }
export const DEFAULT_SETTINGS: Settings = { autoCloseHours: 8, clipboardClearSeconds: 30, pwgen: DEFAULT_PWGEN, theme: 'light' };
export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) };
}
export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: settings storage"`

---

## Phase 3 — Service worker integration

### Task 10: SW message router + keepalive + autolock

**Files:**
- Create: `src/background/index.ts`, `src/background/autolock.ts`
- Test: `src/background/autolock.test.ts`

**Interfaces:**
- `autolock.ts` produces: `class AutoLock { constructor(onLock: () => void); arm(hours: number): void; disarm(): void; touch(): void }` (uses `setTimeout`; resets on `touch`).
- `index.ts` wires: a single `Vault` instance, `chrome.runtime.onMessage` router handling every `Request`, a keepalive port + `chrome.alarms` heartbeat, `chrome.runtime.onSuspend`/startup to lock, and `AutoLock` armed from settings on unlock. Holds the active `FileSystemFileHandle` in memory after unlock.

- [ ] **Step 1: Write failing test for AutoLock** (fake timers)

```ts
import { AutoLock } from './autolock';
test('fires after the armed window', () => {
  vi.useFakeTimers(); let locked = false;
  const a = new AutoLock(() => { locked = true; });
  a.arm(1); // 1 hour
  vi.advanceTimersByTime(60 * 60 * 1000 - 1); expect(locked).toBe(false);
  vi.advanceTimersByTime(2); expect(locked).toBe(true);
  vi.useRealTimers();
});
test('touch resets the window', () => {
  vi.useFakeTimers(); let locked = false;
  const a = new AutoLock(() => { locked = true; });
  a.arm(1); vi.advanceTimersByTime(50 * 60 * 1000); a.touch();
  vi.advanceTimersByTime(50 * 60 * 1000); expect(locked).toBe(false);
  vi.advanceTimersByTime(11 * 60 * 1000); expect(locked).toBe(true);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement autolock.ts**

```ts
export class AutoLock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hours = 0;
  constructor(private onLock: () => void) {}
  arm(hours: number) { this.hours = hours; this.schedule(); }
  touch() { if (this.timer) this.schedule(); }
  disarm() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.onLock(); }, this.hours * 3600 * 1000);
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Implement index.ts (router)** — no unit test; integration-verified in Step 6.

```ts
import { Vault } from './vault';
import { AutoLock } from './autolock';
import { loadHandle, ensurePermission, readBytes, writeBytes } from './fileHandle';
import { loadSettings } from '../shared/settings';
import { generatePassword, DEFAULT_PWGEN } from '../shared/pwgen';
import { updateIconForTab } from './icon';
import type { Request, Response } from '../shared/messages';

const vault = new Vault();
let handle: FileSystemFileHandle | null = null;
const autolock = new AutoLock(() => doLock());

function doLock() { vault.lock(); handle = null; autolock.disarm(); refreshAllIcons(); }

async function handle_(req: Request): Promise<Response> {
  autolock.touch();
  switch (req.type) {
    case 'unlock': {
      handle = await loadHandle();
      if (!handle) return { ok: false, error: 'noFile' };
      if (!(await ensurePermission(handle, 'readwrite'))) return { ok: false, error: 'permission' };
      try {
        const bytes = await readBytes(handle);
        const keyFile = req.keyFile ? new Uint8Array(req.keyFile).buffer : null;
        await vault.open(bytes, req.password, keyFile);
      } catch { return { ok: false, error: 'badCredentials' }; }
      const s = await loadSettings(); autolock.arm(s.autoCloseHours); refreshAllIcons();
      return { ok: true };
    }
    case 'lock': doLock(); return { ok: true };
    case 'getStatus':
      return { ok: true, locked: !vault.isOpen(), dbName: handle?.name, dirty: vault.dirty };
    case 'getEntriesForUrl':
      return vault.isOpen() ? { ok: true, entries: vault.entriesForUrl(req.url) } : { ok: false, error: 'locked' };
    case 'getEntry':
      return { ok: true, entry: vault.getEntry(req.entryId) };
    case 'getTree':
      return vault.isOpen() ? { ok: true, tree: vault.getTree() } : { ok: false, error: 'locked' };
    case 'createEntry':
      return { ok: true, entryId: vault.createEntry(req.groupId, req.fields) };
    case 'updateEntry': vault.updateEntry(req.entryId, req.fields); return { ok: true };
    case 'updateGroup': vault.updateGroup(req.groupId, req.fields); return { ok: true };
    case 'save': {
      if (!handle) return { ok: false, error: 'noFile' };
      try { const bytes = await vault.serialize(); await writeBytes(handle, bytes); return { ok: true }; }
      catch (e) { return { ok: false, error: 'saveFailed' }; }
    }
    case 'generatePassword':
      return { ok: true, password: generatePassword(req.opts ?? DEFAULT_PWGEN) };
    case 'fillRequest': {
      const entry = vault.getEntry(req.entryId);
      if (!entry) return { ok: false, error: 'noEntry' };
      await chrome.tabs.sendMessage(req.tabId, { type: 'fill', username: entry.username, password: entry.password });
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((req: Request, _s, sendResponse) => {
  handle_(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // async
});

// keepalive: alarm heartbeat keeps the SW from idling out while unlocked
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => { if (vault.isOpen()) void chrome.runtime.getPlatformInfo(); });

// lock on browser close / SW suspend
chrome.runtime.onSuspend.addListener(doLock);
chrome.runtime.onStartup.addListener(doLock);

// per-tab icon
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) void updateIconForTab(tabId, tab.url, vault);
});
async function refreshAllIcons() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id && t.url) void updateIconForTab(t.id, t.url, vault);
}

// open side panel on action click is configured in panel task
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
```

- [ ] **Step 6: Build + manual integration check**

Run: `npm run build:chrome`, reload extension. Open the SW console (`chrome://extensions` → service worker). Expected: no load errors; `chrome.runtime.sendMessage({type:'getStatus'})` from the console returns `{ok:true, locked:true}`.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: SW message router + autolock + keepalive"`

---

### Task 11: Icon module (per-tab color + badge)

**Files:**
- Create: `src/background/icon.ts`
- Test: `src/background/icon.test.ts`

**Interfaces:**
- Produces: `updateIconForTab(tabId: number, url: string, vault: Pick<Vault, 'isOpen'|'entriesForUrl'>): Promise<void>` — sets badge text to the match count and badge background color (green when matches, gray when none/locked) via `chrome.action`.

- [ ] **Step 1: Write failing test** (mock `chrome.action`)

```ts
import { updateIconForTab } from './icon';
test('sets count + green when matches exist', async () => {
  const calls: any = {};
  (globalThis as any).chrome = { action: {
    setBadgeText: (a: any) => { calls.text = a; return Promise.resolve(); },
    setBadgeBackgroundColor: (a: any) => { calls.color = a; return Promise.resolve(); } } };
  const vault = { isOpen: () => true, entriesForUrl: () => [{}, {}] } as any;
  await updateIconForTab(7, 'https://github.com', vault);
  expect(calls.text).toEqual({ tabId: 7, text: '2' });
  expect(calls.color.color).toBe('#16a34a');
});
test('clears badge when locked', async () => {
  const calls: any = {};
  (globalThis as any).chrome = { action: {
    setBadgeText: (a: any) => { calls.text = a; return Promise.resolve(); },
    setBadgeBackgroundColor: () => Promise.resolve() } };
  const vault = { isOpen: () => false, entriesForUrl: () => [] } as any;
  await updateIconForTab(7, 'https://x.com', vault);
  expect(calls.text).toEqual({ tabId: 7, text: '' });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Vault } from './vault';
export async function updateIconForTab(
  tabId: number, url: string, vault: Pick<Vault, 'isOpen' | 'entriesForUrl'>,
): Promise<void> {
  const count = vault.isOpen() ? vault.entriesForUrl(url).length : 0;
  await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: count > 0 ? '#16a34a' : '#6b7280' });
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: per-tab icon badge"`

---

### Task 12: Content script (field detection + fill)

**Files:**
- Create: `src/content/index.ts`, `src/content/detect.ts`
- Test: `src/content/detect.test.ts`

**Interfaces:**
- `detect.ts` produces: `findLoginFields(doc: Document): { username: HTMLInputElement | null; password: HTMLInputElement | null }` and `fillFields(fields, username, password): void` (sets value + dispatches `input`/`change`). `index.ts` listens for `{type:'fill', username, password}` and calls them; reports `hasLoginForm` on load (optional for MVP icon — SW uses URL match, so this is just fill).

- [ ] **Step 1: Write failing tests** (jsdom)

```ts
import { findLoginFields, fillFields } from './detect';
test('finds password input and preceding text/email field', () => {
  document.body.innerHTML = `<form>
    <input type="email" id="u"><input type="password" id="p"></form>`;
  const f = findLoginFields(document);
  expect(f.password?.id).toBe('p'); expect(f.username?.id).toBe('u');
});
test('fillFields sets values and fires input events', () => {
  document.body.innerHTML = `<input type="text" id="u"><input type="password" id="p">`;
  const f = { username: document.getElementById('u') as HTMLInputElement,
              password: document.getElementById('p') as HTMLInputElement };
  let fired = false; f.username.addEventListener('input', () => { fired = true; });
  fillFields(f, 'octocat', 's3cr3t');
  expect(f.username.value).toBe('octocat'); expect(f.password.value).toBe('s3cr3t');
  expect(fired).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement detect.ts**

```ts
export interface LoginFields { username: HTMLInputElement | null; password: HTMLInputElement | null }
export function findLoginFields(doc: Document): LoginFields {
  const password = doc.querySelector<HTMLInputElement>('input[type="password"]');
  let username: HTMLInputElement | null = null;
  if (password) {
    const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input'));
    const pwIdx = inputs.indexOf(password);
    for (let i = pwIdx - 1; i >= 0; i--) {
      const t = (inputs[i].type || 'text').toLowerCase();
      if (t === 'text' || t === 'email' || t === 'tel') { username = inputs[i]; break; }
    }
    if (!username) username = doc.querySelector('input[autocomplete="username"], input[name*="user" i], input[name*="email" i]');
  }
  return { username, password };
}
export function fillFields(f: LoginFields, username: string, password: string): void {
  const set = (el: HTMLInputElement | null, val: string) => {
    if (!el) return; el.focus(); el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(f.username, username); set(f.password, password);
}
```

- [ ] **Step 4: Implement index.ts**

```ts
import { findLoginFields, fillFields } from './detect';
chrome.runtime.onMessage.addListener((msg: { type: string; username?: string; password?: string }) => {
  if (msg.type === 'fill') fillFields(findLoginFields(document), msg.username ?? '', msg.password ?? '');
});
```

- [ ] **Step 5: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: content-script field detection + fill"`

---

## Phase 4 — UI

> UI tasks extract logic into the already-tested modules. Each ends with a manual verification checklist (MV3 React shells are validated by loading the unpacked build).

### Task 13: Shared UI hooks + clipboard + theme

**Files:**
- Create: `src/shared/clipboard.ts`, `src/shared/theme.ts`, `src/shared/useStatus.ts`
- Test: `src/shared/clipboard.test.ts`

**Interfaces:**
- `clipboard.ts` produces: `copyWithClear(text: string, clearSeconds: number): Promise<void>` (writes clipboard, schedules a clear that only wipes if clipboard still equals `text`).
- `theme.ts` produces: `applyTheme(theme: 'dark'|'light'): void` (toggles `document.documentElement.classList`).
- `useStatus.ts` produces: `useStatus()` React hook returning `{locked, dbName, dirty, refresh}` via `sendToSW({type:'getStatus'})`.

- [ ] **Step 1: Write failing clipboard test** (fake timers + mocked navigator.clipboard)

```ts
import { copyWithClear } from './clipboard';
test('clears clipboard after delay when unchanged', async () => {
  vi.useFakeTimers();
  let buf = '';
  (globalThis as any).navigator = { clipboard: {
    writeText: (t: string) => { buf = t; return Promise.resolve(); },
    readText: () => Promise.resolve(buf) } };
  await copyWithClear('secret', 30);
  expect(buf).toBe('secret');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(buf).toBe('');
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement clipboard.ts**

```ts
export async function copyWithClear(text: string, clearSeconds: number): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (clearSeconds > 0) setTimeout(async () => {
    try { if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText(''); }
    catch { /* clipboard may be unavailable when unfocused; ignore */ }
  }, clearSeconds * 1000);
}
```

- [ ] **Step 4: Implement theme.ts + useStatus.ts**

```ts
// theme.ts
export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
```
```ts
// useStatus.ts
import { useEffect, useState, useCallback } from 'react';
import { sendToSW } from './messages';
export function useStatus() {
  const [s, setS] = useState({ locked: true, dbName: undefined as string | undefined, dirty: false });
  const refresh = useCallback(async () => {
    const r = await sendToSW({ type: 'getStatus' });
    if ('locked' in r) setS({ locked: r.locked, dbName: r.dbName, dirty: r.dirty });
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { ...s, refresh };
}
```

- [ ] **Step 5: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: clipboard auto-clear, theme, status hook"`

---

### Task 14: Unlock UI + file picker (shared component)

**Files:**
- Create: `src/shared/UnlockScreen.tsx`, `src/shared/pickFile.ts`

**Interfaces:**
- `pickFile.ts` produces: `pickAndStoreDb(): Promise<string>` (calls `showOpenFilePicker` for `.kdbx`, `saveHandle`, returns name) and `readKeyFile(): Promise<number[]>` (picks a key file, returns bytes as `number[]` for messaging).
- `UnlockScreen.tsx` produces: `<UnlockScreen onUnlocked={() => void} />` — file-pick button (shows stored db name), "use key file" toggle, password field, validation (≥1 factor), calls `sendToSW({type:'unlock', ...})`, shows `badCredentials`/`permission`/`noFile` errors.

- [ ] **Step 1: Implement pickFile.ts**

```ts
import { saveHandle } from '../background/fileHandle';
export async function pickAndStoreDb(): Promise<string> {
  // @ts-expect-error experimental
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'KeePass', accept: { 'application/octet-stream': ['.kdbx'] } }] });
  await saveHandle(handle); return handle.name;
}
export async function readKeyFile(): Promise<number[]> {
  // @ts-expect-error experimental
  const [h] = await window.showOpenFilePicker();
  const buf = await (await h.getFile()).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}
```

- [ ] **Step 2: Implement UnlockScreen.tsx**

```tsx
import { useState } from 'react';
import { sendToSW } from './messages';
import { pickAndStoreDb, readKeyFile } from './pickFile';
import { loadHandle } from '../background/fileHandle';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [dbName, setDbName] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [keyFile, setKeyFile] = useState<number[] | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  useState(() => { void loadHandle().then(h => setDbName(h?.name ?? null)); });

  const canUnlock = (pwd.length > 0) || (useKey && keyFile);
  async function unlock() {
    setErr('');
    const r = await sendToSW({ type: 'unlock', password: pwd || null, keyFile: useKey ? keyFile : null });
    if (r.ok) onUnlocked();
    else setErr({ badCredentials: 'Wrong password or key file', permission: 'Grant file access to continue',
      noFile: 'Pick a database file first' }[r.error as string] ?? r.error);
  }
  return (
    <div className="p-4 space-y-3">
      <button className="btn" onClick={async () => setDbName(await pickAndStoreDb())}>
        {dbName ? `Database: ${dbName}` : 'Open .kdbx file…'}
      </button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={useKey} onChange={e => setUseKey(e.target.checked)} /> Use key file
      </label>
      {useKey && <button className="btn" onClick={async () => setKeyFile(await readKeyFile())}>
        {keyFile ? 'Key file selected' : 'Choose key file…'}</button>}
      <input type="password" className="input" placeholder="Master password" value={pwd}
        onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && canUnlock && unlock()} />
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <button className="btn-primary" disabled={!canUnlock || !dbName} onClick={unlock}>Unlock</button>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Build, reload, open popup with no DB. Expected: "Open .kdbx file…" → picker → select fixture → name shows → enter `correct horse` → Unlock → no error (proceeds to onUnlocked). Wrong password → "Wrong password or key file".

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: unlock screen + file picker"`

---

### Task 15: Popup (browse / copy / autofill / create)

**Files:**
- Create/Modify: `src/pages/popup/Popup.tsx` (and its entry), `src/pages/popup/EntryCard.tsx`, `src/pages/popup/CreateForm.tsx`

**Interfaces:**
- Consumes: `useStatus`, `UnlockScreen`, `sendToSW`, `copyWithClear`, `EntryView`.
- Renders: if locked → `<UnlockScreen>`. If unlocked → quick search box (filters `getEntriesForUrl` results by title/username), `EntryCard` per match (username, copy-username, copy-password, collapsible additional fields each with copy, autofill button, expired badge). If zero matches → search + `CreateForm` (URL prefilled to active tab, password prefilled from `generatePassword`).

- [ ] **Step 1: Implement EntryCard.tsx**

```tsx
import { useState } from 'react';
import type { EntryView } from '../../shared/entry';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';

export function EntryCard({ entry, tabId, clearSecs }: { entry: EntryView; tabId: number; clearSecs: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded p-2 mb-2">
      <div className="flex justify-between items-center">
        <div><div className="font-medium">{entry.title}</div>
          <div className="text-sm opacity-70">{entry.username}</div></div>
        {entry.expired && <span className="text-xs text-red-600 border border-red-600 px-1 rounded">EXPIRED</span>}
      </div>
      <div className="flex gap-1 mt-1">
        <button className="btn-xs" onClick={() => copyWithClear(entry.username, clearSecs)}>Copy user</button>
        <button className="btn-xs" onClick={() => copyWithClear(entry.password, clearSecs)}>Copy pass</button>
        <button className="btn-xs" onClick={() => sendToSW({ type: 'fillRequest', entryId: entry.id, tabId })}>Autofill</button>
        <button className="btn-xs" onClick={() => setOpen(o => !o)}>{open ? '▲' : '▼'} Fields</button>
      </div>
      {open && <div className="mt-2 space-y-1">
        {entry.fields.map(f => (
          <div key={f.key} className="flex justify-between text-sm">
            <span className="opacity-70">{f.key}</span>
            <button className="btn-xs" onClick={() => copyWithClear(f.value, clearSecs)}>Copy</button>
          </div>))}
      </div>}
    </div>
  );
}
```

- [ ] **Step 2: Implement CreateForm.tsx**

```tsx
import { useEffect, useState } from 'react';
import { sendToSW } from '../../shared/messages';

export function CreateForm({ url, groupId, onCreated }: { url: string; groupId: string; onCreated: () => void }) {
  const [title, setTitle] = useState(''); const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => { sendToSW({ type: 'generatePassword' }).then(r => 'password' in r && setPassword(r.password)); }, []);
  async function create() {
    await sendToSW({ type: 'createEntry', groupId, fields: { Title: title, UserName: username, Password: password, URL: url } });
    await sendToSW({ type: 'save' }); onCreated();
  }
  return (
    <div className="p-2 border-t mt-2 space-y-2">
      <p className="text-sm font-medium">New entry for {url}</p>
      <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
      <input className="input" value={password} onChange={e => setPassword(e.target.value)} />
      <button className="btn-primary" disabled={!title} onClick={create}>Create & Save</button>
    </div>
  );
}
```

- [ ] **Step 3: Implement Popup.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { EntryView } from '../../shared/entry';
import { EntryCard } from './EntryCard';
import { CreateForm } from './CreateForm';

export function Popup() {
  const { locked, refresh } = useStatus();
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [q, setQ] = useState(''); const [tab, setTab] = useState<{ id: number; url: string } | null>(null);
  const [rootGroup, setRootGroup] = useState(''); const [clearSecs, setClearSecs] = useState(30);

  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); }); }, []);
  useEffect(() => { chrome.tabs.query({ active: true, currentWindow: true })
    .then(([t]) => t?.id && t.url && setTab({ id: t.id, url: t.url })); }, []);
  useEffect(() => { if (locked || !tab) return;
    sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries));
    sendToSW({ type: 'getTree' }).then(r => 'tree' in r && setRootGroup(r.tree.groupId));
  }, [locked, tab]);

  if (locked) return <div className="w-80"><UnlockScreen onUnlocked={refresh} /></div>;
  const shown = entries.filter(e => (e.title + e.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="w-80 p-3">
      <input className="input mb-2" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
      {shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} clearSecs={clearSecs} />)}
      {entries.length === 0 && tab && rootGroup &&
        <CreateForm url={tab.url} groupId={rootGroup} onCreated={() =>
          sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries))} />}
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

Build, reload. Visit `github.com`, open popup with vault unlocked. Expected: one EntryCard `octocat`; Copy pass copies `s3cr3t`; expand shows `Token` with Copy; Autofill fills the page login form. Visit a site with no entry → search + CreateForm with generated password + URL prefilled; Create & Save writes the file.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: popup browse/copy/autofill/create"`

---

### Task 16: Side panel (full tree browse + edit) with explicit Save

**Files:**
- Create/Modify: `src/pages/panel/Panel.tsx`, `src/pages/panel/EntryEditor.tsx`

**Interfaces:**
- Consumes: `useStatus`, `UnlockScreen`, `sendToSW`, `getTree`, `getEntry`, `updateEntry`, `updateGroup`, `save`, `copyWithClear`.
- Renders: locked → `<UnlockScreen>`. Unlocked → left tree (groups + entries, expired marked), right `EntryEditor` for the selected entry (edit title/username/password/url + additional fields, copy buttons), a header Save button enabled when `dirty` with an unsaved indicator.

- [ ] **Step 1: Implement EntryEditor.tsx**

```tsx
import { useEffect, useState } from 'react';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';
import type { EntryView } from '../../shared/entry';

export function EntryEditor({ entryId, clearSecs, onChanged }: { entryId: string; clearSecs: number; onChanged: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  useEffect(() => { sendToSW({ type: 'getEntry', entryId }).then(r => 'entry' in r && setE(r.entry)); }, [entryId]);
  if (!e) return null;
  const field = (label: string, key: 'title' | 'username' | 'url' | 'password') => (
    <div className="flex gap-2 items-center my-1">
      <label className="w-20 text-sm">{label}</label>
      <input className="input flex-1" value={e[key]} onChange={ev => setE({ ...e, [key]: ev.target.value })} />
      <button className="btn-xs" onClick={() => copyWithClear(e[key], clearSecs)}>Copy</button>
    </div>);
  async function save() {
    await sendToSW({ type: 'updateEntry', entryId,
      fields: { Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password } });
    onChanged();
  }
  return (<div className="p-3">
    {field('Title', 'title')}{field('Username', 'username')}
    {field('Password', 'password')}{field('URL', 'url')}
    {e.fields.map(f => (
      <div key={f.key} className="flex gap-2 items-center my-1">
        <label className="w-20 text-sm">{f.key}</label>
        <span className="flex-1 text-sm">{f.value}</span>
        <button className="btn-xs" onClick={() => copyWithClear(f.value, clearSecs)}>Copy</button>
      </div>))}
    <button className="btn-primary mt-2" onClick={save}>Apply changes</button>
  </div>);
}
```

- [ ] **Step 2: Implement Panel.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { TreeNode } from '../../shared/entry';
import { EntryEditor } from './EntryEditor';

function TreeView({ node, onPick }: { node: TreeNode; onPick: (id: string) => void }) {
  return (<div className="ml-2">
    <div className="font-medium text-sm mt-1">{node.name}</div>
    {node.entries.map(e => (
      <button key={e.id} className="block text-left text-sm hover:underline" onClick={() => onPick(e.id)}>
        {e.title} {e.expired && <span className="text-red-600">(expired)</span>}
      </button>))}
    {node.children.map(c => <TreeView key={c.groupId} node={c} onPick={onPick} />)}
  </div>);
}

export function Panel() {
  const { locked, dirty, refresh } = useStatus();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [clearSecs, setClearSecs] = useState(30); const [saved, setSaved] = useState('');
  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); }); }, []);
  const reload = () => sendToSW({ type: 'getTree' }).then(r => 'tree' in r && setTree(r.tree));
  useEffect(() => { if (!locked) reload(); }, [locked]);
  if (locked) return <UnlockScreen onUnlocked={refresh} />;
  async function save() { const r = await sendToSW({ type: 'save' });
    setSaved(r.ok ? 'Saved' : 'Save failed'); refresh(); setTimeout(() => setSaved(''), 2000); }
  return (
    <div className="flex h-screen">
      <div className="w-1/2 overflow-auto border-r">
        <div className="p-2 flex justify-between items-center border-b">
          <span className="font-semibold">QuickKee</span>
          <button className="btn-primary" disabled={!dirty} onClick={save}>
            {dirty ? 'Save *' : 'Saved'} {saved && `· ${saved}`}</button>
        </div>
        {tree && <TreeView node={tree} onPick={setSel} />}
      </div>
      <div className="w-1/2 overflow-auto">
        {sel && <EntryEditor entryId={sel} clearSecs={clearSecs} onChanged={() => { refresh(); reload(); }} />}
      </div>
    </div>);
}
```

- [ ] **Step 3: Manual verification**

Build, reload, open side panel. Expected: tree shows `Sites › GitHub`; pick it → editor populates; change username → Apply → Save button shows `Save *` (dirty) → Save → file written, button returns to `Saved`. Reopen file in KeePassXC to confirm the change persisted.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: side panel browse + edit + explicit save"`

---

### Task 17: Options page (settings)

**Files:**
- Create/Modify: `src/pages/options/Options.tsx`

**Interfaces:**
- Consumes: `loadSettings`, `saveSettings`, `applyTheme`, `Settings`.
- Renders: auto-close-hours `<select>` (1/2/4/8/24), clipboard-clear-seconds select (0/15/30/60), password-generator opts (length number + class checkboxes), theme toggle. Saves on change.

- [ ] **Step 1: Implement Options.tsx**

```tsx
import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';

export function Options() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => { loadSettings().then(v => { setS(v); applyTheme(v.theme); }); }, []);
  const update = (patch: Partial<Settings>) => { const next = { ...s, ...patch };
    setS(next); applyTheme(next.theme); void saveSettings(next); };
  return (
    <div className="p-6 max-w-md space-y-4">
      <h1 className="text-lg font-semibold">QuickKee Settings</h1>
      <label className="block">Auto-close after
        <select className="input" value={s.autoCloseHours}
          onChange={e => update({ autoCloseHours: Number(e.target.value) })}>
          {[1, 2, 4, 8, 24].map(h => <option key={h} value={h}>{h} hour(s)</option>)}
        </select></label>
      <label className="block">Clipboard auto-clear
        <select className="input" value={s.clipboardClearSeconds}
          onChange={e => update({ clipboardClearSeconds: Number(e.target.value) })}>
          {[0, 15, 30, 60].map(x => <option key={x} value={x}>{x === 0 ? 'never' : `${x}s`}</option>)}
        </select></label>
      <fieldset className="border p-2"><legend>Default generated password</legend>
        <label>Length <input type="number" className="input w-20" value={s.pwgen.length}
          onChange={e => update({ pwgen: { ...s.pwgen, length: Number(e.target.value) } })} /></label>
        {(['lower', 'upper', 'digits', 'symbols'] as const).map(k => (
          <label key={k} className="flex gap-2"><input type="checkbox" checked={s.pwgen[k]}
            onChange={e => update({ pwgen: { ...s.pwgen, [k]: e.target.checked } })} /> {k}</label>))}
      </fieldset>
      <label className="flex gap-2"><input type="checkbox" checked={s.theme === 'dark'}
        onChange={e => update({ theme: e.target.checked ? 'dark' : 'light' })} /> Dark theme</label>
    </div>);
}
```

- [ ] **Step 2: Manual verification**

Build, reload, open options. Change auto-close to 1h, toggle dark theme → popup/panel reflect dark theme; reopen options → values persisted.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: options/settings page"`

---

## Phase 5 — Security feature

### Task 18: Bad-certificate navigation warning

**Files:**
- Modify: `src/background/index.ts`
- Create: `src/background/certwarn.ts`
- Test: `src/background/certwarn.test.ts`

**Interfaces:**
- Produces: `shouldWarnCertError(details: { error?: string }): boolean` (true when the navigation error string indicates a certificate failure). Wired to `chrome.webNavigation.onErrorOccurred` to set a red `!` badge + title on the failing tab.

- [ ] **Step 1: Write failing test**

```ts
import { shouldWarnCertError } from './certwarn';
test('flags cert errors', () => {
  expect(shouldWarnCertError({ error: 'net::ERR_CERT_DATE_INVALID' })).toBe(true);
  expect(shouldWarnCertError({ error: 'net::ERR_CERT_AUTHORITY_INVALID' })).toBe(true);
});
test('ignores non-cert errors', () => {
  expect(shouldWarnCertError({ error: 'net::ERR_ABORTED' })).toBe(false);
  expect(shouldWarnCertError({})).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement certwarn.ts**

```ts
export function shouldWarnCertError(details: { error?: string }): boolean {
  return !!details.error && /ERR_CERT|SSL|ERR_SSL/i.test(details.error);
}
```

- [ ] **Step 4: Wire into index.ts**

```ts
import { shouldWarnCertError } from './certwarn';
chrome.webNavigation.onErrorOccurred.addListener(details => {
  if (details.frameId !== 0 || !shouldWarnCertError(details)) return;
  void chrome.action.setBadgeText({ tabId: details.tabId, text: '!' });
  void chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#dc2626' });
  void chrome.action.setTitle({ tabId: details.tabId, title: 'Warning: certificate error on this site' });
});
```

- [ ] **Step 5: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: bad-certificate navigation warning"`

---

## Phase 6 — Final verification

### Task 19: Full-flow smoke test + README

**Files:**
- Create: `README.md` (load/use instructions)

- [ ] **Step 1: Run the whole suite** — `npm test` → Expected: all tests PASS.
- [ ] **Step 2: Production build** — `npm run build:chrome` → Expected: clean `dist_chrome/`.
- [ ] **Step 3: Manual end-to-end** — load unpacked, and verify in order:
  1. First run: popup prompts to open `.kdbx`; pick a real database; unlock with password (and key file if used).
  2. Visit a saved site → badge shows count + green; popup lists entries; copy + autofill work.
  3. Visit unsaved site → create form; create + save; revisit → entry appears.
  4. Side panel: browse tree, edit an entry, Save; confirm persisted by reopening in KeePassXC.
  5. Options: change auto-close + theme; confirm applied + persisted.
  6. Wait past auto-close (set to 1h, or temporarily shorten) → vault locks.
  7. Visit an HTTPS site with a bad cert → red `!` badge.
- [ ] **Step 4: Write README** documenting build, load-unpacked, and the local-only MVP scope (cloud sync = Spec 2).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: README + MVP smoke checklist"`

---

## Self-Review (spec coverage map)

| Spec requirement | Task |
|---|---|
| Open local .kdbx (FSA + handle) | 7, 14 |
| Unlock: password / keyfile / both | 6, 14 |
| Entry browser — popup | 15 |
| Entry browser — sidebar tree | 16 |
| Edit entries & groups (sidebar) | 6, 16 |
| Additional fields + copy | 6, 15, 16 |
| Create entry from popup (no-entry site) | 15 |
| Auto-generated default password | 3, 15, 17 |
| Autofill login forms (user/pwd detection) | 12, 15 |
| Icon color + count per site | 11 |
| Auto-close after X hours | 9, 10 |
| Clipboard copy + auto-clear | 13, 15, 16 |
| Bad-certificate warning | 18 |
| Dark/light themes | 13, 17 |
| Search (name/URL) | 15 |
| Expired entries marked | 6, 15, 16 |
| Explicit Save + dirty indicator | 10, 16 |
| Settings (auto-close, default pwgen, theme) | 17 |
| Deferred: cloud (Dropbox/GDrive), conflict reconciliation, offline cache, Firefox | Spec 2 |

All MVP spec items map to a task. No placeholders remain. Type names (`Vault`, `EntryView`, `TreeNode`, `Request`/`Response`, `Settings`, `PwGenOpts`) are consistent across tasks.
