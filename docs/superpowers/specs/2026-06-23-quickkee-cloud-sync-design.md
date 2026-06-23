# QuickKee — Cloud Sync Design (Spec 2 of 2)

**Date:** 2026-06-23
**Status:** Approved for planning
**Builds on:** [Spec 1 — MVP](./2026-06-21-quickkee-mvp-design.md) (local-file Chrome MVP, shipped)

## Overview

Spec 2 adds **cloud sync** to QuickKee: open and save `.kdbx` databases from
Dropbox and Google Drive, with an offline local cache and cross-device conflict
reconciliation. It is the cohesive subsystem deferred from Spec 1.

The Firefox build and the optional YubiKey/native-messaging factor remain
deferred to their own future specs — they are orthogonal to cloud sync and are
**out of scope here**.

### Scope decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Providers | Dropbox **and** Google Drive, behind one `CloudProvider` interface | Same OAuth/download/upload shape; build both now, no rework later |
| Auth | OAuth 2.0 **PKCE**, public client (no secret), `chrome.identity.launchWebAuthFlow` | Standard for installed/public apps; both providers support it |
| Token persistence | Refresh token in `chrome.storage.local`; access token in memory/session | Silent reconnect across browser restarts; token is per-extension sandboxed |
| Active DB | **One active DB, any source** (local file, Dropbox, or Drive) | Smallest change to MVP single-DB vault |
| Conflict handling | **Auto-merge** via kdbxweb `db.merge()`, non-blocking notify | KeePass-native lossless merge; no manual conflict UI |
| Offline save | Write cache + defer upload (`pendingUpload`), retry on reconnect | Edits never lost if offline at save time |
| Cache contents | KeePass-**ciphertext** bytes only | `.kdbx` is encrypted at rest; cache leaks no extra secret, never the master key |

## Architecture

The background service worker remains the single owner of the decrypted DB and
master key (unchanged from Spec 1). Spec 2 introduces a **`DbSource`**
abstraction for *where the encrypted bytes live* and a **sync orchestrator**
for the cloud open/save/merge dance.

```
┌─ Background Service Worker (vault owner) ─────────────────────────┐
│  vault.ts   decrypted KdbxDatabase + master key (in memory only)  │
│             now DbSource-aware                                     │
│  sync.ts    open / save / merge / conflict orchestration          │
│  cache.ts   IndexedDB cloud cache (ciphertext + revision state)   │
│  sources/                                                          │
│    cloudProvider.ts   interface + RemoteFile types                │
│    dropbox.ts / gdrive.ts   one impl each                         │
│    oauth.ts           PKCE flow + token store / refresh           │
└──────────────▲────────────────────────────────────────────────────┘
       messaging│
   Popup / Side Panel / Options (stateless views)
   • source picker: local file | Dropbox | Drive
   • pending-sync + conflict indicators
   • connected accounts / sign out (options)
```

### DbSource

Exactly one active source at a time:

```ts
type DbSource = LocalFileSource | CloudFileSource

interface LocalFileSource { kind: 'local'; handleId: string }      // Spec 1 path, unchanged
interface CloudFileSource {
  kind: 'cloud'
  provider: 'dropbox' | 'gdrive'
  fileId: string
  basedOnRev: string      // remote revision the in-memory DB descends from
}
```

The MVP local-file flow is untouched; cloud is a sibling source. Switching
source = opening a different DB.

### CloudProvider interface

One implementation per provider (`dropbox.ts`, `gdrive.ts`):

```ts
interface RemoteFile { fileId: string; name: string; rev: string }

interface CloudProvider {
  auth(): Promise<void>                                  // PKCE via launchWebAuthFlow
  listKdbxFiles(): Promise<RemoteFile[]>                 // pick a .kdbx in the provider
  download(fileId: string): Promise<{ bytes: ArrayBuffer; rev: string }>
  getRevision(fileId: string): Promise<string>           // cheap metadata-only fetch
  upload(fileId: string, bytes: ArrayBuffer, basedOnRev: string):
    Promise<{ ok: true; rev: string } | { ok: false; conflict: true }>
}
```

`rev` source per provider:
- **Dropbox:** `rev` (or `content_hash`) from `files/get_metadata`; upload via
  `files/upload` with `mode: { ".tag": "update", update: basedOnRev }`.
- **Google Drive:** `headRevisionId` (or `md5Checksum`) from `files.get`;
  conditional upload guarded by re-checking `headRevisionId` before
  `files.update`.

## Cache & token storage

### Cloud cache (IndexedDB)

One record per cloud file, key `"{provider}:{fileId}"`:

```ts
interface CacheRecord {
  bytes: ArrayBuffer       // KeePass ciphertext (encrypted at rest)
  basedOnRev: string       // remote rev these bytes descend from
  lastSyncedAt: number
  pendingUpload: boolean   // local edits not yet pushed to remote
}
```

- Open offline → load `bytes` from cache and unlock normally.
- The cache stores ciphertext only; the master key is never written to disk.

### Tokens

- Refresh token → `chrome.storage.local` (per-extension sandbox).
- Access token → memory / `chrome.storage.session`, refreshed on demand.

