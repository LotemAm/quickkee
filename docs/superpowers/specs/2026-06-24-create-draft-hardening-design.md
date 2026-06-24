# Create-form draft hardening — design

Date: 2026-06-24

## Problem

The browser-action popup unmounts whenever it loses focus. The "New entry"
create form lives in `src/pages/popup/CreateForm.tsx`, so all of its state was
lost the moment the popup closed. Concretely: copy the generated password,
switch to the page's register form to paste it, and reopening the popup
re-mounts the form — regenerating a brand-new password and discarding the typed
username and selected group.

A previous agent added `src/shared/createDraft.ts` and wired it into
`CreateForm.tsx` to persist a draft to `chrome.storage.session`. That fixes the
core symptom but leaves several gaps:

1. **Draft outlives the unlocked vault.** `doLock()` (manual lock, auto-lock,
   `onSuspend`, `onStartup`) does not clear the draft, so a plaintext-password
   draft survives a lock. Because `loadDraft` matched **by URL only**, unlocking
   a *different* `.kdbx` on the same site could resurrect a foreign vault's
   draft (wrong password + wrong group).
2. **Stale `groupId` on restore.** A restored `groupId` may no longer exist in
   the current vault's `groups`, leaving the `<select>` in an invalid state and
   risking a create against a missing group.
3. **Single global draft slot.** The draft is stored under one fixed key, so a
   draft on site A is clobbered the moment the user starts a draft on site B.
   Concurrent per-site drafts are not supported.
4. **No abandonment handling.** A draft persists indefinitely (until create or
   browser close) and is silently resurrected on the next visit.
5. **No UI signal.** The user has no indication that a restored draft is in play
   or that drafts are discarded after inactivity.

## Goals

- Preserve the working core fix (state survives popup close).
- Keep plaintext password drafts from outliving the unlocked session.
- Support independent drafts per site.
- Discard abandoned drafts after 10 minutes of inactivity (timer resets on every
  edit / reopen).
- Show a discreet "Draft restored" indicator with a Discard action and a hint
  that drafts expire.

## Design

### 1. `src/shared/createDraft.ts` — per-site map with expiry

- `CreateDraft` gains `savedAt: number` (epoch ms).
- `const DRAFT_TTL_MS = 10 * 60 * 1000;`
- Storage shape changes from a single draft to a map under one session key:
  `KEY → Record<string, CreateDraft>` keyed by `url`.
- `saveDraft(d)`: read the map, set `map[d.url] = { ...d, savedAt: Date.now() }`,
  prune any entries whose `savedAt` is older than `DRAFT_TTL_MS` (bounds map
  growth), and write the map back. Stamping `savedAt` on every write means the
  10-minute clock resets on each edit.
- `loadDraft(url)`: read the map and return `map[url]` only if
  `Date.now() - savedAt <= DRAFT_TTL_MS`; otherwise return `null`. Stale entries
  are removed on the next `saveDraft` prune.
- `clearDraft(url)`: remove a single url's entry from the map (called after a
  successful create — other sites' drafts remain intact).
- `clearAllDrafts()`: remove the whole key (called on lock).

`chrome.storage.session` is in-memory and never written to disk, which is the
correct place for a plaintext password draft.

### 2. Clear all drafts on lock

`doLock()` in `src/pages/background/index.ts` calls `void clearAllDrafts()`.
This covers manual lock, auto-lock, `chrome.runtime.onSuspend`, and
`chrome.runtime.onStartup`. A draft therefore never outlives the unlocked
session, and unlocking a different vault on the same URL cannot resurrect a
foreign draft.

### 3. Validate restored `groupId` (CreateForm.tsx)

In the restore branch of the mount effect, set `groupId` to `d.groupId` only if
`groups.some(g => g.groupId === d.groupId)`; otherwise fall back to
`defaultGroupId`.

### 4. "Draft restored" indicator (CreateForm.tsx)

- New state `restored: boolean`, set `true` **only** in the restore branch of
  the mount effect (when a saved draft was actually loaded). Fresh start leaves
  it `false`.
- Render a discreet pill near the top of the card:
  **"Draft restored · discarded after 10 min away"** with a small **Discard**
  control. Styling reuses existing tokens (`var(--surface-2, var(--bg))`,
  `var(--text)`) and a lucide icon, matching the existing rules panel.
- **Discard** action: `await clearDraft(url)`, reset the form to fresh state
  (`setTitle('')`, `setUsername('')`, `setGroupId(defaultGroupId)`,
  `setEntryUrl(baseUrl(url))`, `setOpts(pwgen)`, `regenerate(pwgen)`), and
  `setRestored(false)`. The persist effect will then write a fresh draft for the
  current url, which is expected.
- The badge hides after Discard or after a successful create. It may remain while
  the user edits a restored draft — that is accurate.

Rationale for not using a live countdown: the TTL is only evaluated across popup
reopens (in `loadDraft`). While the popup is open the form is fully usable
regardless of age, so a ticking "expires in…" timer would hit zero while the
form still works — misleading. A static restored-state badge is honest.

### 5. Lint hygiene

The run-once mount effect intentionally reads `url` / `pwgen` / `defaultGroupId`
with an empty dependency array (re-running on those would wipe an in-progress
draft). Add a scoped `// eslint-disable-next-line react-hooks/exhaustive-deps`
rather than widening the dependency array.

## Testing

Vitest with the existing `chrome.storage` mock.

`createDraft` unit tests:
- save → load round-trip returns the draft.
- two different URLs are stored independently (no clobber).
- `loadDraft` for an unknown url returns `null`.
- an entry with `savedAt` older than the TTL returns `null` and is pruned on the
  next `saveDraft`.
- `clearDraft(url)` removes only that url's entry; others remain.
- `clearAllDrafts()` empties the store.

CreateForm: if popup component tests exist, add restored-shows-badge and
discard-resets-and-clears cases; otherwise keep the logic testable and verify
the badge manually.

## Out of scope

- Live countdown timer (misleading while the popup is open).
- Per-vault identity tagging on the draft (clear-on-lock already prevents
  cross-vault resurrection — YAGNI).
- Clearing the draft on popup blur/close (would reintroduce the original bug,
  since tabbing to the page register form is itself a blur).
