# QuickKee — MVP Design (Spec 1 of 2)

**Date:** 2026-06-21
**Status:** Approved for planning
**Template:** [vite-web-extension](https://github.com/JohnBra/vite-web-extension) (React 19 + TypeScript + Tailwind 4 + Vite, Manifest V3)

## Overview

QuickKee is a browser extension for opening and managing KeePass (`.kdbx`) databases. This spec covers the **MVP**: a fully local-file workflow on Chrome. Cloud storage (Dropbox / Google Drive), conflict reconciliation, offline caching, and the Firefox build are deferred to **Spec 2**.

### Scope decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Phasing | MVP local-first; cloud sync later | De-risk the hardest piece (cross-device conflict reconciliation) into its own spec |
| File access | File System Access API + persisted `FileSystemFileHandle` | Lets edits write back to the same on-disk file; Chrome-only API |
| Session model | Background service worker holds the unlocked DB + key, with keepalive | Only MV3 context that survives across popup/sidebar/tab navigation |
| Save timing | Explicit Save with dirty indicator | Maps cleanly onto the future cloud-sync/conflict flow; user controls writes |
| KeePass engine | `kdbxweb` (Argon2 via WASM) | Only mature browser-side `.kdbx` library |
| Entry ↔ site matching | Registrable domain (eTLD+1) of the entry URL field | Practical default for icon badge, popup list, and autofill |
| Browser | Chrome-first | Firefox lacks the File System Access API (deferred) |

## Architecture

Three runtime contexts, with the background service worker as the single source of truth for all secrets and file I/O.

```
┌─ Background Service Worker (the vault owner) ─────────────┐
│  • Holds decrypted KdbxDatabase + master key in memory   │
│  • kdbxweb: open / parse / edit / save                   │
│  • FileSystemFileHandle (from IndexedDB) for read+write  │
│  • Keepalive (chrome.alarms + port) to resist idle death │
│  • Auto-lock timer (X hrs), lock-on-browser-close        │
│  • Per-tab URL→entry matching → sets icon color + badge  │
└──────────────▲───────────────────────▲──────────────────┘
       messaging│                       │messaging
┌──────────────┴──────┐   ┌─────────────┴──────────────────┐
│ Popup (icon)        │   │ Side Panel                     │
│ • quick search/view │   │ • full browse/edit groups +    │
│ • copy fields       │   │   entries, additional fields   │
│ • autofill button   │   └────────────────────────────────┘
│ • create-entry form │   ┌────────────────────────────────┐
└─────────────────────┘   │ Content Script (per page)      │
                          │ • detect user/pwd fields       │
                          │ • receive autofill payload     │
                          │ • report form presence         │
                          └────────────────────────────────┘
```

UI contexts (popup, side panel, content script) are **stateless views**. They never hold the master key. They message the service worker for everything and render the response.

### Message contract (service worker API)

Typed request/response union in `src/shared/messages.ts`:

- `unlock { handleId, masterPassword?, keyFileBytes? }` → `{ ok } | { error }`
- `lock {}` → `{ ok }`
- `getStatus {}` → `{ locked: boolean, dbName?, dirty: boolean }`
- `getEntriesForUrl { url }` → `EntryView[]`
- `getEntry { entryId }` → `EntryView` (includes additional fields)
- `getTree {}` → group/entry tree for the side panel
- `createEntry { groupId, fields }` → `{ entryId }`
- `updateEntry { entryId, fields }` → `{ ok }`
- `updateGroup { groupId, fields }` → `{ ok }`
- `save {}` → `{ ok } | { error }`
- `generatePassword { opts? }` → `{ password }`
- `fillRequest { entryId, tabId }` → `{ ok }`

`EntryView` carries only what the UI needs to display (title, username, URL, additional fields, expiry flag). Secrets are sent on demand, never broadcast.

## Components

Module layout inside the template's `src/`:

```
src/
  background/
    index.ts            # SW entry, message router, keepalive, alarms
    vault.ts            # kdbxweb wrapper: open/save/edit, holds DB + key
    fileHandle.ts       # IndexedDB-persisted FileSystemFileHandle + re-grant
    matcher.ts          # URL → matching entries (registrable domain)
    autolock.ts         # auto-close timer + lock-on-close
    icon.ts             # per-tab badge text + color
  pages/
    popup/              # quick search, entry list, copy, autofill, create-form
    panel/              # full tree browse + edit (side panel)
    options/            # settings: auto-close hrs, default pwd gen, theme
  content/
    index.ts            # field detection + fill executor
  shared/
    messages.ts         # typed message contract (request/response union)
    entry.ts            # EntryView / tree view-model types
    pwgen.ts            # password generator (shared by SW + create-form)
    clipboard.ts        # copy + auto-clear timer
    theme.ts            # dark / light
```

## Unlock & credentials

KeePass uses a composite master key. Supported combinations (all browser-feasible):

1. Master password only
2. Key file only
3. Password + key file

Built via `kdbxweb.Credentials(ProtectedValue?, keyFileBytes?)` — both arguments optional.

- Key file is chosen with a file picker; its bytes are used for that unlock only and are **not** persisted as a secret.
- Unlock UI: a "use key file" toggle plus an optional password field. Validation requires at least one factor.
- The database file itself is selected with `showOpenFilePicker`; its `FileSystemFileHandle` is persisted in IndexedDB so future opens and saves target the same on-disk file (permission re-granted per session).

**Out of scope (extensions cannot access these factors):** Windows user-account key and YubiKey challenge-response. A YubiKey factor would require a native-messaging host — deferred, flag if it becomes a hard requirement.

## Key flows

1. **Unlock** — popup/panel → `unlock` → SW reads the file via the persisted handle, `kdbxweb.Kdbx.load`, holds the DB in memory, starts the auto-lock timer → `{ ok }`. The key never leaves the SW.
2. **Browse popup on a site** — on tab update the SW computes matching entries (for icon color + badge count). The popup requests the same set and renders, per entry: username, copy-username / copy-password buttons, a collapsible section exposing all additional fields (each with a copy button), an autofill button, and an expired marker (`entry.times.expiryTime`). Above the list: quick search.
3. **Site without a saved entry** — popup shows quick search, then a create-entry form below it: password pre-filled from the generator default, URL pre-filled to the current site.
4. **Autofill** — popup → `fillRequest { entryId, tabId }` → SW sends the fill payload to that tab's content script → content script locates the username/email and password fields, sets values, and dispatches `input`/`change` events.
5. **Edit / create** — panel/popup mutate the in-memory DB via `updateEntry` / `createEntry` / `updateGroup`. Changes are held in memory and marked **dirty**. An explicit **Save** writes the serialized `.kdbx` back through the file handle.
6. **Copy with auto-clear** — UI copies the field value locally via `clipboard.ts`, which starts a configurable clear timer.

## Settings (options page)

- Auto-close database after X hours (selected from a list)
- Default generated-password settings (length, character classes)
- Theme: dark / light
- Clipboard auto-clear delay

## Security

- Master key and decrypted DB exist **only** in service-worker memory. UI contexts request specific entry data on demand and never cache the key.
- `chrome.storage.session` (memory-only, cleared on browser close) holds non-secret session state (unlock status, active handle id). No secrets are written to `local` or `sync` storage.
- Auto-lock: timer (X hours from settings) **and** lock-on-browser-close wipe the DB + key from the SW and clear session storage.
- Clipboard auto-clear after copy (configurable delay).
- File-handle re-grant: when `queryPermission !== 'granted'`, prompt to re-grant before reading/saving.
- **Bad-certificate warning:** MV3 extensions cannot inspect the live TLS chain. Scoped feasible signal: warn on cert-error navigations via `chrome.webNavigation` / `webRequest` error events. This is "warn on cert-error navigations," not full chain inspection.

## Error handling

- Wrong master password / bad key file → `kdbxweb` throws → typed `{ error: 'badCredentials' }`. No lockout (local file).
- File handle revoked or missing → prompt to re-pick the file.
- Save failure (permission / IO) → keep the dirty state, surface the error, never drop edits.
- Corrupt or unsupported `.kdbx` → explicit error; the SW does not crash.

## Testing

- **Unit (Vitest):** `vault.ts` open/edit/save round-trip against a fixture `.kdbx`; `matcher.ts` URL-matching cases; `pwgen.ts`; `clipboard.ts` auto-clear timing.
- **Component (React Testing Library):** popup states (site-with-entries / site-without-entries / locked); panel edit forms.
- **Manual E2E checklist:** content-script autofill across several real login forms (full automation is impractical under MV3).

## Deferred to Spec 2

- Dropbox and Google Drive open + save
- Offline local cache of cloud databases
- Conflict reconciliation across devices (compare against local cache on open)
- Firefox build (File System Access API alternative or download-to-save fallback)
- Optional: YubiKey challenge-response via native-messaging host
