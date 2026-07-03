# Plan 013: Investigate the service-worker keepalive (alarm below Chrome's minimum) and fix per findings

> **Executor instructions**: This is an INVESTIGATE plan — the primary
> deliverable is a written report; a code change only follows if the
> investigation confirms the defect and the fix is within the bounded options
> listed below. Follow the steps in order; honor STOP conditions. When done,
> update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2dd8837..HEAD -- src/pages/background/index.ts`
> Plans 001–004/007/009 modify this file. Locate the current keepalive code
> (grep `keepalive`); if the alarm mechanism was already replaced, STOP.

## Status

- **Priority**: P2
- **Effort**: S (investigation) + S (bounded fix)
- **Risk**: LOW
- **Depends on**: none (if plan 009 landed, the alarm wiring lives in `index.ts` still — lifecycle was out of 009's scope)
- **Category**: bug (investigate)
- **Planned at**: commit `2dd8837`, 2026-07-02

## Why this matters

The unlocked vault (decrypted DB + master key) lives only in the MV3 service worker's memory; the design relies on a keepalive to stop Chrome from idle-killing the SW while unlocked. The keepalive alarm is created with `periodInMinutes: 0.4` (24 s) — below Chrome's documented 30-second minimum, so Chrome clamps it. If the effective period lands at/after the ~30 s SW idle-eviction deadline, the SW can be killed between ticks: the vault silently locks mid-session, and (before plan 001) unsaved edits were lost with it. Confidence is MED — Chrome's clamping and idle-accounting behavior needs empirical confirmation before changing strategy, which is why this is an investigation, not a blind fix.

## Current state

- `src/pages/background/index.ts:135-149` (baseline):

```ts
// keepalive: alarm heartbeat keeps the SW from idling out while unlocked
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
...
chrome.alarms.onAlarm.addListener(a => {
  if (a.name !== 'keepalive') return;
  if (vault.isOpen()) void chrome.runtime.getPlatformInfo(); // keepalive heartbeat (preserve MVP behavior)
  void tryRetry();
});
```

- Design context (`docs/superpowers/specs/2026-06-21-quickkee-mvp-design.md`): "Keepalive (chrome.alarms + port) to resist idle death" — note the spec says *alarms + port*; only the alarm half was implemented.
- Facts to verify against current Chrome documentation/behavior (do not trust memory):
  1. `chrome.alarms` minimum period — historically 1 minute, reduced to 30 s in Chrome 120.
  2. Whether an alarm firing resets the SW idle timer (extension events generally do).
  3. Whether the E2E suite masks this (Playwright keeps DevTools/inspection attached, which disables SW idle-kill — meaning this bug would never reproduce under the test harness).
- Auto-lock is a separate mechanism (`src/background/autolock.ts`, `setTimeout`-based, default 8 h) — note that a `setTimeout` in a killed SW never fires, so SW death both (a) locks early (memory gone) and (b) means the *intended* auto-lock timing is only as reliable as the keepalive. Your report should cover this interaction.
- A memory-model consequence to confirm: after SW death, the next message from a UI page restarts the SW, which re-runs module top-level code — `new Vault()` (locked), `chrome.alarms.create` again (fine, same name). The user sees the vault locked. There is also `chrome.runtime.onStartup.addListener(doLock)` — startup ≠ SW restart; verify which applies.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Build     | `yarn build:chrome`  | exit 0              |
| Typecheck | `yarn typecheck`     | exit 0              |
| Unit tests| `yarn test`          | all pass            |

Manual instrumentation happens in a real Chrome profile with the unpacked `dist_chrome`.

## Scope

**In scope**:
- Investigation report: `plans/reports/013-keepalive-findings.md` (create `plans/reports/` if absent)
- Bounded fix in `src/pages/background/index.ts` (see Step 4 options)

**Out of scope**:
- Architectural keepalive redesign (offscreen documents, persistent ports from UI pages, nativeMessaging tricks) — if the investigation concludes one is required, that is a REPORT outcome feeding a new plan, not something to build here.
- `autolock.ts` changes.

## Git workflow

- Conventional Commits, e.g. `fix(sw): raise keepalive alarm to supported minimum` (only if Step 4 applies).
- Do NOT push unless instructed.

## Steps

### Step 1: Desk-check the documented constraints

Check the current `chrome.alarms` documentation (developer.chrome.com) for: minimum `periodInMinutes` by Chrome version, and clamping vs. rejection behavior for sub-minimum values (Chrome logs a warning and clamps). Record the exact documented values with links in the report.

### Step 2: Empirical SW-lifetime test

1. `yarn build:chrome`; load `dist_chrome` unpacked. **Do not open DevTools on the service worker during the observation window** (inspection disables idle-kill).
2. Unlock a test vault (create one with `node src/test/fixtures/make-fixture.mjs` guidance in that script, or reuse an existing `.kdbx`; password for the repo fixture is `correct horse`).
3. Observe SW liveness for 5+ minutes WITHOUT interacting: `chrome://serviceworker-internals` or the "service worker (inactive)" label on `chrome://extensions` — record timestamps of any stop/restart.
4. After the window, click the extension icon: is the vault still unlocked?
5. Repeat once for confidence.

