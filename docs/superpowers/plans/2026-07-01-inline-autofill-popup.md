# Inline Autofill Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-page credential picker that appears when the user focuses a login field, so autofill no longer requires opening the extension popup.

**Architecture:** The content script (`src/pages/content/index.tsx`) gains `focusin`/`focusout` listeners. On focus of a detected login field, it asks the background service worker for matching entries (existing `getEntriesForUrl` message) and, if any exist, renders a vanilla-JS popup inside a Shadow DOM host (`src/content/inlinePopup.ts`). Selecting an entry (mouse or keyboard) fetches the full entry (`getEntry`) and fills the page via the existing `fillFields` helper.

**Tech Stack:** Vanilla TypeScript + Shadow DOM (no framework) for the in-page popup — content scripts run on every page load, so no React/reconciler is added there. Existing `chrome.runtime` messaging (`sendToSW`, background `handle_` switch) is reused unchanged.

## Global Constraints

- Popup must stay hidden (no UI at all) when the vault is locked or there are no matching entries — never surface "you have an account here" via a visible error state.
- No new message types — reuse `getEntriesForUrl` and `getEntry`, already implemented in `src/pages/background/index.ts`.
- Selecting an entry fills both username and password fields (same behavior as the existing popup "Autofill" button), via the existing `fillFields`/`findLoginFields` in `src/content/detect.ts`.
- Multiple forms per page are out of scope — keep existing `detect.ts` behavior of matching the first password field found.

---

### Task 1: `isLoginField` helper

**Files:**
- Modify: `src/content/detect.ts`
- Test: `src/content/detect.test.ts`

**Interfaces:**
- Consumes: `LoginFields` interface (already defined in `detect.ts`: `{ username: HTMLInputElement | null; password: HTMLInputElement | null }`).
- Produces: `isLoginField(el: HTMLElement, fields: LoginFields): boolean` — used by Task 3's focus handler.

- [ ] **Step 1: Write the failing test**

Add to `src/content/detect.test.ts` (append at end of file):

```typescript
test('isLoginField true for username or password field, false otherwise', () => {
  document.body.innerHTML = `<input type="email" id="u"><input type="password" id="p"><input type="text" id="other">`;
  const fields = findLoginFields(document);
  const u = document.getElementById('u') as HTMLInputElement;
  const p = document.getElementById('p') as HTMLInputElement;
  const other = document.getElementById('other') as HTMLInputElement;
  expect(isLoginField(u, fields)).toBe(true);
  expect(isLoginField(p, fields)).toBe(true);
  expect(isLoginField(other, fields)).toBe(false);
});
```

Also update the top import line in that same file to:

