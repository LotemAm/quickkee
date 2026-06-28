# Clipboard Clear Progress Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a dismissable progress bar in the popup and side panel that counts down from when the user copies a field until the clipboard auto-clears.

**Architecture:** A `useClipboardTimer(clearSecs)` hook owns all timer state and replaces direct `copyWithClear` calls; a shared `ClipboardBar` component renders the strip. The popup bar lives in `Popup` (passed down via `onCopy` prop to `EntryCard`); the panel bar lives inside `EntryEditor` (hook used internally).

**Tech Stack:** React 19, TypeScript, Vitest + jsdom + @testing-library/react (all already installed), lucide-react for the × icon.

## Global Constraints

- No new npm packages — all dependencies already present.
- No new CSS classes — use existing `icon-btn-xs` class and CSS variables (`--primary`, `--primary-tint`, `--primary-text`).
- `clipboard.ts` and `Panel.tsx` must NOT be modified.
- `vitest.config.ts` `globals: true` — do NOT import `vi`, `describe`, `it`, `expect`, `test` in test files.
- All test files import `@testing-library/jest-dom` directly (not via setup file).
- Use `rtk tsc` to typecheck, `rtk vitest run <path>` to run tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/shared/useClipboardTimer.ts` | Timer hook — wraps copyWithClear, tracks progress state |
| Create | `src/shared/useClipboardTimer.test.ts` | Hook unit tests |
| Create | `src/shared/ClipboardBar.tsx` | Progress bar UI component |
| Create | `src/shared/ClipboardBar.test.tsx` | Component unit tests |
| Modify | `src/pages/popup/EntryCard.tsx` | Swap `clearSecs` prop for `onCopy` callback |
| Modify | `src/pages/popup/Popup.tsx` | Use hook, render bar between header and search, pass `copy` to EntryCard |
| Modify | `src/pages/panel/EntryEditor.tsx` | Use hook internally, render bar above card, replace all copyWithClear calls |

---

## Task 1: `useClipboardTimer` hook

**Files:**
- Create: `src/shared/useClipboardTimer.ts`
- Create: `src/shared/useClipboardTimer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ClipboardTimerState { label: string; progress: number; }
  export function useClipboardTimer(clearSecs: number): {
    copy: (text: string, label: string) => void;
    state: ClipboardTimerState | null;
    cancel: () => void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/shared/useClipboardTimer.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useClipboardTimer } from './useClipboardTimer';

vi.mock('./clipboard', () => ({ copyWithClear: vi.fn() }));

const writeTextMock = vi.fn().mockResolvedValue(undefined);
(globalThis as any).navigator = {
  clipboard: { writeText: writeTextMock, readText: vi.fn().mockResolvedValue('') },
};

beforeEach(() => {
  vi.useFakeTimers();
  writeTextMock.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

test('starts with null state', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  expect(result.current.state).toBeNull();
});

test('sets state to full progress immediately on copy', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('secret', 'Password'); });
  expect(result.current.state).toEqual({ label: 'Password', progress: 1 });
});

test('progress decreases over time', () => {
  const { result } = renderHook(() => useClipboardTimer(10));
  act(() => { result.current.copy('secret', 'Password'); });
  act(() => { vi.advanceTimersByTime(5000); });
  expect(result.current.state?.progress).toBeCloseTo(0.5, 1);
  expect(result.current.state?.label).toBe('Password');
});

test('state becomes null after full duration', () => {
  const { result } = renderHook(() => useClipboardTimer(10));
  act(() => { result.current.copy('secret', 'Password'); });
  act(() => { vi.advanceTimersByTime(10_100); });
  expect(result.current.state).toBeNull();
});

test('does not show bar when clearSecs is 0', () => {
  const { result } = renderHook(() => useClipboardTimer(0));
  act(() => { result.current.copy('secret', 'Password'); });
  expect(result.current.state).toBeNull();
});

test('re-copy resets label and progress to 1', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('pass', 'Password'); });
  act(() => { vi.advanceTimersByTime(15_000); });
  act(() => { result.current.copy('user', 'Username'); });
  expect(result.current.state).toEqual({ label: 'Username', progress: 1 });
});

test('cancel sets state to null', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('pass', 'Password'); });
  act(() => { result.current.cancel(); });
  expect(result.current.state).toBeNull();
});

test('cancel writes empty string to clipboard', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('pass', 'Password'); });
  act(() => { result.current.cancel(); });
  expect(writeTextMock).toHaveBeenCalledWith('');
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
rtk vitest run src/shared/useClipboardTimer.test.ts
```

Expected: FAIL — `Cannot find module './useClipboardTimer'`

- [ ] **Step 3: Write the implementation**

Create `src/shared/useClipboardTimer.ts`:

```ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { copyWithClear } from './clipboard';