## Sync flows

### Open (cloud source)

1. `getRevision(fileId)`.
2. If `rev === cache.basedOnRev` → load `cache.bytes` (no download).
3. Else `download(fileId)`:
   - `cache.pendingUpload === false` → **fast-forward**: replace cache bytes +
     `basedOnRev`, load remote.
   - `cache.pendingUpload === true` → **conflict**: merge the cached local DB
     against the freshly downloaded remote (see Merge), then present the merged
     DB; mark cache pendingUpload until the merge result is uploaded.
4. Offline / `getRevision` fails → load `cache.bytes`, set/keep
   `pendingUpload` as-is, surface offline state.

### Save (cloud source)

1. Serialize in-memory DB → write `cache.bytes`, set `pendingUpload = true`.
   (Edits are now durable locally regardless of network.)
2. Attempt upload:
   - `getRevision === basedOnRev` → `upload`. On success set
     `basedOnRev = newRev`, `pendingUpload = false`.
   - remote rev changed **or** provider returns `conflict` →
     `download` remote → `localDb.merge(remoteDb)` → re-serialize →
     `upload` the merged bytes → set new `basedOnRev`, clear `pendingUpload` →
     **notify** (non-blocking) "Merged changes from another device."
   - offline / API error → leave `pendingUpload = true`; retry on reconnect
     (`navigator.onLine` event + `chrome.alarms`) and before the next
     open/save.

### Merge

`kdbxweb` `db.merge(remoteDb)` performs KeePass-native reconciliation using
per-object history and modification timestamps; deletions tracked via
`deletedObjects`. Both DBs descend from a shared file, so object UUIDs line up.
The merge is lossless under KeePass semantics — a union with
timestamp-based resolution. The result is re-serialized and uploaded.

## Auth / OAuth

- PKCE, no client secret. Redirect URI = `chrome.identity.getRedirectURL()`
  (`https://<extension-id>.chromiumapp.org/`).
- Public client IDs baked into the build, one per provider.
- New manifest additions:
  - `identity` permission.
  - host permissions for Dropbox API + Google Drive API endpoints and their
    OAuth token endpoints.
- `oauth.ts` builds the PKCE challenge, runs `launchWebAuthFlow`, exchanges the
  code, stores the refresh token, and refreshes the access token on demand.

## Modules (new / changed)

```
src/background/
  sources/
    cloudProvider.ts   # CloudProvider interface + RemoteFile types
    dropbox.ts         # Dropbox impl
    gdrive.ts          # Google Drive impl
    oauth.ts           # PKCE flow, token store + refresh
  cache.ts             # IndexedDB cloud cache (CacheRecord CRUD)
  sync.ts              # open/save/merge/conflict orchestration + retry
  vault.ts             # +DbSource awareness; delegates remote I/O to sync.ts
pages/
  popup/  panel/       # source picker (local | Dropbox | Drive),
                       # pending-sync + conflict indicators
  options/             # connected accounts, sign out
shared/
  messages.ts          # +connectCloud, +listRemoteFiles, +openRemote,
                       # +syncStatus message variants
```

New service-worker messages (additive to the Spec 1 contract):

- `connectCloud { provider }` → `{ ok } | { error: 'authRequired' }`
- `listRemoteFiles { provider }` → `RemoteFile[]`
- `openRemote { provider, fileId, masterPassword?, keyFileBytes? }` → `{ ok } | { error }`
- `getSyncStatus {}` → `{ source, pendingUpload, online, lastSyncedAt? }`
- `disconnectCloud { provider }` → `{ ok }`

## Error handling

- OAuth denied / refresh-token failure → typed `{ error: 'authRequired' }`;
  prompt the user to reconnect the provider.
- Merge failure (kdbxweb throws, or non-shared ancestor) → keep
  `pendingUpload`, surface the error, **never** drop local edits.
- Upload conflict (HTTP 409 / rev mismatch) → routed into the merge path.
- Provider rate-limit / IO error → treated as a deferred upload (retry later).
- Corrupt cached bytes → fall back to a fresh `download`; if also offline,
  explicit error.

## Testing

- **Unit (Vitest):**
  - `oauth.ts` — PKCE verifier/challenge construction, redirect URL handling.
  - `cache.ts` — CacheRecord CRUD round-trips.
  - `sync.ts` — decision table (same-rev / fast-forward / conflict / offline)
    driven by a **`FakeCloudProvider`** (in-memory, scriptable revisions).
- **Merge (Vitest):** kdbxweb `merge` over fixture DBs — make concurrent edits
  on two clones of one base, assert a lossless union and no history loss.
- **Provider (Vitest):** `dropbox.ts` / `gdrive.ts` against mocked/recorded
  HTTP responses (metadata, download, upload, 409).
- **E2E (Playwright):** drive the extension against a `FakeCloudProvider`
  server seam — open-from-cloud, edit, save, then simulate a remote change and
  assert the merge notification appears and the uploaded bytes contain both
  edits.

## Out of scope (future specs)

- Firefox build (File System Access alternative / download-to-save fallback).
- Provider-side trash/version-history browsing.
- More than one DB open simultaneously.
