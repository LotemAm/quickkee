# Plan 014: E2E triage report

Resumed from a prior session that hit a rate limit mid-fix. This report covers
the full triage across all four affected specs (the baseline 3 plus one
adjacent spec sharing the same root causes).

## Baseline (Step 1)

`yarn test:e2e` at session start (uncommitted diff already present from the
prior agent) — re-verified full-suite baseline matches the plan's record:
`saved-site.spec.ts`, `panel-save.spec.ts`, `unsaved-site.spec.ts` were the
3 named failures. A 4th spec, `cloud-sync.spec.ts`, shared one of the same
two bugs (see below) — not part of the original named-3 baseline, but
already red for the identical root cause, and the prior agent had already
started fixing it. Kept in scope since leaving it half-fixed would violate
"no spec left red for a known, already-diagnosed cause."

Leftover Playwright HTML-report fragments from the prior agent's run
(`playwright-report/data/*.md`) confirm the pre-fix failure signatures:

- `panel-save.spec.ts`: `expect(received).toBe(expected)` — expected
  `"edited-pass-123"`, received `"e2e-pass"` (the original, unedited value).
- `cloud-sync.spec.ts`: `expect(received).toBe(expected)` — expected `true`,
  received `false` (the upload-contains-both-edits predicate never became
  true within the 5s poll).

## Root cause 1 (TEST bug): wrong-field locator in panel specs

**Classification: TEST**

`panel-save.spec.ts` and `cloud-sync.spec.ts` both located the password
input with `panel.locator('input').nth(2)`, on the theory that
`EntryEditor` renders inputs in order Title(0)/Username(1)/Password(2)/URL(3).
That's true *only* counting inputs inside `EntryEditor`. `Panel.tsx` renders
its own search `<input>` (the "Search all entries…" box) earlier in the DOM,
ahead of `EntryEditor`. So the real page-wide order is:
search(0), Title(1), Username(2), Password(3), URL(4) — `nth(2)` actually
lands on **Username**, not Password.

Effect: the test filled the Username field with the new value and read back
Password unchanged — which is exactly the observed failure signature
(`received "e2e-pass"`, the original seeded password). The save/persistence
pipeline itself (`Vault.updateEntry` → `Vault.serialize` → `writeBytes`,
`src/background/vault.ts:100-149`, `src/pages/background/index.ts:62-76`) is
correct; nothing in product code needed to change for this one. Confirmed by
re-reading `vault.ts`: `updateEntry` mutates the same `KdbxEntry` object
`serialize()` later saves, no stale-copy or dirty-flag bug present (that
class of bug was already fixed under plan 001).

**Fix** (already present in the picked-up diff, verified and kept as-is):
replaced the positional locator with a scoped one —
`panel.locator('div.mb-3', { hasText: 'Password' }).locator('input')` —
which finds the field wrapper by its "Password" label instead of counting
inputs page-wide. Applied identically in both `panel-save.spec.ts` and
`cloud-sync.spec.ts`.

## Root cause 2 (TEST bug): group-tree scoping not selected before opening an entry

**Classification: TEST**

`Panel.tsx`'s entry list (`shown`) is filtered to the currently selected
group (`selGroup`) unless a search query is active (`Panel.tsx:154-157`).
The panel defaults `selGroup` to the tree's root group on load
(`Panel.tsx:116`). The fixture's `Localhost Login` / `Cloud Login` entries
live in the "Sites" subgroup, not the root — so `panel.getByRole('button',
{ name: 'Localhost Login' })` was never rendered until the "Sites" group was
clicked first. This is a test-authoring gap (the spec assumed a flat entry
list), not a product defect — grouping the entry list by selected group is
intentional master-detail UI behavior.

**Fix** (already present in the picked-up diff, verified and kept as-is):
both specs now select the "Sites" group button before looking for the entry
button.

## Root cause 3 (PRODUCT regression): CreateForm dropped the dynamic "New entry for `<url>`" text

