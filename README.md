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

Requires Node.js 24.15+ (or 26+), Corepack/Yarn, and Chrome 114+.

```bash
corepack enable
yarn install --immutable
yarn build:chrome
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist_chrome/`.

On first installation, a welcome tab helps you create a database or open an existing KeePass `.kdbx` file.

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

### OAuth build configuration

- Copy `.env.example` to `.env` and configure `VITE_DROPBOX_CLIENT_ID` with the Dropbox app key and `VITE_GDRIVE_WEB_CLIENT_ID` with the Google Web application client ID.
- Production builds require both IDs and the Chrome Extension client ID in `manifest.json`; missing or placeholder values stop the build.
- CI reads both `VITE_DROPBOX_CLIENT_ID` and `VITE_GDRIVE_WEB_CLIENT_ID` from repository secrets. Store publishing reads the same secret names from the `chrome-web-store` environment (or repository secrets when no environment override exists).
- Client IDs are public identifiers. OAuth client secrets must never be included in the extension.

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