export interface ClipboardTimerState {
  label: string;
  progress: number;
}

export function useClipboardTimer(clearSecs: number) {
  const [state, setState] = useState<ClipboardTimerState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => stopInterval(), [stopInterval]);

  const cancel = useCallback(() => {
    stopInterval();
    setState(null);
    navigator.clipboard.writeText('').catch(() => {});
  }, [stopInterval]);

  const copy = useCallback((text: string, label: string) => {
    copyWithClear(text, clearSecs);
    if (clearSecs <= 0) return;
    stopInterval();
    const start = Date.now();
    const totalMs = clearSecs * 1000;
    setState({ label, progress: 1 });
    intervalRef.current = setInterval(() => {
      const progress = Math.max(0, 1 - (Date.now() - start) / totalMs);
      if (progress <= 0) {
        stopInterval();
        setState(null);
      } else {
        setState({ label, progress });
      }
    }, 100);
  }, [clearSecs, stopInterval]);

  return { copy, state, cancel };
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
rtk vitest run src/shared/useClipboardTimer.test.ts
```

Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add src/shared/useClipboardTimer.ts src/shared/useClipboardTimer.test.ts
rtk git commit -m "feat: add useClipboardTimer hook"
```

---

## Task 2: `ClipboardBar` component

**Files:**
- Create: `src/shared/ClipboardBar.tsx`
- Create: `src/shared/ClipboardBar.test.tsx`

**Interfaces:**
- Consumes: `ClipboardTimerState` from `./useClipboardTimer`
- Produces:
  ```tsx
  export function ClipboardBar(props: {
    state: ClipboardTimerState;
    onCancel: () => void;
  }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `src/shared/ClipboardBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClipboardBar } from './ClipboardBar';

test('shows "{label} copied" text', () => {
  render(<ClipboardBar state={{ label: 'Password', progress: 0.7 }} onCancel={vi.fn()} />);
  expect(screen.getByText('Password copied')).toBeInTheDocument();
});

test('fill div width reflects progress percentage', () => {
  const { container } = render(
    <ClipboardBar state={{ label: 'Password', progress: 0.6 }} onCancel={vi.fn()} />
  );
  const fill = container.querySelector('[data-testid="clipboard-bar-fill"]') as HTMLElement;
  expect(fill.style.width).toBe('60%');
});

test('cancel button calls onCancel', () => {
  const onCancel = vi.fn();
  render(<ClipboardBar state={{ label: 'Password', progress: 0.5 }} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole('button', { name: /cancel clipboard clear/i }));
  expect(onCancel).toHaveBeenCalledOnce();
});

