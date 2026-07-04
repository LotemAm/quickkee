# QuickKee

KeePass-compatible browser extension (Chrome MV3) that works with local `.kdbx` databases. Unlock your passwords on demand, autofill login forms, and manage entries directly from the browser.

## Requirements

- **Node.js** + **Yarn** (for building)
- **Chrome 114+** (MV3 support with side panel API)

## Build

```bash
yarn install
yarn build:chrome
```

The production build outputs to `dist_chrome/`. To run the full unit test suite:

```bash
yarn test
```

## Load as Unpacked Extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist_chrome/` folder

The extension icon appears in your toolbar.

## Usage

### First Run
On first use, the popup prompts you to open a `.kdbx` database file from your local filesystem. Select a KeePass database and unlock it with your master password and/or key file.

### Per-Site Matching
- Visit any website → the extension badge shows a count (green icon) if matching entries exist in your vault
- Badge is gray (no match) or shows an error indicator (red `!` for HTTPS certificate issues)

### Popup & Browsing
- Click the extension icon to open the popup
- Browse all entries in the vault
- **Copy** additional fields to clipboard (username, URLs, notes, custom fields)
- **Autofill** login forms automatically (detects username/password fields)
- **Create** a new entry for the current site (if no match exists)

### Side Panel
- Open the side panel for full database tree browsing
- Edit entries and groups directly in the panel
- Click **Save** to persist changes back to the `.kdbx` file
- A dirty indicator shows unsaved edits
- Verify persistence by reopening the database in KeePassXC or KeePass

### Options & Settings
Access `chrome://extensions → QuickKee → Details → Extension options` to configure:
- **Auto-close hours**: How long before the vault locks automatically. Options: 1 / 2 / 4 / 8 / 24 hours (default: 8).
- **Clipboard auto-clear**: Seconds before copied passwords are cleared. Options: never / 15 / 30 / 60 (default: 30).
- **Default password generator**: Length and character sets (lowercase, uppercase, digits, symbols)
- **Dark/Light theme**: UI appearance preference

All settings are persisted in `chrome.storage.local`.

### Cloud Sync
Instead of a local file, the vault can be opened from a connected Dropbox or Google Drive account:
- In **Options**, click **Connect** next to a provider and authorize via OAuth (PKCE); pick a `.kdbx` file from the resulting list to open it
- The popup shows a sync badge: **Synced**, **Pending upload** (local edits haven't reached the cloud yet), or **Offline** (working from the local cache; changes sync once back online)
- If a remote change and a local edit both happened since the last sync, they're merged automatically on the next save instead of one overwriting the other
- Click **Sign out** next to a provider in **Options** to disconnect it and remove its stored tokens

## Scope

This is a KeePass-compatible password manager for Chrome (Manifest V3). It supports both local `.kdbx` files and cloud-hosted ones (Dropbox, Google Drive) — see [Cloud Sync](#cloud-sync) above.

**Not yet supported**:
- **Firefox**: build config exists (`vite.config.firefox.ts`) but is untested; Chrome is the only supported browser today.

**Security**: Master password and key material are held only in the service worker's memory while unlocked. When you lock the vault or the extension auto-closes, all sensitive data in memory is cleared. Settings in `chrome.storage.local` contain no secrets—only non-sensitive preferences (theme, auto-close duration, etc.). Cloud sync stores OAuth **refresh tokens** in `chrome.storage.local` so reconnecting after a browser restart doesn't require re-authorization. These tokens grant access only to the app-scoped cloud files (the `.kdbx` itself stays encrypted with your master key); use **Sign out** in Options to remove them. They are not encrypted at rest—this is a Chrome extension platform limitation.

Firefox support is the main remaining item from the original spec — see `SPEC.md`.

## Manual Verification Checklist

The following 7 steps verify end-to-end functionality. Perform these manually after loading the unpacked extension:

1. **First run & unlock**
   - Click the extension icon
   - Popup asks to open a `.kdbx` file
   - Select a real KeePass database
   - Unlock with password (and key file if your database uses one)
   - Vault successfully opens in the popup

2. **Saved-site entry: badge, copy, autofill**
   - Navigate to a website with a matching entry in your vault (e.g., GitHub, Gmail)
   - Confirm the badge shows a green icon with a count (e.g., `1`)
   - Click the popup; entry is listed
   - Click **Copy** on a field → verify it's copied to clipboard
   - Click **Autofill** → verify username/password auto-fills in the login form

3. **Unsaved-site entry: create, save, revisit**
   - Navigate to a website **not** in your vault (e.g., a test site)
   - Click the popup; confirm no entries listed
   - Click **Create**; fill in username/password/URL
   - Click **Save** → entry is created and saved to the `.kdbx`
   - Revisit the same site → badge shows green with count `1`
   - Entry appears in the popup

4. **Side panel: edit, Save, KeePassXC round-trip**
   - Open the side panel (via extension menu or toolbar)
   - Browse the database tree, find an entry
   - Edit a field (e.g., change a password or note)
   - Click **Save** → confirm dirty indicator clears and file is updated
   - Open the same `.kdbx` in KeePassXC or KeePass
   - Verify the edit is present

5. **Options: change settings, verify persistence**
   - Open extension options (`chrome://extensions → QuickKee → Details → Options`)
   - Change auto-close hours to `12` or another value
   - Change theme to dark or light
   - Click save (if applicable)
   - Reload the extension or browser tab
   - Confirm settings are preserved

6. **Auto-close locks the vault**
   - In options, set auto-close to `1` hour (or temporarily use `0.1` for 6 minutes)
   - Unlock the vault
   - Wait past the auto-close time (or manually trigger via dev tools if using short timeout)
   - Click the popup → confirm "Vault locked" message
   - Unlock again with password

7. **Bad-certificate warning**
   - Navigate to an HTTPS website with an invalid or self-signed certificate
   - Confirm the extension badge shows a red `!` icon (or alternate error indicator)
   - This confirms certificate validation is active

All steps passing indicate MVP readiness.

## Automated E2E (Playwright)

The manual checklist above is mirrored by a Playwright suite that drives the
real unpacked extension in Chromium. Test-only seams (gated on `VITE_QK_TEST`,
stripped from `yarn build:chrome`) bypass the native file picker, expose
service-worker badge/match state, and serve local HTTP + self-signed HTTPS
fixtures.

```bash
yarn test:e2e
```

This builds the seam-enabled extension (`yarn build:chrome:test`) and runs all
specs (`tests/e2e/specs/`). Notes:

- Runs **headed** — MV3 extensions don't load under legacy headless.
- Save/persistence is verified by re-reading the `.kdbx` with kdbxweb (the
  KeePassXC round-trip equivalent); the bad-cert badge is exercised against a
  local self-signed HTTPS server; auto-close uses the real timer with a
  sub-second duration.
- The seam never ships: `yarn build:chrome` strips it, verified in CI-style by
  asserting `dist_chrome/` contains no `__qkTest`.

Running the suite surfaced one release blocker — Argon2 unlock failed in a real
browser because the manifest lacked a CSP permitting WebAssembly. Fixed and
documented in `docs/superpowers/plans/2026-06-22-unlock-csp-wasm-fix.md`.
