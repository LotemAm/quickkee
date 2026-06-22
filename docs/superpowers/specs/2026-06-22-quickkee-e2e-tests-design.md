# QuickKee Playwright E2E Test Suite — Design

**Date:** 2026-06-22
**Status:** Approved, pending implementation plan
**Goal:** Automate the README "Manual Verification Checklist" (7 steps) as Playwright E2E tests, run them, and write fix plans for every issue they surface.

## Background

QuickKee is a Chrome MV3 extension (Vite + React + TypeScript, `kdbxweb`, File System Access API). It has 12 unit tests (vitest) but no E2E coverage. The 7-step manual checklist in `README.md` is the acceptance surface we want to automate.

Several checklist steps cross browser boundaries Playwright cannot drive directly:

- **`showOpenFilePicker`** (File System Access API) opens a native OS dialog. Playwright drives `<input type=file>` choosers only, **not** FSA pickers. This gates every unlock step.
- **Toolbar badge** (text/color) is browser chrome, not page DOM — not readable via page selectors.
- **Bad-cert detection** runs in the service worker via `webNavigation` on real broken-TLS navigations.
- **Auto-close timer** (up to 1h) and **KeePassXC round-trip** depend on time / an external app.

The design closes these gaps with **test-only seams** in the extension (guarded so they never ship) plus hermetic local fixtures, so all 7 steps run as true end-to-end against the real built extension where possible.

## Decisions (from brainstorming)

1. **Picker** — add a test-only bypass seam that injects the fixture `.kdbx` (bytes / fake handle) instead of calling `showOpenFilePicker`.
2. **Badge** — assert **both** the visible badge (via `chrome.action`) and the underlying matcher state (count, cert flag).
3. **Bad cert** — produce broken TLS with a **local self-signed HTTPS server** (hermetic, offline).
4. **Externals** — verify save persistence by **re-reading the `.kdbx` with kdbxweb** (KeePassXC equivalent); verify auto-close via a **test-guarded short duration / direct lock trigger**.

## Architecture

### Runner & extension loading
- Add `@playwright/test` (dev dependency).
- Launch a **persistent Chromium context**, **headed / new-headless** (MV3 extensions do not load under old headless), loading the real build:
  - `--disable-extensions-except=<dist_chrome>` and `--load-extension=<dist_chrome>`.
- Resolve the extension id from the registered service worker (`context.serviceWorkers()` / `waitForEvent('serviceworker')`).
- Drive UI pages by navigating to `chrome-extension://<id>/src/pages/popup/index.html` (and `panel`, `options`).
- npm scripts:
  - `build:chrome:test` — seam-enabled build (sets `VITE_QK_TEST`).
  - `test:e2e` — runs `build:chrome:test` then `playwright test`.

### Test seam (guarded, never ships)
A single module gated on `import.meta.env.VITE_QK_TEST`. The normal `build:chrome` leaves the flag unset, so the seam is dead-code-eliminated and never ships. Provides:

- **Picker bypass** — a test code path in `pickAndStoreDb` that stores the fixture `.kdbx` (bytes or a fake `FileSystemFileHandle`) and skips `showOpenFilePicker` / `ensurePermission`.
- **SW test message handler** — responds to a test message by returning:
  - the visible badge via `chrome.action.getBadgeText` / `getBadgeBackgroundColor`, **and**
  - matcher state (match count, cert-error flag).
- **Autolock control** — a settable short auto-close duration and a direct lock trigger.

All seam entry points are behind the flag and assert no-op when unset.

### Fixtures
- Reuse `src/test/fixtures/test.kdbx`. Reseed entries so their URLs match the local fixture web server origins (password is `correct horse`).
- **Local fixture web server** (started by the Playwright test fixture):
  - A plain HTTP/HTTPS page with a login form, served at a **matching** origin and a **non-matching** origin (for badge / autofill / create flows).
  - A **self-signed HTTPS** server for the cert-warning test.
- A small kdbxweb re-read helper to assert persisted writes.

### Specs (one file per checklist step)

| # | Spec | Real assertion |
|---|------|----------------|
| 1 | `unlock.spec` | inject fixture via seam, enter password → vault opens in popup |
| 2 | `saved-site.spec` | matching fixture origin → badge count via `chrome.action` **and** matcher state; **Copy** field → `navigator.clipboard.readText()`; **Autofill** → username/password fields filled |
| 3 | `unsaved-site.spec` | non-matching origin → empty popup; **Create** + **Save**; **re-read `.kdbx`** asserts entry; revisit → badge `1` |
| 4 | `panel-save.spec` | open panel, edit a field, **Save** → dirty indicator clears; **kdbxweb re-read** asserts the edit persisted (KeePassXC equivalent) |
| 5 | `options.spec` | change auto-close hours + theme, reload, assert persisted in `chrome.storage.local` |
| 6 | `autolock.spec` | seam sets short duration, unlock, trigger/wait → popup shows "Vault locked"; re-unlock succeeds |
| 7 | `cert-warning.spec` | navigate the local self-signed HTTPS origin → red `!` badge via `chrome.action` **and** matcher cert flag set |

### Data flow
1. Test fixture builds (`build:chrome:test`) once, starts the local web server(s), launches the persistent context with the extension.
2. Each spec injects the vault via the seam, navigates a fixture origin, drives a popup/panel/options page, and asserts via DOM, `chrome.storage.local`, the SW test handler (badge + matcher), and/or a kdbxweb re-read of the `.kdbx`.
3. Teardown closes the context and stops the servers.

### Error handling
- Extension-id / service-worker resolution waits with a bounded timeout and a clear failure message.
- Each spec is independent (own injected vault state); no cross-spec ordering.
- Genuine browser-boundary limits (anything that truly cannot be automated) are documented as **known limitations**, not reported as failures.

## Run + fix-plan phase

After the suite is built, run it. For **each failure**, write a separate plan document under `docs/superpowers/plans/2026-06-22-<spec>-fix.md` containing root cause and concrete fix steps — no blind fixes. Distinguish:

- **Product bugs** → fix plan.
- **Test/seam bugs** → fix plan against the test code.
- **Browser-boundary gaps** → documented limitation, not a failure.

## Scope / YAGNI

- Chrome only (matches MVP scope). No Firefox E2E.
- No CI wiring in this pass (headed run locally); CI hardening deferred.
- Seam covers only what the 7 steps need; no general test API.

## Success criteria

- `test:e2e` builds the seam-enabled extension and runs all 7 specs against the real build.
- Each checklist step is asserted at the level agreed above (visible badge **and** matcher state where badges apply; kdbxweb re-read for persistence).
- Every failing run has a corresponding fix-plan doc; every un-automatable point is a documented limitation.
