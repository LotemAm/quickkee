# QuickKee UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the QuickKee extension's popup, sidepanel, and settings pages with a cohesive Tailwind design system — Sky Azure blue accent, "Soft Cards" style, full light/dark support with an OS-aware theme mode and Lucide icons.

**Architecture:** A single shared stylesheet (`src/assets/styles/tailwind.css`) defines semantic CSS-variable design tokens (light defaults + `.dark` overrides) and a reusable component-class layer (`.btn`, `.input`, `.card`, etc.) consumed by all three pages. Theme resolution becomes OS-aware via `matchMedia`. UI is rewritten with Lucide icons while preserving every accessible name and control order the e2e suite relies on.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, lucide-react, Vitest (jsdom), Playwright.

---

## Reference: Design Tokens (Sky Azure)

These exact values are used in Task 1. Do not invent others.

**Light (`:root`):**
```
--bg:#f4f8fb; --surface:#ffffff; --surface-raised:#ffffff;
--text:#1e293b; --text-muted:#94a3b8;
--border:#e4edf3; --ring:rgba(14,165,233,.35); --shadow:0 2px 6px rgba(12,74,110,.10);
--primary:#0ea5e9; --primary-hover:#0284c7; --primary-on:#ffffff;
--primary-grad:linear-gradient(180deg,#38bdf8,#0ea5e9);
--primary-tint:#cdeefc; --primary-text:#0284c7;
--btn-bg:#eef6fb; --btn-text:#0369a1;
--danger:#dc2626; --danger-tint:#fee2e2; --danger-text:#b91c1c;
```

**Dark (`.dark`):**
```
--bg:#0a1018; --surface:#11202e; --surface-raised:#16202f;
--text:#d8eaf7; --text-muted:#7a96ad;
--border:#1f3346; --ring:rgba(56,189,248,.40); --shadow:0 2px 8px rgba(0,0,0,.45);
--primary:#0ea5e9; --primary-hover:#38bdf8; --primary-on:#ffffff;
--primary-grad:linear-gradient(180deg,#38bdf8,#0ea5e9);
--primary-tint:#075985; --primary-text:#38bdf8;
--btn-bg:#1d2b3d; --btn-text:#9ed8f5;
--danger:#f87171; --danger-tint:#7f1d1d; --danger-text:#fecaca;
```

---

## Task 1: Design tokens + component CSS layer

**Files:**
- Modify: `src/assets/styles/tailwind.css` (full replace)
- Modify: `package.json` (add `lucide-react`)

- [ ] **Step 1: Add the lucide-react dependency**

Run:
```bash
yarn add lucide-react
```
Expected: `package.json` `dependencies` now contains `lucide-react`; `yarn.lock` updated.

- [ ] **Step 2: Replace the shared stylesheet with tokens + component layer**

Replace the entire contents of `src/assets/styles/tailwind.css` with:

