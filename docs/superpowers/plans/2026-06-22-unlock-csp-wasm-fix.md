# Fix Plan: Argon2 KDBX unlock blocked by MV3 CSP (WASM)

**Date:** 2026-06-22
**Surfaced by:** E2E unlock spec (`tests/e2e/specs/unlock.spec.ts`), Task 2 of the E2E plan.
**Severity:** Critical (release blocker — the extension could not open any Argon2 KDBX4 database in a real browser).
**Status:** FIXED (`8ff0b6b`).

## Symptom

In a real Chrome browser, unlocking the vault always failed with "Wrong password or key file" even with the correct password (`correct horse`). The same `.kdbx` bytes decrypt fine with kdbxweb in Node, and the stored bytes carried a valid KeePass magic header — yet the built extension rejected them. The 32 unit tests all passed, hiding the defect.

## Root cause

`src/background/vault.ts:open()` calls `registerArgon2()` (`src/background/crypto.ts`), which uses **hash-wasm** to compute the Argon2 KDF. hash-wasm runs Argon2 as a WebAssembly module.

The extension manifest (`manifest.json`) declared **no `content_security_policy`**, so MV3's default applied: `script-src 'self'`. That directive forbids WebAssembly compilation. The service worker therefore threw at `WebAssembly.compile()`:

```
CompileError: WebAssembly.compile(): ... violates the following Content Security Policy directive ... "script-src 'self'".
```

`kdbxweb.Kdbx.load()` rejected, and the unlock handler's `catch` collapsed every error into `error: 'badCredentials'` — masking the real cause as a wrong-password message.

Unit tests never caught it because they run under jsdom/node, which has no CSP and runs WASM freely.

## Fix (applied)

Add a CSP to `manifest.json` that permits WASM on extension pages and the service worker:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

`'wasm-unsafe-eval'` is the narrow, MV3-approved token that allows `WebAssembly.compile`/`instantiate` without enabling general `unsafe-eval`. It applies to both extension pages and the service worker. Verified: the production build (`yarn build:chrome`) emits the CSP into `dist_chrome/manifest.json`, and the E2E unlock spec passes.

## Follow-up recommendations (not yet done)

1. **Stop swallowing the unlock error.** `src/pages/background/index.ts` unlock handler does `catch { return { ok: false, error: 'badCredentials' } }`. This anti-pattern hid a non-credential failure for the whole project lifetime. Recommend distinguishing credential errors from operational errors (e.g. log the real error and return a distinct `error: 'openFailed'` for non-credential exceptions) so a future runtime failure is diagnosable rather than mislabeled "wrong password." Track as a Minor fast-follow.
2. **Add a CSP regression guard.** Consider asserting in a test (or the E2E suite README note) that `dist_chrome/manifest.json` contains `wasm-unsafe-eval`, so a future manifest refactor can't silently re-break unlock.

## Tracked follow-ups (from final whole-branch review, 2026-06-23)

Final review verdict: **Ready to merge** — no Critical/Important; seam-strip and CSP minimality empirically re-verified against a real `yarn build:chrome`. Two substantive fast-follows are tracked here (not done on this branch, since #1 is a product-behavior change):

1. **Stop swallowing the unlock error** (`src/pages/background/index.ts:30`). The bare `catch { return badCredentials }` masked the WASM `CompileError` as "wrong password" for the project's lifetime. Distinguish credential failures (kdbxweb credential error) from operational failures — e.g. return a distinct `openFailed` code for non-credential exceptions and log the underlying error — with matching UI copy in `UnlockScreen.tsx`.
2. **Add a CSP regression guard.** Nothing asserts the built `dist_chrome/manifest.json` still contains `wasm-unsafe-eval`; a future manifest refactor could silently re-break unlock. Add a cheap check (unit test on the built manifest, or fold into the seam-strip check).

Deferred Minor (test-only, harmless): `saveTestBytes` exported unguarded (tree-shaken from prod); `servers.spec.ts` uses `input[type=password]` vs `input#password`. The `swCmd` spread-override footgun was hardened in-branch (`{ ...m, __qk: 'test' }`).

## Verification record

- `npx playwright test tests/e2e/specs/unlock.spec.ts` → pass (was failing pre-fix).
- `yarn test` → 32/32 pass. `yarn typecheck` → clean.
- `yarn build:chrome` → seam absent, CSP present in `dist_chrome/manifest.json`.
