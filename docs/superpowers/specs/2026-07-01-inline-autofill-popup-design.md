# Inline Autofill Popup — Design

## Problem

The content script (`src/pages/content/index.tsx`) currently has no page-facing UI. It only
listens for a `fill` message sent when the user clicks "Autofill" in the extension popup.
There is no in-page credential picker — the kind of dropdown users expect from a password
manager (LastPass/1Password/Bitwarden style) when they click into a login field.

## Trigger & Data Flow

```
user focuses <input> (username or password field)
  -> content script's focusin listener fires
  -> findLoginFields(document) locates the field pair on the page
  -> isLoginField(focusedEl, fields) confirms the focused el is one of them
  -> content script sends getEntriesForUrl to background (existing message type)
  -> background: vault locked            -> reply carries no usable entries -> popup stays hidden
  -> background: vault open, no match    -> reply { entries: [] }           -> popup stays hidden
  -> background: vault open, >=1 match   -> reply { entries: [...] }        -> popup shown
```

On `focusout` (when the new focus target isn't inside the popup) the popup hides, with a short
delay so a `mousedown` on a popup row (which fires before the field's blur commits) can still
register a selection first.

Vault-locked and no-match cases are indistinguishable from the page's point of view — both
just mean "nothing shown." This avoids leaking "you have a saved login here" to the host page
when locked.

## Popup UI & Selection

- A shadow DOM host (`<div data-quickkee-popup>`) is appended to `document.body`, positioned
  `absolute` under the focused field using `getBoundingClientRect()` + scroll offsets, width
  matching the field's width (minimum).
- Lists matching entries as title (bold) + username (dim) — same shape as the existing
  `EntryView` subset already returned by `getEntriesForUrl`.
- **Mouse:** rows use `mousedown` (not `click`), calling `preventDefault()` so the field doesn't
  lose focus before selection completes.
- **Keyboard:** Up/Down moves a highlighted row (wrapping), Enter selects the highlighted row
  (first row highlighted by default on open), Escape closes the popup and refocuses the field.
- Selecting an entry fetches the full entry via `getEntry` (the list response omits password),
  then calls `fillFields(fields, entry.username, entry.password)` — the same fill logic already
  used by the popup's "Autofill" button — and closes the popup.

## Files Touched

- `src/content/detect.ts` — add `isLoginField(el, fields)` helper.
- `src/content/inlinePopup.ts` — new. Shadow DOM render/hide, keyboard nav, row selection
  callback.
- `src/pages/content/index.tsx` — add `focusin`/`focusout` document listeners wiring
  detect -> fetch entries -> show/hide popup. Existing `fill` message listener (used by the
  popup button path) is unchanged.

## Error Handling

- Locked vault, no matching entries, or a failed message send (e.g. service worker asleep and
  failing to wake) all resolve to "don't show the popup." No error is ever surfaced on the host
  page.
- Multiple forms on one page: out of scope. Keeps existing `detect.ts` behavior (first
  password field found wins).

## Testing

- Unit test: `isLoginField` in `detect.test.ts`.
- New Playwright spec `tests/e2e/specs/inline-popup.spec.ts`:
  1. Focus the username field on the existing two-field fixture page -> popup appears with the
     matching entry -> click it -> both fields filled.
  2. Focus the email field on the single-step (`/single`) fixture page -> popup appears there
     too -> click it -> field filled.

## Out of Scope

- Multiple forms per page.
- Multiple candidate credential sets requiring search/filter inside the popup (list is shown
  as-is, unsorted beyond whatever `getEntriesForUrl` already returns).
- Any UI for the locked-vault state (silent, per decision above).