```css
@import "tailwindcss";

@theme {
  --animate-spin-slow: spin 20s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
}

:root {
  --bg: #f4f8fb;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --text: #1e293b;
  --text-muted: #94a3b8;
  --border: #e4edf3;
  --ring: rgba(14, 165, 233, .35);
  --shadow: 0 2px 6px rgba(12, 74, 110, .10);
  --primary: #0ea5e9;
  --primary-hover: #0284c7;
  --primary-on: #ffffff;
  --primary-grad: linear-gradient(180deg, #38bdf8, #0ea5e9);
  --primary-tint: #cdeefc;
  --primary-text: #0284c7;
  --btn-bg: #eef6fb;
  --btn-text: #0369a1;
  --danger: #dc2626;
  --danger-tint: #fee2e2;
  --danger-text: #b91c1c;
}

.dark {
  --bg: #0a1018;
  --surface: #11202e;
  --surface-raised: #16202f;
  --text: #d8eaf7;
  --text-muted: #7a96ad;
  --border: #1f3346;
  --ring: rgba(56, 189, 248, .40);
  --shadow: 0 2px 8px rgba(0, 0, 0, .45);
  --primary: #0ea5e9;
  --primary-hover: #38bdf8;
  --primary-on: #ffffff;
  --primary-grad: linear-gradient(180deg, #38bdf8, #0ea5e9);
  --primary-tint: #075985;
  --primary-text: #38bdf8;
  --btn-bg: #1d2b3d;
  --btn-text: #9ed8f5;
  --danger: #f87171;
  --danger-tint: #7f1d1d;
  --danger-text: #fecaca;
}

@layer base {
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background-color: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
      'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans',
      'Helvetica Neue', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 999px;
    border: 2px solid var(--bg);
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
}

@layer components {
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .app-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    color: var(--text);
  }
  .app-logo { color: var(--primary); }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 12px;
  }

  .input {
    width: 100%;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
    outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  .input::placeholder { color: var(--text-muted); }
  .input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--ring);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: none;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: var(--btn-bg);
    color: var(--btn-text);
    transition: filter .15s, opacity .15s;
  }
  .btn:hover { filter: brightness(.96); }
  .btn:disabled { opacity: .5; cursor: not-allowed; }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    background: var(--primary-grad);
    color: var(--primary-on);
    box-shadow: 0 2px 5px rgba(14, 165, 233, .35);
    transition: filter .15s, opacity .15s;
  }
  .btn-primary:hover { filter: brightness(1.05); }
  .btn-primary:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }

  .btn-xs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    background: var(--btn-bg);
    color: var(--btn-text);
    transition: filter .15s;
  }
  .btn-xs:hover { filter: brightness(.96); }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    background: transparent;
    color: var(--text-muted);
    transition: background .15s, color .15s;
  }
  .icon-btn:hover { background: var(--btn-bg); color: var(--primary-text); }

  .badge {
    display: inline-flex;
    align-items: center;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: .03em;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--primary-tint);
    color: var(--primary-text);
  }
  .badge-danger { background: var(--danger-tint); color: var(--danger-text); }

  .alert-error {
    font-size: 12px;
    color: var(--danger-text);
    background: var(--danger-tint);
    border-radius: 8px;
    padding: 7px 10px;
  }

  .empty-state {
    color: var(--text-muted);
    font-size: 13px;
    text-align: center;
    padding: 24px 16px;
  }

  .segmented {
    display: inline-flex;
    background: var(--btn-bg);
    border-radius: 9px;
    padding: 3px;
    gap: 3px;
  }
  .segmented-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: 7px;
    cursor: pointer;
    transition: background .15s, color .15s;
  }
  .segmented-item[aria-pressed="true"] {
    background: var(--surface);
    color: var(--primary-text);
    box-shadow: var(--shadow);
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }
}
```

- [ ] **Step 3: Verify the build compiles the stylesheet**

Run:
```bash
yarn build:chrome
```
Expected: build completes with no CSS/PostCSS errors; `dist_chrome/` is produced.

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock src/assets/styles/tailwind.css
git commit -m "feat(ui): add Sky Azure design tokens, component CSS layer, lucide-react"
```

---

## Task 2: OS-aware theme system

**Files:**
- Modify: `src/shared/settings.ts`
- Modify: `src/shared/theme.ts` (full replace)
- Test: `src/shared/theme.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/shared/theme.test.ts`:

```ts
import { applyTheme } from './theme';

function mockMatchMedia(matchesDark: boolean) {
  (window as any).matchMedia = (query: string) => ({
    matches: query.includes('dark') ? matchesDark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false);
});

