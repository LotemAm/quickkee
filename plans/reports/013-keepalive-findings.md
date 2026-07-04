# Report 013: SW keepalive alarm vs. Chrome's alarm/idle minimums

**Plan**: `plans/013-investigate-keepalive-alarm.md`
**Executor**: headless coding agent (no ability to launch/drive a real Chrome
profile, attach DevTools, or observe `chrome://extensions` UI state)
**Date**: 2026-07-02, at commit `2dd8837` (drift check: `git diff --stat
2dd8837..HEAD -- src/pages/background/index.ts` → empty, no drift)

## Summary / status

**DONE_WITH_CONCERNS.** Step 1 (desk-check against current Chrome
documentation) is complete and conclusive. Step 2 (empirical SW-lifetime
observation in a loaded, unpacked Chrome profile) **could not be performed**
in this environment — it requires launching real Chrome, loading
`dist_chrome` unpacked, and watching `chrome://extensions` /
`chrome://serviceworker-internals` over a 5+ minute unobserved window, none of
which a headless coding agent can do. That half of the investigation is
marked below as **requires manual human verification**, with the exact steps
to run it. A bounded, evidence-backed code change was still applied (see
"Fix applied").

## Step 1: Documented constraints (from developer.chrome.com, fetched 2026-07-02)

1. **`chrome.alarms` minimum period.** Current API reference
   (`chrome.alarms` — AlarmCreateInfo): *"Chrome limits alarms to at most
   once every 30 seconds but may delay them an arbitrary amount more."* and
   *"setting `delayInMinutes` or `periodInMinutes` to less than `0.5` will
   not be honored and will cause a warning."* So the documented floor is
   **0.5 minutes (30 s)**.
   Source: https://developer.chrome.com/docs/extensions/reference/api/alarms

2. **History of the minimum.** Chrome's "What's new in Chrome 120 for
   Extensions" post states the old minimum was **1 minute**; Chrome 120
   lowered it to **30 seconds**, explicitly to match the service worker idle
   lifecycle: *"service workers shut down after 30 seconds of inactivity. So
   there was no straightforward way to schedule an alarm to fire in 45
   seconds"* — under the old 1-minute floor there was a dead zone between the
   SW's 30 s idle deadline and the shortest alarm that could reset it. The
   post frames the new split as: use `setTimeout()` for sub-30s callbacks,
   use `chrome.alarms` for 30 s and above.
   Source: https://developer.chrome.com/blog/chrome-120-beta-whats-new-for-extensions

3. **Sub-minimum behavior: clamp vs. reject.** The docs say sub-0.5 values
   "will not be honored and will cause a warning" — i.e. Chrome logs a
   console warning on the alarm's *creating* context and does not error the
   `alarms.create()` call. Community reports and the phrasing agree this
   clamps the effective period up to the 0.5 min floor rather than rejecting
   the alarm outright, but the API reference does not spell out an exact
   clamped value in so many words — this specific point (clamped-to-exactly-0.5
   vs. some other rounding) is the one fact in this section I could not find
   a first-party, unambiguous citation for. It does not change the verdict:
   either way, 0.4 is below the documented floor and the actual behavior is
   at best equivalent to 0.5 and undocumented/warned-about at worst.

4. **Does an alarm firing reset the SW idle timer?** The SW lifecycle doc
   states plainly: *"After 30 seconds of inactivity[, the SW is torn down].
   Receiving an event or calling an extension API resets this timer"* and
   *"Events and calls to extension APIs reset these timers, and if the
   service worker has gone dormant, an incoming event will revive them."*
   `chrome.alarms.onAlarm` firing is an extension event, so by this
   documentation it resets the idle timer (and can revive an already-dormant
   SW). This directly supports the plan's premise that a correctly-cadenced
   alarm *should* be able to keep the SW alive — the open question (Step 2)
   is whether "may delay them an arbitrary amount more" jitter ever pushes a
   real tick past the 30 s deadline before it fires.
   Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

5. **DevTools masks idle-kill.** Multiple sources (Chrome's own service
   worker lifecycle materials plus community reports) confirm a SW with an
   attached DevTools/inspector session is not torn down for idleness; the
   30 s eviction only applies with no inspector attached. This is exactly
   why the plan's Step 2 protocol says not to open DevTools on the SW during
   the observation window.

## Codebase evidence gathered without live Chrome

- **Current code** (`src/pages/background/index.ts`, before fix):
  `chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })` — 0.4 min =
  24 s, below the documented 0.5 min / 30 s floor confirmed in Step 1.
- **No test coverage exists for the alarm at all.** Grepped `src/**/*.test.ts`
  and `tests/**` for `alarm`/`keepalive`/`periodInMinutes` — zero matches.
  There is no unit-level chrome mock for `chrome.alarms` anywhere in the repo
  (`settings.test.ts`, `createDraft.test.ts`, `icon.test.ts`,
  `messages.test.ts` each stub a *different*, narrower slice of `chrome.*`).
  So nothing in the existing suite would catch a keepalive regression either
  way.
