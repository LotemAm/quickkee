# QuickKee

KeePass-compatible password manager for Chrome (Manifest V3). Open local or cloud-hosted `.kdbx` vaults, find matching entries, and manage or autofill credentials without leaving the browser.

[Install QuickKee from the Chrome Web Store](https://chromewebstore.google.com/detail/jngjnmfmodbiogpcadigjcflkbkhfnfb)

## Core capabilities

- Open local KeePass databases with a password, key file, or both.
- Connect Dropbox or Google Drive vaults with offline caching, sync status, and automatic conflict merging.
- Browse, search, create, edit, and delete entries and groups from the popup or side panel.
- Audit an unlocked vault locally for empty, weak, or reused passwords and entries that are stale or expired.
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

### Google OAuth setup

- Google Chrome uses the Chrome Extension OAuth client declared in `manifest.json`.
- Brave and Ungoogled Chromium use the hosted callback at `https://lotemam.github.io/quickkee/oauth/callback/`.
- In Google Cloud Console, create an OAuth client of type **Web application**, register that exact callback as an authorized redirect URI, and set its client ID as `VITE_GDRIVE_WEB_CLIENT_ID` (see `.env.example`). No client secret belongs in the extension.
- GitHub Pages deploys the static callback from `site/` using `.github/workflows/deploy-oauth-callback.yml`.

## Security and limitations

- The master password and key material remain in the service worker's memory only while the vault is unlocked and are cleared on lock.
- Local and cloud vaults remain encrypted as `.kdbx` files.
- Dropbox refresh tokens are stored in `chrome.storage.local` and are not encrypted at rest. Hosted Google access tokens are short-lived and stored in `chrome.storage.session`. Signing out removes them.
- Chrome, Brave, and Ungoogled Chromium are supported. A Firefox build configuration exists but is not currently tested or supported.