Record: Chrome version, whether the SW survived, whether the vault stayed unlocked.

### Step 3: Write the report

`plans/reports/013-keepalive-findings.md`: documented constraints (Step 1), empirical results (Step 2), the autolock interaction analysis (does the 8 h `setTimeout` survive in practice?), whether E2E masks the issue, and a verdict: **(a)** alarm keepalive works at the clamped 30 s (vault survives) — fix is cosmetic (Step 4 option 1); **(b)** SW dies between ticks (vault locks) — apply Step 4 option 2 and recommend a follow-up plan for the port-based half of the original design; **(c)** results are inconsistent — report and stop.

### Step 4: Bounded fix (per verdict)

Option 1 (verdict a): change `periodInMinutes: 0.4` → `0.5` with a comment stating the Chrome minimum, so the code stops relying on silent clamping.

Option 2 (verdict b): same value fix, PLUS re-arm the alarm inside the handler using a one-shot chain (`chrome.alarms.create('keepalive', { when: Date.now() + 25_000 })` from within `onAlarm`) if and only if your Step 2 evidence shows the periodic alarm's tick failed to keep the SW alive but a re-created alarm would (i.e. the eviction is tick-phase dependent). If the evidence instead shows alarms fundamentally cannot keep the SW alive on this Chrome version, do NOT hack around it — that is the report-and-new-plan outcome.

**Verify**: `yarn typecheck` → exit 0; `yarn test` → all pass; re-run Step 2's observation once with the fix → vault survives the window (verdict-b case).

## Test plan

This is empirical: the Step 2 protocol before/after is the test. No unit test can capture SW lifetime. If Option 2 lands, add a one-line comment in the code pointing at the report file.

## Done criteria

- [ ] `plans/reports/013-keepalive-findings.md` exists with Chrome version, documented minimums (with links), empirical timeline, verdict.
- [ ] If a fix landed: `grep -n "0.4" src/pages/background/index.ts` → no matches; `yarn typecheck`/`yarn test` pass.
- [ ] `plans/README.md` status row updated (DONE with verdict letter, or BLOCKED per STOP).

## STOP conditions

- You cannot load an unpacked extension / drive a real Chrome profile in your environment — report BLOCKED (manual-hardware-required); the desk-check (Step 1) report alone is still worth committing.
- Verdict (c) — inconsistent results across runs.
- The fix appears to require anything from the out-of-scope list.

## Maintenance notes

- Whatever the verdict, the report becomes the reference for the "alarms + port" design-doc gap; a future plan implementing the port half should link it.
- Chrome changes SW lifetime policies across versions — re-run the Step 2 protocol when a lifetime-related bug report arrives.
