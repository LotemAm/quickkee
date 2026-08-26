# QuickKee

KeePass-compatible password manager for Chrome (Manifest V3). Open local or cloud-hosted `.kdbx` vaults, find matching entries, and manage or autofill credentials without leaving the browser.

## Core capabilities

- Open local KeePass databases with a password, key file, or both.
- Connect Dropbox or Google Drive vaults with offline caching, sync status, and automatic conflict merging.
- Browse, search, create, edit, and delete entries and groups from the popup or side panel.
- Select matching logins, cards, or TOTP credentials from an inline picker; autofill also works inside frames.
- Configure auto-lock, clipboard clearing, password rules, and system/light/dark themes.

## Build and install

Requires Node.js 22, Corepack/Yarn, and Chrome 114+.

```bash
corepack enable
yarn install --immutable
yarn build:chrome
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist_chrome/`.

## Development

| Command | Purpose |
| --- | --- |
| `yarn dev:chrome` | Rebuild the extension while developing |
| `yarn typecheck` | Check TypeScript |
| `yarn lint` | Run ESLint |
| `yarn test` | Run unit tests |
| `yarn test:e2e` | Build and run the Playwright extension tests |
| `yarn build:production` | Produce `release/quickkee.zip` |

## Cloud sync

Open QuickKee's options, connect Dropbox or Google Drive, and choose a `.kdbx` file. QuickKee shows whether the vault is synced, waiting to upload, or working from its offline cache. If local and remote changes overlap, the vaults are merged on save.

## Security and limitations

- The master password and key material remain in the service worker's memory only while the vault is unlocked and are cleared on lock.
- Local and cloud vaults remain encrypted as `.kdbx` files.
- OAuth refresh tokens are stored in `chrome.storage.local` and are not encrypted at rest. Signing out removes them.
- Chrome is the supported browser. A Firefox build configuration exists but is not currently tested or supported.