- **E2E harness plausibly masks this class of bug.** `tests/e2e/helpers.ts`
  obtains the extension ID via
  `context.serviceWorkers()` / `context.waitForEvent('serviceworker')` on a
  Playwright `BrowserContext`. Playwright implements this through the Chrome
  DevTools Protocol, i.e. it attaches an inspector-style connection to the SW
  target to enumerate/await it. Per the DevTools-masking behavior in Step 1
  item 5, this is the same class of connection that is documented to
  suppress idle-kill. This matches the plan's suspicion (fact #3) that the
  E2E suite would never reproduce a real-world idle-kill even if it exists in
  production; I could not find a definitive first-party statement that
  Playwright's specific CDP attachment mode counts as "DevTools open" for
  this purpose, so I present it as *plausible, unconfirmed* rather than
  proven — it would need the same live-Chrome instrumentation Step 2 needs to
  settle definitively (e.g. run the E2E fixture against a build with an
  intentionally-broken keepalive and see if it still passes).
- **Design-doc gap confirmed.** `docs/superpowers/specs/2026-06-21-quickkee-mvp-design.md`
  lists `Keepalive (chrome.alarms + port) to resist idle death` as a
  background-module responsibility. Only the alarm half exists in
  `src/pages/background/index.ts`; there is no persistent port from any UI
  page to the SW anywhere in `src/`. This is a real, pre-existing gap between
  the design doc and the implementation, independent of the 0.4-vs-0.5
  question.
- **Autolock / SW-death interaction** (`src/background/autolock.ts`):
  `AutoLock` is a thin `setTimeout` wrapper (`arm`/`touch`/`disarm`); its
  timer is pure in-memory JS state. If the SW process is torn down, that
  `setTimeout` is destroyed with it and will never fire — so if keepalive
  fails to prevent SW death, auto-lock's intended N-hour timer is *not* what
  actually locks the vault; something else does (see next point). This
  confirms the plan's concern #46: auto-lock's real-world timing is entirely
  contingent on keepalive's effectiveness, which is exactly the open
  question in this report.
- **What actually happens on SW restart (module-reload semantics).**
  `vault.ts`'s `Vault` class initializes `private db: kdbxweb.Kdbx | null =
  null` and `isOpen()` returns `this.db !== null`. `src/pages/background/index.ts`
  constructs `const vault = new Vault()` at module top level. A SW
  idle-kill-then-revive re-executes the entire module from scratch (this is
  standard SW semantics — waking a terminated worker reruns its top-level
  script), so the revived SW gets a **fresh, always-locked** `Vault`
  instance — functionally indistinguishable from calling `doLock()`,
  regardless of whether `doLock()` itself is invoked. This confirms the
  plan's memory-model consequence: a SW death silently drops the unlocked
  vault from memory and the user next sees it as locked, with or without any
  explicit lock call running.
- **`onStartup` vs. SW restart — confirmed distinct.**
  `chrome.runtime.onStartup.addListener(doLock)` fires only on browser
  *profile* startup (e.g. Chrome relaunching), not on a SW being idle-killed
  and later revived by an incoming event/message — those are different
  Chrome-internal triggers. Practically this doesn't matter for user-visible
  behavior because (per the previous bullet) an idle-killed-and-revived SW is
  already locked by construction; `onStartup`'s `doLock()` call is
  redundant-but-harmless in that specific case and only does real work on
  an actual browser relaunch (e.g. clearing `warnedTabs`/`currentSource`,
  which the constructor also resets, so it is arguably now belt-and-braces
  more than a distinct code path — noting this for completeness only, no
  code change proposed since `autolock.ts`/lock semantics are explicitly
  out of scope for this plan).

## Step 2: Empirical SW-lifetime observation — NOT PERFORMED

I have no ability in this environment to launch a real Chrome browser,
load an unpacked extension, or read `chrome://extensions` /
`chrome://serviceworker-internals` state. This step **requires manual human
verification**. Exact steps (copied/adapted from the plan, ready to run):

1. `yarn build:chrome`
2. Load `dist_chrome` unpacked in `chrome://extensions` (Developer mode on).
3. Note the Chrome version (`chrome://version`).
4. Unlock a test vault (fixture password `correct horse`, or generate one via
   `node src/test/fixtures/make-fixture.mjs`).
5. **Do not open DevTools on the service worker** during the observation
   window (per Step 1 item 5, an attached inspector suppresses idle-kill and
   would invalidate the test).
6. Watch the SW for 5+ minutes with **no interaction**: on
   `chrome://extensions`, the service worker row shows "(inactive)" when
   torn down, and reactivates on the next event; `chrome://serviceworker-internals`
   lists start/stop timestamps.