```typescript
import { findLoginFields, fillFields, isLoginField } from './detect';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/content/detect.test.ts`
Expected: FAIL — `isLoginField` is not exported from `./detect`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/content/detect.ts` (after the `findLoginFields` function, before `nativeInputSetter`):

```typescript
export function isLoginField(el: HTMLElement, fields: LoginFields): boolean {
  return el === fields.username || el === fields.password;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/content/detect.test.ts`
Expected: PASS (5 tests: the pre-existing 3 plus the new one plus the single-step test already in the file).

- [ ] **Step 5: Commit**

```bash
git add src/content/detect.ts src/content/detect.test.ts
git commit -m "feat: add isLoginField helper for inline autofill popup"
```

---

### Task 2: Keyboard navigation for the inline popup

**Context:** `src/content/inlinePopup.ts` already exists with `showPopup(field, entries, onSelect)` and `hidePopup()`, using mouse-only selection. This task adds Up/Down/Enter/Escape keyboard navigation, per the approved design.

**Files:**
- Modify: `src/content/inlinePopup.ts` (full rewrite of the file body)

**Interfaces:**
- Consumes: `EntryView` type from `../shared/entry` (unchanged).
- Produces: `showPopup(field: HTMLElement, entries: EntryStub[], onSelect: (e: EntryStub) => void): void` and `hidePopup(): void` — same signatures as before (Task 3 depends on these exact signatures), where `EntryStub = Pick<EntryView, 'id' | 'title' | 'username'>`.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/content/inlinePopup.ts` with:

```typescript
import type { EntryView } from '../shared/entry';

type EntryStub = Pick<EntryView, 'id' | 'title' | 'username'>;

let host: HTMLElement | null = null;
let activeIndex = 0;
let currentEntries: EntryStub[] = [];
let currentField: HTMLElement | null = null;
let currentOnSelect: ((e: EntryStub) => void) | null = null;
let keydownBound = false;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ensureHost(): ShadowRoot {
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-quickkee-popup', 'true');
    host.style.cssText = 'position:absolute;z-index:2147483647;display:none';
    host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
  }
  return host.shadowRoot!;
}

function render(shadow: ShadowRoot): void {
  shadow.innerHTML = `<style>
    .p{background:#1e1e2e;border:1px solid #363654;border-radius:6px;
       box-shadow:0 4px 16px rgba(0,0,0,.45);overflow:hidden;
       font:13px/1.4 system-ui,-apple-system,sans-serif;color:#cdd6f4}
    .h{padding:5px 10px;font-size:11px;color:#888;border-bottom:1px solid #2a2a3e}
    .e{padding:7px 10px;cursor:pointer;border-bottom:1px solid #2a2a3e}
    .e:last-child{border-bottom:none}
    .e:hover,.e.active{background:#2a2a3e}
    .t{font-weight:500}
    .u{font-size:11px;color:#888;margin-top:1px}
  </style>
  <div class="p">
    <div class="h">QuickKee</div>
    ${currentEntries.map((e, i) => `<div class="e${i === activeIndex ? ' active' : ''}" data-idx="${i}"><div class="t">${esc(e.title)}</div><div class="u">${esc(e.username)}</div></div>`).join('')}
  </div>`;

  shadow.querySelectorAll<HTMLElement>('.e').forEach((el, i) => {
    el.addEventListener('mousedown', ev => { ev.preventDefault(); select(i); });
  });
}

function select(i: number): void {
  const entry = currentEntries[i];
  if (entry && currentOnSelect) currentOnSelect(entry);
  hidePopup();
}

function onKeydown(ev: KeyboardEvent): void {
  if (!host || host.style.display === 'none' || currentEntries.length === 0) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    activeIndex = (activeIndex + 1) % currentEntries.length;
    render(host.shadowRoot!);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    activeIndex = (activeIndex - 1 + currentEntries.length) % currentEntries.length;
    render(host.shadowRoot!);
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    select(activeIndex);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    hidePopup();
    currentField?.focus();
  }
}

export function showPopup(field: HTMLElement, entries: EntryStub[], onSelect: (e: EntryStub) => void): void {
  const shadow = ensureHost();
  const rect = field.getBoundingClientRect();
  host!.style.cssText =
    `position:absolute;z-index:2147483647;` +
    `top:${rect.bottom + window.scrollY + 2}px;` +
    `left:${rect.left + window.scrollX}px;` +
    `min-width:${rect.width}px`;

  currentEntries = entries;
  currentField = field;
  currentOnSelect = onSelect;
  activeIndex = 0;
  render(shadow);

  if (!keydownBound) { document.addEventListener('keydown', onKeydown, true); keydownBound = true; }
}

export function hidePopup(): void {
  if (host) host.style.display = 'none';
}
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: no errors related to `src/content/inlinePopup.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/content/inlinePopup.ts
git commit -m "feat: add keyboard navigation to inline autofill popup"
```

---

### Task 3: Wire the content script

**Files:**
- Modify: `src/pages/content/index.tsx`

**Interfaces:**
- Consumes: `findLoginFields`, `fillFields`, `isLoginField` from `../../content/detect` (Task 1); `showPopup`, `hidePopup` from `../../content/inlinePopup` (Task 2); `sendToSW` from `../../shared/messages` (existing, unchanged — takes a `Request` and resolves a `Response`, both already defined in `src/shared/messages.ts`).
- Produces: nothing consumed by later tasks — this is the final wiring point.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/pages/content/index.tsx` with:

```typescript
import { findLoginFields, fillFields, isLoginField } from '../../content/detect';
import { showPopup, hidePopup } from '../../content/inlinePopup';
import { sendToSW } from '../../shared/messages';

chrome.runtime.onMessage.addListener((msg: { type: string; username?: string; password?: string }) => {
  if (msg.type === 'fill') fillFields(findLoginFields(document), msg.username ?? '', msg.password ?? '');
});

let hideTimer: ReturnType<typeof setTimeout> | null = null;

document.addEventListener('focusin', ev => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement)) return;
  const fields = findLoginFields(document);
  if (!isLoginField(el, fields)) return;
  void sendToSW({ type: 'getEntriesForUrl', url: location.href }).then(res => {
    if (!('entries' in res) || res.entries.length === 0) return;
    showPopup(el, res.entries, entry => {
      void sendToSW({ type: 'getEntry', entryId: entry.id }).then(full => {
        if ('entry' in full && full.entry) fillFields(fields, full.entry.username, full.entry.password);
      });
    });
  });
});

document.addEventListener('focusout', () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hidePopup(), 150);
});
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: no errors related to `src/pages/content/index.tsx`.

- [ ] **Step 3: Run full unit suite**

Run: `yarn test`
Expected: all existing tests still pass (no unit tests target this file directly; this step guards against an accidental break elsewhere).

- [ ] **Step 4: Commit**

```bash
git add src/pages/content/index.tsx
git commit -m "feat: wire inline autofill popup into content script"
```

---

### Task 4: E2E coverage

**Files:**
- Create: `tests/e2e/specs/inline-popup.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `openExtensionPage`, `installDb` from `../helpers` (existing); the `http` fixture's `.url` and `.singleUrl` (already added to `tests/e2e/servers.ts` in prior work — `.singleUrl` serves a page with only `<input id="email" type="email">`, no password field).

- [ ] **Step 1: Write the spec**

Create `tests/e2e/specs/inline-popup.spec.ts`:

```typescript
import { test, expect, openExtensionPage, installDb } from '../helpers';

test('inline popup: focus login field shows credential picker and fills on select', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');

  await site.locator('#username').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await site.getByText('Localhost Login').click();

  await expect(site.locator('#username')).toHaveValue('e2e-user');
  await expect(site.locator('#password')).toHaveValue('e2e-pass');
});

test('inline popup: single-step login field also shows picker', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.singleUrl);
  await site.waitForLoadState('load');

  await site.locator('#email').click();
  await expect(site.getByText('Localhost Login')).toBeVisible();
  await site.getByText('Localhost Login').click();

  await expect(site.locator('#email')).toHaveValue('e2e-user');
});
```

- [ ] **Step 2: Build the test bundle**

Run: `yarn build:chrome:test`
Expected: build succeeds (`✓ built in ...`).

- [ ] **Step 3: Run the new spec**

Run: `yarn playwright test tests/e2e/specs/inline-popup.spec.ts`
Expected: `2 passed`.

- [ ] **Step 4: Run the full E2E suite to confirm no regressions**

Run: `yarn playwright test`
Expected: same pass/fail counts as the pre-existing baseline (3 known pre-existing failures unrelated to this work: `cloud-sync.spec.ts`, `panel-save.spec.ts`, `unsaved-site.spec.ts` — confirmed failing before this feature too). No new failures beyond that baseline.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/specs/inline-popup.spec.ts
git commit -m "test: add e2e coverage for inline autofill popup"
```