test('shows custom field label', () => {
  render(<ClipboardBar state={{ label: 'API Key', progress: 0.3 }} onCancel={vi.fn()} />);
  expect(screen.getByText('API Key copied')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
rtk vitest run src/shared/ClipboardBar.test.tsx
```

Expected: FAIL — `Cannot find module './ClipboardBar'`

- [ ] **Step 3: Write the implementation**

Create `src/shared/ClipboardBar.tsx`:

```tsx
import { X } from 'lucide-react';
import type { ClipboardTimerState } from './useClipboardTimer';

export function ClipboardBar({ state, onCancel }: { state: ClipboardTimerState; onCancel: () => void }) {
  return (
    <div style={{
      position: 'relative',
      height: '28px',
      background: 'var(--primary-tint)',
      display: 'flex',
      alignItems: 'center',
      paddingRight: '4px',
    }}>
      <div
        data-testid="clipboard-bar-fill"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--primary)',
          width: `${state.progress * 100}%`,
          opacity: 0.25,
          transition: 'width 0.1s linear',
        }}
      />
      <span style={{
        position: 'relative',
        flex: 1,
        fontSize: '12px',
        color: 'var(--primary-text)',
        paddingLeft: '10px',
      }}>
        {state.label} copied
      </span>
      <button
        className="icon-btn-xs"
        style={{ position: 'relative' }}
        aria-label="Cancel clipboard clear"
        title="Cancel clipboard clear"
        onClick={onCancel}
      >
        <X size={12} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
rtk vitest run src/shared/ClipboardBar.test.tsx
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add src/shared/ClipboardBar.tsx src/shared/ClipboardBar.test.tsx
rtk git commit -m "feat: add ClipboardBar component"
```

---

## Task 3: Wire popup — `EntryCard` + `Popup`

**Files:**
- Modify: `src/pages/popup/EntryCard.tsx`
- Modify: `src/pages/popup/Popup.tsx`

**Interfaces:**
- Consumes: `useClipboardTimer` from `../../shared/useClipboardTimer`, `ClipboardBar` from `../../shared/ClipboardBar`
- EntryCard new prop: `onCopy: (text: string, label: string) => void` (replaces `clearSecs: number`)

- [ ] **Step 1: Rewrite `EntryCard.tsx`**

Replace the full contents of `src/pages/popup/EntryCard.tsx` with:

```tsx
import { useState } from 'react';
import { Copy, LogIn, ChevronDown, ChevronUp } from 'lucide-react';
import type { EntryView } from '../../shared/entry';
import { sendToSW } from '../../shared/messages';

export function EntryCard({ entry, tabId, onCopy, groupName }: {
  entry: EntryView;
  tabId: number;
  onCopy: (text: string, label: string) => void;
  groupName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card mb-2">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate" style={{ color: 'var(--text)' }}>{entry.title}</div>
          <div className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{entry.username}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {entry.expired && <span className="badge-danger badge">EXPIRED</span>}
          {groupName && <span className="badge max-w-[120px]"><span className="truncate">{groupName}</span></span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <button className="btn-xs" aria-label="Copy user" onClick={() => onCopy(entry.username, 'Username')}>
          <Copy size={12} /> User
        </button>
        <button className="btn-xs" aria-label="Copy pass" onClick={() => onCopy(entry.password, 'Password')}>
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
            <button className="btn-xs" onClick={() => onCopy(f.value, f.key)}>
              <Copy size={12} /> Copy
            </button>
          </div>))}
      </div>}
    </div>
  );
}
```

- [ ] **Step 2: Update `Popup.tsx`**

Make these changes to `src/pages/popup/Popup.tsx`:

**Add imports** (after the existing imports):
```tsx
import { useClipboardTimer } from '../../shared/useClipboardTimer';
import { ClipboardBar } from '../../shared/ClipboardBar';
```

**Inside the `Popup` function**, after the `useEffect` calls, add:
```tsx
const { copy, state: clipState, cancel } = useClipboardTimer(clearSecs);
```

**Replace** the `ClipboardBar` render location — inside the returned JSX, between `</header>` and `<div className="p-3">`, add:
```tsx
{clipState && <ClipboardBar state={clipState} onCancel={cancel} />}
```

**Replace** `<EntryCard ... clearSecs={clearSecs} ...>` (line 111) with:
```tsx
{shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} onCopy={copy} groupName={groupNames.get(e.id)} />)}
```

The final structure of the return JSX should be:
```tsx
return (
  <div>
    <header className="app-header">
      ...
    </header>
    {clipState && <ClipboardBar state={clipState} onCancel={cancel} />}
    <div className="p-3">
      ...
      {shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} onCopy={copy} groupName={groupNames.get(e.id)} />)}
      ...
    </div>
  </div>
);
```

- [ ] **Step 3: Typecheck**

```bash
rtk tsc
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
rtk git add src/pages/popup/EntryCard.tsx src/pages/popup/Popup.tsx
rtk git commit -m "feat: wire clipboard progress bar into popup"
```

---

## Task 4: Wire panel — `EntryEditor`

**Files:**
- Modify: `src/pages/panel/EntryEditor.tsx`

**Interfaces:**
- Consumes: `useClipboardTimer` from `../../shared/useClipboardTimer`, `ClipboardBar` from `../../shared/ClipboardBar`
- `EntryEditor` props unchanged: `{ entryId: string; clearSecs: number; onChanged: () => void }`

- [ ] **Step 1: Update imports in `EntryEditor.tsx`**

Replace the current import block at the top of `src/pages/panel/EntryEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Copy, Check, Eye, EyeOff, X, Plus, Trash2 } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import type { EntryView } from '../../shared/entry';
import { useClipboardTimer } from '../../shared/useClipboardTimer';
import { ClipboardBar } from '../../shared/ClipboardBar';
```

(Remove the `copyWithClear` import — it's no longer used directly.)

- [ ] **Step 2: Add hook call and update keyboard handler**

Inside the `EntryEditor` function body, after the existing `useState` declarations, add:
```tsx
const { copy, state: clipState, cancel } = useClipboardTimer(clearSecs);
```

Replace the keyboard shortcut `useEffect` (lines 31–46 in the original):
```tsx
useEffect(() => {
  const onKey = (ev: KeyboardEvent) => {
    if (!e || !ev.ctrlKey) return;
    const active = document.activeElement;
    const inputFocused = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (ev.key === 'c' && !inputFocused && !window.getSelection()?.toString()) {
      ev.preventDefault();
      copy(e.password, 'Password');
    } else if (ev.key === 'b' && !inputFocused) {
      ev.preventDefault();
      copy(e.username, 'Username');
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [e, copy]);
```

- [ ] **Step 3: Update the `field` helper to use `copy`**

Replace the `field` helper function inside `EntryEditor`:
```tsx
const field = (label: string, key: 'title' | 'username' | 'url' | 'password') => {
  const secret = key === 'password';
  return (
  <div className="mb-3">
    <label className="section-title block">{label}</label>
    <div className="flex gap-2 items-center">
      <input className="input flex-1" type={secret && !showPass ? 'password' : 'text'} value={e[key]} onChange={ev => setE({ ...e, [key]: ev.target.value })} />
      {secret && (
        <button className="icon-btn" aria-label={showPass ? 'Hide password' : 'Show password'} title={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(s => !s)}>
          {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      )}
      <button className="icon-btn"
        aria-label={`Copy ${label}`}
        title={key === 'password' ? `Copy ${label} (Ctrl+C)` : key === 'username' ? `Copy ${label} (Ctrl+B)` : `Copy ${label}`}
        onClick={() => copy(e[key], label)}>
        <Copy size={15} />
      </button>
    </div>
  </div>);
};
```

- [ ] **Step 4: Update custom field copy buttons**

In the `custom.map` section, change the copy button's `onClick`:
```tsx
<button className="icon-btn" aria-label={`Copy ${f.key}`} title={`Copy ${f.key}`} onClick={() => copy(f.value, f.key || 'Field')}>
  <Copy size={15} />
</button>
```

- [ ] **Step 5: Add `ClipboardBar` to the return JSX**

In the `return` statement, wrap the existing `<div className="p-4">` to add the bar above it. Replace:
```tsx
return (
  <div className="p-4">
    <div className="card">
```

With:
```tsx
return (
  <div>
    {clipState && <ClipboardBar state={clipState} onCancel={cancel} />}
    <div className="p-4">
    <div className="card">
```

And close the extra `<div>` at the very end (before the last `)`):
```tsx
    </div>
  </div>);
```

The full updated return:
```tsx
return (
  <div>
    {clipState && <ClipboardBar state={clipState} onCancel={cancel} />}
    <div className="p-4">
      <div className="card">
        {field('Title', 'title')}
        {field('Username', 'username')}
        {field('Password', 'password')}
        {field('URL', 'url')}
        <label className="section-title block">Additional fields</label>
        {custom.map((f, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <input className="input" style={{ flex: '0 0 35%' }} placeholder="Name" value={f.key}
              onChange={ev => setCustom(c => c.map((x, j) => j === i ? { ...x, key: ev.target.value } : x))} />
            <input className="input flex-1" placeholder="Value" value={f.value}
              onChange={ev => setCustom(c => c.map((x, j) => j === i ? { ...x, value: ev.target.value } : x))} />
            <button className="icon-btn" aria-label={`Copy ${f.key}`} title={`Copy ${f.key}`} onClick={() => copy(f.value, f.key || 'Field')}>
              <Copy size={15} />
            </button>
            <button className="icon-btn" aria-label="Remove field" title="Remove field" onClick={() => setCustom(c => c.filter((_, j) => j !== i))}>
              <Trash2 size={15} />
            </button>
          </div>))}
        <button className="btn-xs mb-3" aria-label="Add field" title="Add field" onClick={() => setCustom(c => [...c, { key: '', value: '' }])}>
          <Plus size={14} /> Add field
        </button>

        <div className="mb-3">
          <label className="section-title block">Expiry date</label>
          <div className="flex gap-2 items-center">
            <input className="input flex-1" type="datetime-local"
              value={expires != null ? toLocalInput(expires) : ''}
              onChange={ev => {
                const v = ev.target.value;
                setExpires(v ? new Date(v).getTime() : null);
              }} />
            {expires != null && (
              <button className="icon-btn" aria-label="Clear expiry" title="Clear expiry" onClick={() => setExpires(null)}>
                <X size={15} />
              </button>)}
          </div>
        </div>

        <div className="mb-3">
          <label className="section-title block">Created</label>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {e.created != null ? new Date(e.created).toLocaleString() : '—'}
          </span>
        </div>

        <button className="btn-primary mt-1" onClick={save}>
          <Check size={15} /> Apply changes
        </button>
      </div>
    </div>
  </div>);
```

- [ ] **Step 6: Typecheck**

```bash
rtk tsc
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
rtk git add src/pages/panel/EntryEditor.tsx
rtk git commit -m "feat: wire clipboard progress bar into panel EntryEditor"
```
