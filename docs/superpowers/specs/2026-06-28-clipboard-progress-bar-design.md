# Clipboard Clear Progress Bar

**Date:** 2026-06-28  
**Status:** Approved

## Summary

Show a progress bar in both the popup and side panel that counts down from when the user copies a password/field until the clipboard auto-clears. One shared bar per view, resets on each new copy, dismissable via × button.

## Architecture

Three new artifacts, two modified files:

| File | Change |
|------|--------|
| `src/shared/useClipboardTimer.ts` | New hook |
| `src/shared/ClipboardBar.tsx` | New component |
| `src/pages/popup/EntryCard.tsx` | `clearSecs` prop → `onCopy(text, label)` prop |
| `src/pages/popup/Popup.tsx` | Uses hook, renders bar, passes `copy` to `EntryCard` |
| `src/pages/panel/EntryEditor.tsx` | Uses hook internally, renders bar above card |

`clipboard.ts`, `Panel.tsx`, and all other files are untouched.

## Hook: `useClipboardTimer`

```ts
// src/shared/useClipboardTimer.ts
useClipboardTimer(clearSecs: number): {
  copy: (text: string, label: string) => void
  state: { label: string; progress: number } | null
  cancel: () => void
}
```

- `copy(text, label)` — calls existing `copyWithClear(text, clearSecs)`, then starts a `setInterval` at 100ms to update `progress` from 1.0 → 0.0 over `clearSecs * 1000` ms.
- `state` — `null` when inactive. `progress` is 1.0 (just copied) to 0.0 (about to clear). `label` is what was copied ("Password", "Username", field key, etc.).
- `cancel()` — writes `''` to clipboard immediately, clears interval, sets `state = null`. The original `copyWithClear` setTimeout fires later but clipboard is already `''` so its equality check is a no-op.
- When `clearSecs === 0`, `copy` writes clipboard only; bar never shows.
- Re-copying before timer expires resets: new label, `progress` back to 1.0, interval restarted.

## Component: `ClipboardBar`

```tsx
// src/shared/ClipboardBar.tsx
<ClipboardBar state={{ label, progress }} onCancel={cancel} />
```

Visual:
```
┌─────────────────────────────────────────┐
│ ██████████████░░░░░░  Password copied ✕ │
└─────────────────────────────────────────┘
```

- Full-width strip, ~28px tall.
- Background: `--primary-tint`. Fill div: `--primary`, `width: ${progress * 100}%`, `transition: width 0.1s linear`.
- Label: `"{label} copied"`, 12px, `--primary-text`.
- Dismiss: `icon-btn-xs` × button, calls `onCancel`.
- Rendered conditionally: parent renders `{state && <ClipboardBar ... />}`.

## Wiring — Popup

- `Popup` calls `useClipboardTimer(clearSecs)`.
- Renders `{state && <ClipboardBar state={state} onCancel={cancel} />}` between header and search input.
- `EntryCard` prop API change:
  - Remove: `clearSecs: number`
  - Add: `onCopy: (text: string, label: string) => void`
- Copy button labels passed to `onCopy`:
  - User button → `"Username"`
  - Pass button → `"Password"`
  - Custom fields → `f.key`

## Wiring — Panel

- `EntryEditor` calls `useClipboardTimer(clearSecs)` internally (no change to `EntryEditor`'s own props).
- Renders `{state && <ClipboardBar state={state} onCancel={cancel} />}` at top of the scrollable editor area, above the card div.
- All copy buttons call `copy(value, label)` instead of `copyWithClear(value, clearSecs)`.
- Labels:
  - `field('Title', 'title')` copy → `"Title"`
  - `field('Username', 'username')` copy → `"Username"`
  - `field('Password', 'password')` copy → `"Password"`
  - `field('URL', 'url')` copy → `"URL"`
  - Custom fields → `f.key`
- Keyboard shortcuts: Ctrl+C → `copy(e.password, "Password")`, Ctrl+B → `copy(e.username, "Username")`.

## CSS

No new CSS classes needed. Bar uses inline styles with existing CSS variables (`--primary`, `--primary-tint`, `--primary-text`) and existing `icon-btn-xs` class for the dismiss button.