test('explicit dark adds the dark class', () => {
  applyTheme('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('explicit light removes the dark class', () => {
  document.documentElement.classList.add('dark');
  applyTheme('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

test('system follows OS preference (dark)', () => {
  mockMatchMedia(true);
  applyTheme('system');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('system follows OS preference (light)', () => {
  mockMatchMedia(false);
  document.documentElement.classList.add('dark');
  applyTheme('system');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
yarn test src/shared/theme.test.ts
```
Expected: FAIL — current `applyTheme` only accepts `'dark' | 'light'`, so the `'system'` cases fail (TypeScript/behavior) and/or `matchMedia` is unused.

- [ ] **Step 3: Implement the OS-aware theme module**

Replace the entire contents of `src/shared/theme.ts` with:

```ts
export type ThemeMode = 'system' | 'light' | 'dark';

let mql: MediaQueryList | null = null;
let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function setDark(on: boolean): void {
  document.documentElement.classList.toggle('dark', on);
}

function clearSystemListener(): void {
  if (mql && mqlHandler) mql.removeEventListener('change', mqlHandler);
  mql = null;
  mqlHandler = null;
}

export function applyTheme(theme: ThemeMode): void {
  clearSystemListener();
  if (theme === 'system') {
    setDark(prefersDark());
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      mqlHandler = (e) => setDark(e.matches);
      mql.addEventListener('change', mqlHandler);
    }
    return;
  }
  setDark(theme === 'dark');
}
```

- [ ] **Step 4: Update the Settings type and default**

In `src/shared/settings.ts`:

Replace:
```ts
export interface Settings { autoCloseHours: number; clipboardClearSeconds: number; pwgen: PwGenOpts; theme: 'dark' | 'light' }

export const DEFAULT_SETTINGS: Settings = { autoCloseHours: 8, clipboardClearSeconds: 30, pwgen: DEFAULT_PWGEN, theme: 'light' };
```
with:
```ts
import type { ThemeMode } from './theme';

export interface Settings { autoCloseHours: number; clipboardClearSeconds: number; pwgen: PwGenOpts; theme: ThemeMode }

export const DEFAULT_SETTINGS: Settings = { autoCloseHours: 8, clipboardClearSeconds: 30, pwgen: DEFAULT_PWGEN, theme: 'system' };
```
(Keep the existing `import { DEFAULT_PWGEN, type PwGenOpts } from './pwgen';` line above the new import.)

- [ ] **Step 5: Run unit tests to verify they pass**

Run:
```bash
yarn test src/shared/theme.test.ts src/shared/settings.test.ts
```
Expected: PASS — all four theme tests pass; `settings.test.ts` still passes (it compares against `DEFAULT_SETTINGS`).

- [ ] **Step 6: Typecheck**

Run:
```bash
yarn typecheck
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/theme.ts src/shared/theme.test.ts src/shared/settings.ts
git commit -m "feat(theme): OS-aware system theme mode with live matchMedia listener"
```

---

## Task 3: Wire shared stylesheet everywhere + remove dead CSS

**Files:**
- Modify: `src/pages/options/index.tsx`
- Modify: `src/pages/popup/index.css` (full replace)
- Delete: `src/pages/panel/Panel.css`
- Delete: `src/pages/options/Options.css`
- Modify: `src/pages/panel/Panel.tsx` (remove Panel.css import if present)
- Modify: `src/pages/options/Options.tsx` (remove Options.css import if present)

- [ ] **Step 1: Import the shared stylesheet in Options**

In `src/pages/options/index.tsx`, replace:
```ts
import { Options } from '@pages/options/Options';
import '@pages/options/index.css';
```
with:
```ts
import { Options } from '@pages/options/Options';
import '@pages/options/index.css';
import '@assets/styles/tailwind.css';
```

- [ ] **Step 2: Slim down the popup page CSS**

Replace the entire contents of `src/pages/popup/index.css` with:
```css
body {
  width: 340px;
  min-height: 200px;
}
```

- [ ] **Step 3: Remove dead CSS files and their imports**

Delete the files:
```bash
git rm src/pages/panel/Panel.css src/pages/options/Options.css
```

Then check for and remove any import of these files:
```bash
grep -rn "Panel.css\|Options.css" src
```
Expected: no remaining references. If `grep` finds an `import './Panel.css';` in `src/pages/panel/Panel.tsx` or `import './Options.css';` in `src/pages/options/Options.tsx`, delete those import lines. (As of writing, `Panel.tsx` and `Options.tsx` do not import them, but verify.)

- [ ] **Step 4: Verify build**

Run:
```bash
yarn build:chrome
```
Expected: build succeeds; no "module not found" for the deleted CSS files.

- [ ] **Step 5: Commit**

```bash
git add -A src/pages
git commit -m "refactor(ui): share stylesheet across all pages; drop hardcoded page CSS"
```

---

## Task 4: Redesign the Unlock screen (shared)

**Files:**
- Modify: `src/shared/UnlockScreen.tsx` (full replace of the returned JSX + imports)

The accessible names `Open .kdbx file…`-style buttons and the `Master password`
placeholder and `Unlock` button name MUST be preserved.

- [ ] **Step 1: Rewrite UnlockScreen with cards + Lucide icons**

Replace the entire contents of `src/shared/UnlockScreen.tsx` with:

```tsx
import { useState, useEffect } from 'react';
import { ShieldCheck, FileKey, KeyRound, Lock } from 'lucide-react';
import { sendToSW } from './messages';
import { pickAndStoreDb, readKeyFile } from './pickFile';
import { loadHandle, ensurePermission } from '../background/fileHandle';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [dbName, setDbName] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [keyFile, setKeyFile] = useState<number[] | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { void loadHandle().then(h => setDbName(h?.name ?? null)); }, []);

  const canUnlock = (pwd.length > 0) || (useKey && keyFile);
  async function unlock() {
    setErr('');
    const h = await loadHandle();
    if (!h) { setErr('Pick a database file first'); return; }
    if (!(await ensurePermission(h, 'readwrite'))) { setErr('Grant file access to continue'); return; }
    const r = await sendToSW({ type: 'unlock', password: pwd || null, keyFile: useKey ? keyFile : null });
    if (r.ok) onUnlocked();
    else setErr({ badCredentials: 'Wrong password or key file', permission: 'Grant file access to continue',
      noFile: 'Pick a database file first' }[r.error as string] ?? r.error);
  }

  return (
    <div className="p-4">
      <div className="card space-y-3">
        <div className="app-title justify-center text-base">
          <ShieldCheck size={20} className="app-logo" /> QuickKee
        </div>
        <button className="btn w-full" onClick={async () => { try { setDbName(await pickAndStoreDb()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
          <FileKey size={15} /> {dbName ? `Database: ${dbName}` : 'Open .kdbx file…'}
        </button>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={useKey} onChange={e => setUseKey(e.target.checked)} /> Use key file
        </label>
        {useKey && <button className="btn w-full" onClick={async () => { try { setKeyFile(await readKeyFile()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
          <KeyRound size={15} /> {keyFile ? 'Key file selected' : 'Choose key file…'}</button>}
        <input type="password" className="input" placeholder="Master password" value={pwd}
          onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && canUnlock && unlock()} />
        {err && <p className="alert-error">{err}</p>}
        <button className="btn-primary w-full" disabled={!canUnlock || !dbName} onClick={unlock}>
          <Lock size={15} /> Unlock
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
yarn typecheck
```
Expected: no errors (confirms `lucide-react` types resolve and JSX is valid).

- [ ] **Step 3: Commit**

```bash
git add src/shared/UnlockScreen.tsx
git commit -m "feat(ui): redesign unlock screen as a card with Lucide icons"
```

---

## Task 5: Redesign the Popup

**Files:**
- Modify: `src/pages/popup/Popup.tsx` (full replace)
- Modify: `src/pages/popup/EntryCard.tsx` (full replace)
- Modify: `src/pages/popup/CreateForm.tsx` (full replace)

Preserve: placeholder `Search…`; button accessible names `Copy user`, `Copy pass`, `Autofill`.

- [ ] **Step 1: Rewrite EntryCard with icons + card styling**

Replace the entire contents of `src/pages/popup/EntryCard.tsx` with:

```tsx
import { useState } from 'react';
import { Copy, LogIn, ChevronDown, ChevronUp } from 'lucide-react';
import type { EntryView } from '../../shared/entry';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';

export function EntryCard({ entry, tabId, clearSecs }: { entry: EntryView; tabId: number; clearSecs: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card mb-2">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate" style={{ color: 'var(--text)' }}>{entry.title}</div>
          <div className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{entry.username}</div>
        </div>
        {entry.expired && <span className="badge-danger badge">EXPIRED</span>}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <button className="btn-xs" aria-label="Copy user" onClick={() => copyWithClear(entry.username, clearSecs)}>
          <Copy size={12} /> User
        </button>
        <button className="btn-xs" aria-label="Copy pass" onClick={() => copyWithClear(entry.password, clearSecs)}>
          <Copy size={12} /> Pass
        </button>
        <button className="btn-xs" aria-label="Autofill" onClick={() => sendToSW({ type: 'fillRequest', entryId: entry.id, tabId })}>
          <LogIn size={12} /> Autofill
        </button>
        <button className="btn-xs" aria-label="Toggle fields" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Fields
        </button>
      </div>
      {open && <div className="mt-2 space-y-1">
        {entry.fields.map(f => (
          <div key={f.key} className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-muted)' }}>{f.key}</span>
            <button className="btn-xs" onClick={() => copyWithClear(f.value, clearSecs)}>
              <Copy size={12} /> Copy
            </button>
          </div>))}
      </div>}
    </div>
  );
}
```

Note: the `aria-label` on the Copy/Pass/Autofill buttons guarantees the e2e
accessible names (`Copy user`, `Copy pass`, `Autofill`) regardless of icon text.

- [ ] **Step 2: Rewrite CreateForm as a styled card**

Replace the entire contents of `src/pages/popup/CreateForm.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
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
    <div className="card space-y-2">
      <div className="section-title">New entry</div>
      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{url}</p>
      <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
      <input className="input" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      <button className="btn-primary w-full" disabled={!title} onClick={create}>
        <Plus size={15} /> Create &amp; Save
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite Popup with header + body layout**

Replace the entire contents of `src/pages/popup/Popup.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { ShieldCheck, Search, Settings } from 'lucide-react';
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
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (import.meta.env.VITE_QK_TEST === '1' && p.get('qkurl')) {
      setTab({ id: Number(p.get('qktab')), url: p.get('qkurl')! });
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([t]) => t?.id && t.url && setTab({ id: t.id, url: t.url }));
  }, []);
  useEffect(() => { if (locked || !tab) return;
    sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries));
    sendToSW({ type: 'getTree' }).then(r => 'tree' in r && setRootGroup(r.tree.groupId));
  }, [locked, tab]);

  if (locked) return <UnlockScreen onUnlocked={refresh} />;
  const shown = entries.filter(e => (e.title + e.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <header className="app-header">
        <span className="app-title"><ShieldCheck size={18} className="app-logo" /> QuickKee</span>
        <button className="icon-btn" aria-label="Open settings" onClick={() => chrome.runtime.openOptionsPage()}>
          <Settings size={16} />
        </button>
      </header>
      <div className="p-3">
        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input className="input pl-9" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} clearSecs={clearSecs} />)}
        {entries.length === 0 && tab && rootGroup &&
          <CreateForm url={tab.url} groupId={rootGroup} onCreated={() =>
            sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries))} />}
      </div>
    </div>
  );
}
```

Note: the unlocked popup no longer wraps content in `w-80`; width is set by
`body { width: 340px }` in `index.css`. The locked state now renders the
`UnlockScreen` card directly (it has its own padding).

- [ ] **Step 4: Typecheck + build**

Run:
```bash
yarn typecheck && yarn build:chrome
```
Expected: no type errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/popup/Popup.tsx src/pages/popup/EntryCard.tsx src/pages/popup/CreateForm.tsx
git commit -m "feat(ui): redesign popup with header, search, and soft entry cards"
```

---

## Task 6: Redesign the Sidepanel (master–detail)

**Files:**
- Modify: `src/pages/panel/Panel.tsx` (full replace)
- Modify: `src/pages/panel/EntryEditor.tsx` (full replace)

Preserve: entry rows are `<button>` with the entry title as accessible name;
`Apply changes` button; Save button text `Save *` / `Saved`; EntryEditor input
order Title → Username → Password → URL with **no input before Title**.

- [ ] **Step 1: Rewrite Panel with header, tree, and detail pane**

Replace the entire contents of `src/pages/panel/Panel.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { ShieldCheck, Save, FolderClosed, FileText } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { TreeNode } from '../../shared/entry';
import { EntryEditor } from './EntryEditor';

function TreeView({ node, sel, onPick, depth = 0 }: { node: TreeNode; sel: string | null; onPick: (id: string) => void; depth?: number }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1 text-sm font-medium"
        style={{ color: 'var(--text-muted)', paddingLeft: `${8 + depth * 12}px` }}>
        <FolderClosed size={13} /> {node.name}
      </div>
      {node.entries.map(e => (
        <button key={e.id} onClick={() => onPick(e.id)}
          className="flex items-center gap-1.5 w-full text-left text-sm rounded-md py-1 pr-2 transition-colors"
          style={{
            paddingLeft: `${20 + depth * 12}px`,
            color: 'var(--text)',
            background: sel === e.id ? 'var(--primary-tint)' : 'transparent',
          }}
          onMouseEnter={ev => { if (sel !== e.id) ev.currentTarget.style.background = 'var(--btn-bg)'; }}
          onMouseLeave={ev => { if (sel !== e.id) ev.currentTarget.style.background = 'transparent'; }}>
          <FileText size={13} style={{ color: 'var(--text-muted)' }} />
          <span className="truncate">{e.title}</span>
          {e.expired && <span className="badge-danger badge ml-auto">expired</span>}
        </button>))}
      {node.children.map(c => <TreeView key={c.groupId} node={c} sel={sel} onPick={onPick} depth={depth + 1} />)}
    </div>
  );
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
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <div className="w-1/2 max-w-sm flex flex-col" style={{ borderRight: '1px solid var(--border)' }}>
        <header className="app-header">
          <span className="app-title"><ShieldCheck size={18} className="app-logo" /> QuickKee</span>
          <button className="btn-primary btn-xs" disabled={!dirty} onClick={save}>
            <Save size={13} /> {dirty ? 'Save *' : 'Saved'}{saved && ` · ${saved}`}
          </button>
        </header>
        <div className="overflow-auto py-2 flex-1">
          {tree && <TreeView node={tree} sel={sel} onPick={setSel} />}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {sel
          ? <EntryEditor entryId={sel} clearSecs={clearSecs} onChanged={() => { refresh(); reload(); }} />
          : <div className="empty-state mt-12">Select an entry to view and edit its details.</div>}
      </div>
    </div>);
}
```

Note: the Save button keeps its `Save *` / `Saved` text exactly (the e2e test
asserts `toContainText('Save *')`). The `btn-primary btn-xs` combo gives it the
gradient look at a compact size.

- [ ] **Step 2: Rewrite EntryEditor as a card with labeled fields**

Replace the entire contents of `src/pages/panel/EntryEditor.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';
import type { EntryView } from '../../shared/entry';

export function EntryEditor({ entryId, clearSecs, onChanged }: { entryId: string; clearSecs: number; onChanged: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  useEffect(() => { sendToSW({ type: 'getEntry', entryId }).then(r => 'entry' in r && setE(r.entry)); }, [entryId]);
  if (!e) return null;
  const field = (label: string, key: 'title' | 'username' | 'url' | 'password') => (
    <div className="mb-3">
      <label className="section-title block">{label}</label>
      <div className="flex gap-2 items-center">
        <input className="input flex-1" value={e[key]} onChange={ev => setE({ ...e, [key]: ev.target.value })} />
        <button className="icon-btn" aria-label={`Copy ${label}`} onClick={() => copyWithClear(e[key], clearSecs)}>
          <Copy size={15} />
        </button>
      </div>
    </div>);
  async function save() {
    await sendToSW({ type: 'updateEntry', entryId,
      fields: { Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password } });
    onChanged();
  }
  return (
    <div className="p-4">
      <div className="card">
        {field('Title', 'title')}
        {field('Username', 'username')}
        {field('Password', 'password')}
        {field('URL', 'url')}
        {e.fields.map(f => (
          <div key={f.key} className="mb-3">
            <label className="section-title block">{f.key}</label>
            <div className="flex gap-2 items-center">
              <span className="flex-1 text-sm" style={{ color: 'var(--text-muted)' }}>{f.value}</span>
              <button className="icon-btn" aria-label={`Copy ${f.key}`} onClick={() => copyWithClear(f.value, clearSecs)}>
                <Copy size={15} />
              </button>
            </div>
          </div>))}
        <button className="btn-primary mt-1" onClick={save}>
          <Check size={15} /> Apply changes
        </button>
      </div>
    </div>);
}
```

Note: the four `field(...)` calls render inputs in order Title, Username,
Password, URL with no input before them, so the panel e2e test's
`input.nth(2)` still targets the Password field.

- [ ] **Step 3: Typecheck + build**

Run:
```bash
yarn typecheck && yarn build:chrome
```
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/panel/Panel.tsx src/pages/panel/EntryEditor.tsx
git commit -m "feat(ui): redesign sidepanel as themed master-detail with tree + editor card"
```

---

## Task 7: Redesign Settings + update its e2e test

**Files:**
- Modify: `src/pages/options/Options.tsx` (full replace)
- Modify: `tests/e2e/specs/options.spec.ts` (full replace)

Preserve: auto-close is the **first** `<select>` (combobox). The `Dark theme`
checkbox is intentionally replaced by a segmented control — the e2e test is
updated to match.

- [ ] **Step 1: Rewrite Options with card sections + theme segmented control**

Replace the entire contents of `src/pages/options/Options.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { ShieldCheck, Monitor, Sun, Moon } from 'lucide-react';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { applyTheme, type ThemeMode } from '../../shared/theme';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function Options() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => { loadSettings().then(v => { setS(v); applyTheme(v.theme); }); }, []);
  const update = (patch: Partial<Settings>) => { const next = { ...s, ...patch };
    setS(next); applyTheme(next.theme); void saveSettings(next); };
  return (
    <div className="min-h-screen">
      <header className="app-header">
        <span className="app-title"><ShieldCheck size={18} className="app-logo" /> QuickKee Settings</span>
      </header>
      <div className="p-6 max-w-md mx-auto space-y-4">
        <section className="card space-y-3">
          <div className="section-title">Appearance</div>
          <div className="segmented" role="group" aria-label="Theme">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" className="segmented-item"
                aria-pressed={s.theme === value} onClick={() => update({ theme: value })}>
                <Icon size={14} /> {label}
              </button>))}
          </div>
        </section>

        <section className="card space-y-3">
          <div className="section-title">Security</div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Auto-close after
            <select className="input w-auto" value={s.autoCloseHours}
              onChange={e => update({ autoCloseHours: Number(e.target.value) })}>
              {[1, 2, 4, 8, 24].map(h => <option key={h} value={h}>{h} hour(s)</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Clipboard auto-clear
            <select className="input w-auto" value={s.clipboardClearSeconds}
              onChange={e => update({ clipboardClearSeconds: Number(e.target.value) })}>
              {[0, 15, 30, 60].map(x => <option key={x} value={x}>{x === 0 ? 'never' : `${x}s`}</option>)}
            </select>
          </label>
        </section>

        <section className="card space-y-3">
          <div className="section-title">Default generated password</div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Length
            <input type="number" className="input w-20" value={s.pwgen.length}
              onChange={e => update({ pwgen: { ...s.pwgen, length: Math.max(1, Number(e.target.value) || 1) } })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['lower', 'upper', 'digits', 'symbols'] as const).map(k => (
              <label key={k} className="flex items-center gap-2 text-sm capitalize">
                <input type="checkbox" checked={s.pwgen[k]}
                  onChange={e => update({ pwgen: { ...s.pwgen, [k]: e.target.checked } })} /> {k}
              </label>))}
          </div>
        </section>
      </div>
    </div>);
}
```

Note: the **first** `<select>` in DOM order is still Auto-close (the e2e test
uses `getByRole('combobox').first()`).

- [ ] **Step 2: Update the options e2e test for the segmented control**

Replace the entire contents of `tests/e2e/specs/options.spec.ts` with:

```ts
import { test, expect, openExtensionPage } from '../helpers';

test('options: changing settings persists to chrome.storage.local across reload', async ({ context, extensionId }) => {
  const opts = await openExtensionPage(context, extensionId, 'src/pages/options/index.html');

  // Change auto-close to 24h and select the Dark theme (both save-on-change).
  await opts.getByRole('combobox').first().selectOption('24');
  await opts.getByRole('button', { name: 'Dark' }).click();

  // Reload and confirm the controls reflect the saved values.
  await opts.reload();
  await expect(opts.getByRole('combobox').first()).toHaveValue('24');
  await expect(opts.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');

  // And confirm the underlying storage.
  const stored = await opts.evaluate(() => chrome.storage.local.get('settings'));
  expect(stored.settings.autoCloseHours).toBe(24);
  expect(stored.settings.theme).toBe('dark');
});
```

- [ ] **Step 3: Typecheck + build**

Run:
```bash
yarn typecheck && yarn build:chrome
```
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/options/Options.tsx tests/e2e/specs/options.spec.ts
git commit -m "feat(ui): redesign settings into themed cards with theme segmented control"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run:
```bash
yarn typecheck
```
Expected: no errors.

- [ ] **Step 2: Unit tests**

Run:
```bash
yarn test
```
Expected: all vitest suites pass (including `theme.test.ts` and `settings.test.ts`).

- [ ] **Step 3: End-to-end tests**

Run:
```bash
yarn test:e2e
```
Expected: Playwright builds the test extension and all specs pass — notably
`saved-site` (Copy user / Autofill), `panel-save` (Apply changes / Save *),
`unlock`, and the updated `options` spec.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Load `dist_chrome/` as an unpacked extension and visually confirm:
- Popup, sidepanel, and settings all render the Sky Azure themed cards.
- Toggling the OS theme (or the Settings segmented control) flips light/dark
  across all pages.

- [ ] **Step 5: Final commit (if any manual fixups were needed)**

```bash
git add -A
git commit -m "chore(ui): final verification fixups for QuickKee redesign"
```

---

## Self-Review Notes

- **Spec coverage:** design system (Task 1), theme system incl. system mode
  (Task 2), shared stylesheet wiring + dead-CSS cleanup (Task 3), icons +
  unlock (Task 4), popup (Task 5), sidepanel (Task 6), settings + theme control
  + test update (Task 7), verification (Task 8). All spec sections covered.
- **Test-preservation constraints** from the spec are honored in Tasks 4–7
  (accessible names, first-combobox order, EntryEditor input order, Save text).
- **Type consistency:** `ThemeMode` defined in `theme.ts` (Task 2) and imported
  by `settings.ts` (Task 2) and `Options.tsx` (Task 7); `applyTheme(ThemeMode)`
  used consistently in Popup, Panel, and Options.
