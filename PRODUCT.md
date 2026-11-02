# QuickKee

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Browser users who want to manage passwords in a KeePass database.
- The first-install welcome screen must also work for people new to KeePass (confirmed by the user).

## Product Purpose

QuickKee is a KeePass-compatible password manager browser extension. Users open or create a database, then find, manage, and autofill credentials in the browser.

## Operating Context

- Chrome, Brave, and Ungoogled Chromium; Firefox is currently unsupported according to README.md.
- Popup, side panel, and full-tab settings surfaces.
- The proposed welcome screen is a full browser tab opened after installation (confirmed by the user).

## Capabilities and Constraints

- Create a database or open an existing encrypted `.kdbx` database.
- Local files, Dropbox, and Google Drive are supported sources.
- Unlock with a master password, a key file, or both.
- The welcome screen briefly explains KeePass and exposes both database actions.
- The user selected the Focused welcome example for production implementation.

## Brand Commitments

- Preserve the QuickKee name and existing logo asset.
- The incumbent UI uses blue accents, light/dark themes, system sans typography, and Lucide icons.
- No new brand direction has been approved.

## Evidence on Hand

- `README.md`: supported workflows, browsers, and security constraints.
- `src/shared/CreateDatabase.tsx` and `src/shared/UnlockScreen.tsx`: existing database flows.
- `src/assets/styles/tailwind.css`: incumbent theme tokens.
- `public/icon-128.png`: existing logo asset.