7. After the window, click the extension icon: is the vault still shown as
   unlocked, or has it silently reverted to the lock screen?
8. Repeat once more for confidence; note any inconsistency between runs
   (that would be plan verdict (c), STOP).
9. Record: Chrome version, whether `chrome://serviceworker-internals` shows
   any stop/restart cycles in the window, and whether the vault survived.

Until this is run, the central question the plan calls "Confidence MED" —
whether a 30 s-clamped alarm reliably outruns the SW's 30 s idle-eviction
deadline given Chrome's own "may delay them an arbitrary amount more" jitter
caveat — remains genuinely open. I am not willing to guess a verdict letter
(a)/(b)/(c) from documentation alone, because the jitter behavior is exactly
the kind of thing Chrome does not fully specify and that plausibly varies by
Chrome version/build/load.

## Verdict

**Cannot be assigned a definitive (a)/(b)/(c) letter without the Step 2 data
above.** What Step 1 does establish with confidence:

- The current `0.4` value is objectively below Chrome's documented minimum
  and was already being silently clamped (with a console warning) to
  something at least as large as `0.5` — so today's runtime behavior is, at
  worst, no better than what an explicit `0.5` would produce, and today's
  code additionally pays for an unnecessary warning and an inaccurate
  in-code claim about the interval.
- Chrome's own design rationale (Step 1 item 2) says the 30 s alarm floor
  exists specifically so alarms can reset the SW idle timer before it fires
  — i.e. the mechanism is *supposed* to work at exactly this cadence. That
  is encouraging for verdict (a) but is not the same as confirming it holds
  under real scheduling jitter, hence still not a safe verdict to assert.

Given that, this report reaches a **documentation-supported partial
conclusion, not a full verdict**: the code-level defect (using an
undocumented, sub-floor value) is real and independent of which verdict Step
2 eventually confirms; the SW-survival question itself is unresolved pending
manual observation.

## Fix applied

Applied the value correction described as Step 4 Option 1, because it is
safe and beneficial under **both** possible Step-2 outcomes (verdict a or b)
— it does not assume the alarm mechanism is sufficient, it just stops the
code from silently relying on undocumented clamping:

```diff
-// keepalive: alarm heartbeat keeps the SW from idling out while unlocked
-chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
+// keepalive: alarm heartbeat keeps the SW from idling out while unlocked.
+// 0.5 is Chrome's documented floor for periodInMinutes (30s, since Chrome 120); values
+// below it are silently clamped up with a console warning, so state the real value instead
+// of relying on that clamp. Whether this alarm cadence is actually sufficient to outrun the
+// SW's 30s idle-eviction deadline is unconfirmed — see plans/reports/013-keepalive-findings.md.
+chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
```

**Not applied: Step 4 Option 2** (re-arming the alarm inside `onAlarm` via a
one-shot `when: Date.now() + 25_000` chain). The plan gates this explicitly
on Step 2 evidence showing "the periodic alarm's tick failed to keep the SW
alive but a re-created alarm would" — a tick-phase-dependent eviction
pattern that can only be observed live. I have no such evidence, and
fabricating it (or applying the mitigation speculatively) would go against
this plan's explicit instruction not to hack around an unconfirmed failure
mode. If manual Step 2 verification finds the SW does die mid-session even
at the 30 s cadence, apply Option 2 then, referencing this report, or open
the "port-based keepalive" follow-up plan the design doc already calls for
(alarms + port) if Option 2's own re-arm evidence requirement isn't met
either.

## Verification

- `yarn typecheck` → exit 0, no output.
- `yarn test` → 102/102 tests passed (25 test files); no test references
  `alarm`/`keepalive`, so this run cannot itself validate SW-lifetime
  behavior — it only confirms the value/comment change didn't break anything
  statically or at the unit level.
- `yarn build:chrome` → succeeded (`dist_chrome` built, service worker chunk
  emitted normally).
- `grep -n "0.4" src/pages/background/index.ts` → no matches (Done-criteria
  check from the plan).
- Step 2's live-Chrome protocol was **not** run — see above.

## Recommendation for the follow-up

Whoever runs the manual Step 2 protocol should append the results to this
report (Chrome version, timestamps, survived/did-not-survive) rather than
opening a new file, so the "alarms + port" design gap and this alarm-cadence
question stay linked as the plan's maintenance note requests. If Step 2
shows the SW does not survive even at the clamped 30 s cadence, and a
re-armed one-shot alarm evidently does keep it alive, apply Option 2 next
(bounded, in scope). If neither periodic nor re-armed alarms suffice, that is
this plan's explicitly out-of-scope architectural case (offscreen document /
persistent port from a UI page) and needs a new plan, not a patch here.