**Classification: PRODUCT** (localized to `Popup.tsx`'s child component,
within the scope's load/refresh-sequencing spirit — a pure render regression,
no message/router changes)

`unsaved-site.spec.ts` asserts
`popup.getByText('New entry for ${http.altUrl}')`. `git log -p` on
`src/pages/popup/CreateForm.tsx` shows this text was deliberately added in
commit `e45aaac` ("fix(ui): preserve 'New entry for <url>' text in redesigned
CreateForm for e2e") specifically to keep this assertion working through a UI
redesign. A later commit, `96fae35` ("fix(popup): persist create-entry draft
so popup close no longer loses state"), rewrote `CreateForm.tsx` for the
draft-persistence feature and, as an unintended side effect, reverted the
header back to a static `<p>New entry</p>` — silently dropping the URL and
re-breaking the E2E assertion it was previously protecting.

This was not caught at the time because `unsaved-site.spec.ts` was already
red for root causes 1/2's cousins in that spec (see below) and treated as
"known failing," masking the new regression.

**Fix**: restored the original text —
`<p ...>New entry for <span ...>{url}</span></p>` — in
`src/pages/popup/CreateForm.tsx`. `url` is the full tab URL prop (unchanged
by the redesign — `entryUrl`/`baseUrl(url)` is a separate, editable field
used only for the entry's stored URL), so it matches `http.altUrl`
(`tests/e2e/servers.ts:34`, which has a trailing slash matching a bare
`goto(origin)` navigation) exactly.

## `unsaved-site.spec.ts` itself

No locator changes were needed here — it doesn't touch the panel or its
group tree; its failure was entirely the CreateForm text regression (root
cause 3). Once that was fixed, it passed without other edits.

## `saved-site.spec.ts`

No changes were needed. Re-run in isolation and as part of the full suite —
passed both times pre- and post-fix. It doesn't touch the panel's grouped
entry list or the password locator; the popup's badge/copy/autofill flow it
exercises was unaffected by any of the three root causes above. (The prior
agent's mid-session notes, and the "12/15 known-3" framing in
`plans/README.md`, suggest this one may have been intermittently flaky or
was miscounted in an earlier baseline — it did not reproduce as failing at
any point in this session, standalone or in the full suite, including a
`--repeat-each 5` run.)

## Verification

- `yarn typecheck` — clean, no output, exit 0.
- `yarn test` — 102/102 unit tests pass (25 files).
- `yarn build:chrome` — production build succeeds.
- `yarn test:e2e` — **15/15 specs pass**, run twice consecutively (fresh
  build + reused build).
- `npx playwright test tests/e2e/specs/{saved-site,panel-save,unsaved-site,
  cloud-sync}.spec.ts --repeat-each 5` — 20/20 pass (5 iterations × 4 specs),
  confirming determinism, not flake-masked passes.
- `grep -rn "test.skip\|test.fixme" tests/e2e/specs/` — no matches (no spec
  skipped/disabled).
- `git diff --stat tests/e2e/specs/` — only `cloud-sync.spec.ts` and
  `panel-save.spec.ts` modified; no spec files removed.
- Full suite duration: ~17-24s for 15 specs (single worker, headed
  Chromium) — cheap enough for a CI job per plan 015's future scope.

## Outcome

All 4 affected specs (the 3 named in the plan + `cloud-sync.spec.ts`, which
shared root causes 1/2) are green. E2E pass/fail set is now **15/15, all
green** — the "all green" gate plan 014 was meant to unlock for downstream
plans is now in effect.

Two of three root causes were TEST bugs (fragile locators); one was a real,
narrow PRODUCT regression (a UI-redesign commit silently reverting text an
earlier commit had deliberately preserved for E2E coverage) — fixed within
`CreateForm.tsx`, well inside the plan's Popup/Panel load-sequencing scope
(it's a pure JSX/render fix, no message or router changes).
