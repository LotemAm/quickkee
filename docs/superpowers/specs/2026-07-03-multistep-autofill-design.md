# Multi-Step (Username → Password) Autofill — Design Spike

> Plan 018. This is a design document, not a build plan. No `src/` changes
> accompany it. A throwaway spike E2E spec (kept — see "Spike results" below)
> provided the empirical evidence in Step 3.

## Overview

QuickKee's detector already recognizes the username-only step of a two-step
login flow (`findLoginFields`'s no-password branch), but nothing carries the
user's fill intent across the navigation to the password page. Today the user
gets username filled on step one, then has to manually re-trigger autofill
(open the popup, click Autofill) on step two. This spike designs a mechanism
to carry that intent — the *choice of entry*, never the decrypted password —
across the navigation, and answers the riskiest open question empirically:
can the service worker reliably observe "step two is ready" in this
extension's architecture?

This document builds on the **post-change** state of plans 002 (password-free
content-script data), 003 (scheme enforcement + fill-time URL revalidation),
and 005 (DOM-built inline popup) — all three are status DONE (unreviewed, in
their own unmerged worktrees) as of this writing. The drift check specified
by this plan (`git diff --stat 2dd8837..HEAD -- src/content/detect.ts
src/pages/content/index.tsx`) is clean — this worktree's base commit matches
the plan's "Current state" excerpts exactly, so this document reasons from
the plans' own text for 002/003/005's shape rather than from unmerged code in
sibling worktrees.

## Step 1: Two-step flow shapes

| Shape | Description | Real-world example | v1 scope |
|-------|-------------|---------------------|----------|
| (a) Full navigation, same origin | Step-one form submit (GET/POST or JS `location.assign`) loads a brand-new document at a different path/query on the same origin | AWS console (`signin.aws.amazon.com/…` → same host, new path) | **In scope** |
| (b) Same-document DOM swap (SPA) | Step-one's JS hides the username form and injects/reveals a password form without a navigation event | Many modern SPA-style login widgets (e.g. Okta's classic widget in embedded mode) | **In scope** (detection differs — see below) |
| (c) Cross-subdomain/cross-origin hop | Navigation lands on a different registrable domain or a different subdomain the entry wasn't scoped to | Okta tenants that redirect `login.tenant.com` → `tenant.okta.com`; some enterprise SSO relays | **Deferred** — the fill-time `urlMatches` gate (plan 003) would reject same-registrable-domain-but-different-subdomain by design (that's the point of the gate), and a *different* registrable domain is definitionally a different site from the entry's stored URL. Extending pending-fill across that boundary would mean trusting a same-tab navigation to an origin the user never explicitly re-selected an entry for — a real security regression, not a v1 gap. |

Google and Microsoft's sign-in flows are shape (a): `accounts.google.com/…`
stays on the same origin, new path per step. This is the primary target.

### Recommendation
Design for (a) + (b) in v1. Document how the mechanism extends to (c) so a
future plan can make the explicit trust-boundary decision, but do not ship it
silently.

## Step 2: The pending-fill mechanism

### Reference architecture

**SW-held per-tab pending fill.** On a `fillRequest` where the resolved
entry's `fields.password` exists but the *page* had no password field at
fill time (i.e., the content script's `fill` message only populated
`username`), the SW records:

```ts
interface PendingFill {
  entryId: string;
  expectedRegistrableDomain: string; // from urlMatches' parseHost(entry.url)
  expiresAt: number;                 // Date.now() + TTL
  used: boolean;
}
const pendingFills = new Map<number, PendingFill>(); // key: tabId
```

Never the password, never the username in plaintext beyond what's already
resolvable via `entryId` — this is structurally identical to "remember which
entry was selected for this tab," not "cache a secret."

**How the SW knows step one had no password field**: `fillRequest`'s handler
resolves the entry and sends `{ type: 'fill', username, password }` to the
content script; the content script's `fillFields` already silently no-ops
the password set if `f.password` is null (today's behavior — confirmed by
this spike's baseline assertion). The gap is that nothing reports *back*
whether the password field existed. Fix: the content script's `fill` message
handler replies (via `sendResponse` on the existing `chrome.runtime.onMessage`
listener, currently unused for this message type) with
`{ filledPassword: boolean }`. The SW only arms `pendingFills` when
`filledPassword === false` — i.e., only when there was something left undone,
never on a normal single-shot fill.

### Trigger

- **Shape (a)**: `chrome.webNavigation.onCompleted` with `frameId === 0`,
  filtered to the tabId with a pending entry. This spike's Step 3 empirically
  validates this event fires with correct `tabId`/`url`/`frameId` in the
  Playwright extension harness (see "Spike results" below) — **and** in the
  real product this is the same event `warnedTabs` already keys off
  `onBeforeNavigate` for, so it is a proven-reliable API surface in this
  codebase, not a new integration risk.
- **Shape (b)**: no navigation event exists to hook. The content script must
  re-scan: a `MutationObserver` on `document.body` (subtree, childList) that,
  on each mutation batch, re-runs `findLoginFields(document)` and — only if a
  password field is now present where there wasn't one at content-script
  load time — sends a new message type, e.g. `{ type: 'passwordFieldAppeared'
  }`, to the SW. The content script **never** holds or checks the pending-fill
  state itself; it only reports a DOM fact. The SW decides whether to act,
  preserving the "secrets and fill decisions live in the SW" invariant.

### Release conditions (all must hold)

1. Same `tabId` as the one recorded.
2. The tab's *current* URL passes `urlMatches(entry.url, tab.url)` — the
   identical gate plan 003 adds to `fillRequest`, reused, not reimplemented.
3. TTL unexpired: **recommend 90 seconds**. Rationale: long enough to cover a
   slow SSO redirect chain or a user who pauses to read a "we sent a code"
   interstitial, short enough that a background tab left open on step one
   overnight doesn't silently arm a fill the next time it happens to
   navigate. This is a judgment call with no hard data behind it — flagged as
   an open question below since it's exactly the kind of number a maintainer
   should sanity-check against a few second-hand SSO timing traces before
   shipping.
4. Single use: consuming a pending fill immediately sets `used: true` and
   deletes the map entry in the same tick (`webNavigation.onCompleted` and
   `passwordFieldAppeared` handlers must be idempotent against a double-fire).
5. The pending fill was armed by an **explicit user selection** — i.e., only
   from `fillRequest` (popup Autofill button or inline-popup entry click),
   never from a purely automatic/heuristic detection with no user action.
   `fillRequest` is already only reachable via explicit UI, so this falls out
   of using it as the sole arming point; called out because it's a decision
   a differently-shaped implementation could get wrong (e.g. arming from
   `getEntrySummariesForUrl` matches instead).

### Clearing

| Event | Hook point |
|-------|-----------|
| Consumed by a fill | Inline, in the trigger handler, before sending the `fill` message |
| TTL expiry | Lazy check on read (no separate timer needed — `pendingFills.get(tabId)` checks `expiresAt` and deletes-and-returns-undefined if stale) |
| Tab closed | `chrome.tabs.onRemoved.addListener(tabId => pendingFills.delete(tabId))` — new listener, same pattern as would be needed for `warnedTabs` if it ever added one (it currently doesn't clear on tab close either — a pre-existing minor leak this design should not copy) |
| Navigation to a non-matching URL | The release-condition check (URL gate) naturally handles this on the next `onCompleted`; additionally, `onBeforeNavigate` (frameId 0) should proactively delete the pending entry for that tab *before* the new page loads, exactly where `warnedTabs.delete(details.tabId)` already runs today — same function, one more line |
| Vault lock | `doLock()` must call `pendingFills.clear()`. Exact hook point: `src/pages/background/index.ts`, inside `doLock()`, alongside the existing `vault.lock(); handle = null; currentSource = null; autolock.disarm(); void clearAllDrafts(); refreshAllIcons();` |
| SW restart mid-flow | Not clearable — the map is memory-only and simply ceases to exist. See threat model. |

### UX question: silent auto-fill vs. re-shown popup

**Recommendation: re-show the inline popup, pre-filtered/pre-highlighted to
the pending entry — do not silently auto-fill.**

Rationale:
- Silent fill on step two means a password lands in a field the user is not
  actively looking at having just triggered — on a page the user did not
  interact with QuickKee on at all. That is a meaningfully bigger "surprise
  action" than the existing inline popup (which only ever appears in
  response to a `focusin` the user caused).
- Clickjacking/UI-redress angle: if a compromised or malicious page could
  induce a synthetic-looking password field to appear (shape (b)'s
  `MutationObserver` path is literally listening for "a password field
  appeared") and QuickKee silently filled it, that's a page-controlled
  trigger for a credential disclosure with no user gesture in the loop. A
  shown-and-clicked popup requires the same user gesture (`mousedown`/`Enter`
  on a row) the existing single-step flow already requires, so it doesn't
  weaken today's model.
- Cost is low: the user already went through one explicit selection; a
  second lightweight click is not the friction the feature is trying to
  remove (re-navigating to reopen the extension popup manually is).

Concretely: on a valid trigger + release conditions met, call the same
`showPopup` used today, but skip the `getEntrySummariesForUrl` round trip —
pass a single-entry list built from the `entryId` already known (an
`entrySummary`-shaped lookup, not a full decrypt) and auto-highlight it as
the default row. Selecting it (click or Enter) goes through the existing
`getEntry` → `fillFields` path unchanged.

## Threat model

1. **Malicious page simulates step-two password appearance.** Under the
   silent-fill design this would auto-disclose a password to an
   attacker-controlled DOM node with no user gesture. Under the recommended
   design, it only causes an inline popup to appear — the same UI surface
   that already appears on any focused login field today, gated by the same
   click/Enter requirement. No new disclosure primitive. Residual risk: a
   page could bait the user into clicking a popup row that then fills a
   password into an attacker-controlled field. This is not a new risk vs.
   today's single-step inline popup, which already trusts `findLoginFields`'s
   heuristic to have found a legitimate field — an existing, accepted risk
   this design does not worsen.

2. **Tab navigates to an attacker URL within the TTL window.** Blocked by
   release condition 2: `urlMatches(entry.url, tab.url)` must hold. An
   attacker page at a different registrable domain fails this check the same
   way `fillRequest`'s own revalidation (plan 003) already rejects a
   post-selection navigation elsewhere. Same gate, reused — no new trust
   decision introduced.

3. **SW restart mid-flow.** `pendingFills` is memory-only (by design — see
   constraint 3, "nothing secret in `chrome.storage`"; even though the map
   holds no secrets, persisting *fill intent* to disk would be a scope
   creep the design doesn't need). A SW restart (idle eviction, crash,
   browser update) silently drops the pending fill. **Accepted failure
   mode**: the user sees exactly today's behavior on step two — nothing
   happens, they re-trigger manually. This is a strict subset of current
   behavior, never worse.

4. **(Not in the plan's enumerated list, added because Step 3's spike
   surfaced it directly)**: **A malicious step-one page could try to delay
   its own navigation past the TTL to make a pending fill go stale, then
   present its *own* password field hoping the popup UI muscle-memory causes
   a misclick.** Mitigated by: TTL expiry is enforced server-side (SW), and
   the re-shown popup always requires a fresh explicit selection — an
   expired pending fill simply doesn't arm the popup at all, so there's
   nothing to misclick into. Documented for completeness, not a gap.

## Spike results (Step 3 — empirical)

Fixture added: `tests/e2e/fixtures` via two new routes in
`tests/e2e/servers.ts` (`/step1`, `/step2` — no new fixture *file*, reusing
the existing inline-HTML-fixture pattern already used for `/single`). Step
one is a plain `<form method="get" action="/step2">` — a real, full
navigation, no JS — matching shape (a).

Spec: `tests/e2e/specs/multistep-autofill-spike.spec.ts`. Two empirical
questions:

1. **Does today's build do nothing on step two, when step one was filled
   through QuickKee's real autofill path?** Confirmed — the spec drives step
   one the same way `autofill-single-step.spec.ts` does (open the extension
   popup for the tab, click "Autofill"), not by hand-typing into the field.
   After the popup fills `#identifier` (verified `toHaveValue('e2e-user')`,
   the entry's actual stored username) and the form navigates to step two,
   `#password` is empty (`toHaveValue('')`). Because step one went through
   the extension's real fill path, this result is actual evidence that
   QuickKee's current build has no cross-navigation fill mechanism — not a
   tautology that would hold even with the extension uninstalled. This is
   the baseline gap the design closes.
2. **Is `chrome.webNavigation.onCompleted` observable, with correct
   `tabId`/`url`/`frameId`, from inside the live SW in this Playwright +
   persistent-context extension harness?** Confirmed — a listener armed via
   `Worker.evaluate()` directly in the SW's global scope (the same realm the
   real `pendingFills` implementation would run in) recorded the navigation
   event with `frameId === 0` and the correct `tabId` and `url`, matched
   against a tab ID independently obtained via the existing test-seam `tabId`
   command.

**Revision note**: an earlier version of this spike filled step one by
calling `site.locator('#identifier').fill(...)` directly instead of driving
QuickKee's actual autofill flow. An independent code review correctly
flagged that as making question 1's answer tautological — a hand-typed
field says nothing about QuickKee's behavior. Fixing it surfaced a real
fixture bug: the `#identifier` field was `type="email"`, and QuickKee's real
autofill fills the entry's actual username (`'e2e-user'`), which is not a
syntactically valid email — `type="email"`'s native HTML5 validation
silently blocks the GET form submit for that value (validation bubble, no
navigation, no thrown error). The fixture field was changed to `type="text"`
(still `autocomplete="username"`, which is what `detect.ts`'s no-password
branch actually matches on — see `src/content/detect.ts`), matching how
real single-step username fields commonly work (e.g. AWS's console login
uses a plain text input, not `type="email"`). With that fix, the spec now
exercises the real fill path end-to-end and both questions above hold.

**Answer to the Step 3 question**: yes, the SW can reliably observe
step-two-navigation-completed via `webNavigation.onCompleted` in this
architecture and harness. The STOP condition ("`webNavigation` events are
unusable in the Playwright harness") does **not** apply — no OPEN marker
needed for the trigger question.

## Architecture diagram

```
Step one (page A, tab T)
  user selects entry in inline popup / popup Autofill button
    -> fillRequest{entryId, tabId=T}  (existing message, unchanged)
    -> SW: resolve entry, urlMatches gate (plan 003, unchanged)
    -> SW: chrome.tabs.sendMessage(T, {type:'fill', username, password})
    -> content script: fillFields() — password arg silently unused if
       f.password is null (unchanged) — NEW: reply {filledPassword: false}
    -> SW: filledPassword === false
         => pendingFills.set(T, {entryId, expectedRegistrableDomain, expiresAt, used:false})

Trigger (shape a — full navigation)              Trigger (shape b — SPA swap)
  chrome.webNavigation.onCompleted                content script MutationObserver
    (frameId===0, tabId===T)                        detects password field appear
    |                                                  |
    v                                                  v
  SW: pendingFills.get(T)?                    SW: pendingFills.get(T)? (via new
    - unexpired? urlMatches(tab.url)?           'passwordFieldAppeared' message)
    - all release conditions met?                 - same checks
        |                                             |
        v                                             v
  SW: build single-entry EntrySummary lookup for entryId
  SW -> content script (page B, same tab T): {type:'showPendingFill', summary}
  content script: showPopup(passwordField, [summary], onSelect)
    -> user clicks/Enter -> getEntry -> fillFields (existing path, unchanged)
    -> pendingFills.delete(T)  [consumed]

Clearing (any of): consumed | TTL lazy-expiry on read | tabs.onRemoved |
  onBeforeNavigate to non-matching URL | doLock() -> pendingFills.clear()
```

## Decisions table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TTL | 90 seconds | Long enough for a slow SSO redirect chain; short enough to bound a stale pending fill on an abandoned tab. **Open question** — no empirical SSO-timing data behind this number. |
| Trigger, shape (a) | `chrome.webNavigation.onCompleted`, `frameId === 0` | Empirically validated this spike (Step 3); same API family already used for `warnedTabs` (`onBeforeNavigate`/`onErrorOccurred`), so a proven-reliable surface in this codebase. |
| Trigger, shape (b) | Content-script `MutationObserver` reporting a DOM fact (`passwordFieldAppeared`) to the SW; SW alone decides | Preserves "content script never holds fill decisions" invariant; content only ever asserts what it observed. |
| Trigger, shape (c) | Deferred (not implemented) | Would require trusting a same-tab navigation across a registrable-domain boundary the user never explicitly re-selected for — a real security-model expansion, not a v1 gap. |
| UX on release | Re-show inline popup pre-filtered to the pending entry; requires a user click/Enter | Silent fill has no user gesture on the destination page — larger surprise/clickjacking surface than today's model; a shown popup keeps the same gesture requirement the single-step flow already has. |
| State location | SW-memory `Map<tabId, PendingFill>`, entry *id* only, never a password | Matches constraint 3 (no secrets outside SW memory) and the existing `warnedTabs` per-tab-state pattern. |
| URL gate on release | Reuse `urlMatches` (plan 003), not a new comparator | One security-relevant comparator, not two to keep in sync. |

## Test plan (for the future build plan, not this spike)

- **Unit** (new, once `pendingFills` module exists): each release condition
  in isolation — wrong tabId, URL mismatch (subdomain, scheme downgrade,
  different registrable domain), TTL expired, already-`used`, and the
  `doLock()` clearing path. Model after `matcher.test.ts`'s plain-`test()`
  style.
- **E2E**: the two-step fixture this spike introduced
  (`tests/e2e/servers.ts` `/step1`+`/step2`, `multistep-autofill-spike.spec.ts`
  as a starting point) becomes the happy-path regression test once the real
  mechanism exists — assert step two's password field is *filled* after
  navigation, not empty. A second spec should cover a shape-(a) TTL-expired
  case (arm short TTL via the existing `armShort`-style test seam pattern
  already used for autolock) and a URL-mismatch case (navigate to a
  different origin's `/step2`-equivalent within TTL, assert no fill and no
  popup).
- Shape (b) needs its own fixture (a same-document JS toggle, not a new
  document) — not built in this spike; Step 3 only validated shape (a) per
  the plan's recommendation to keep the spike narrow.

## Open questions

1. **TTL value (90s)** — a guess, not measured against real SSO/MFA
   interstitial timing. Worth a maintainer gut-check, or instrumenting a
   telemetry-free local measurement against 2-3 real two-step sites before
   committing to a number in the build plan.
2. **Shape (b) fixture** — not built here; the `MutationObserver` trigger
   design is argued for but not empirically spiked the way shape (a) was.
   Recommend a narrow follow-up spike (or fold into the build plan's Step 1)
   before relying on it.
3. **Shape (c) (cross-subdomain/cross-origin)** — deliberately deferred with
   a stated rationale, but flagged in case a real target (e.g. Okta) turns
   out common enough among QuickKee's actual users to justify revisiting the
   trust boundary explicitly (with a UI affordance, e.g. "this looks like a
   related site, fill anyway?") rather than silently.
4. **`filledPassword` reply plumbing** — this design assumes the existing
   `chrome.runtime.onMessage` content-script listener for `{type:'fill'}`
   starts returning a value via `sendResponse`/async reply. Today it's a
   fire-and-forget listener (`return` value ignored, no `return true`). The
   build plan needs to actually wire a response channel here — a small but
   real piece of plumbing, not just a data model change.
5. **`warnedTabs`-shaped state now has a sibling** (`pendingFills`). Per this
   plan's own maintenance note: if a third per-tab SW map appears in a
   future plan, consolidate into one `Map<tabId, TabState>` structure rather
   than letting per-tab state proliferate.

## Implementation plan sketch

For a future build plan generated from this design:

| Step | Files touched | Effort |
|------|---------------|--------|
| 1 | `src/shared/messages.ts` — add `passwordFieldAppeared` request type; make the `fill` message's content-script reply carry `{filledPassword: boolean}` | S |
| 2 | `src/pages/content/index.tsx` — reply to `fill` with `filledPassword`; add `MutationObserver` for shape (b) detection, wired to send `passwordFieldAppeared` | S-M |
| 3 | New `src/background/pendingFills.ts` — the `Map<tabId, PendingFill>`, arm/release/clear functions, unit tests | M |
| 4 | `src/pages/background/index.ts` — wire `pendingFills` into `fillRequest` (arm on `filledPassword===false`), `chrome.webNavigation.onCompleted` (shape a trigger), `chrome.webNavigation.onBeforeNavigate` (proactive clear alongside `warnedTabs`), `chrome.tabs.onRemoved` (new listener), `doLock()` (clear) | M |
| 5 | `src/content/detect.ts` — no change expected; `findLoginFields` already detects the password-appeared case, reused by the `MutationObserver` re-scan | — |
| 6 | `src/content/inlinePopup.ts` — no structural change; reused as-is for the pending-fill popup re-show, single-entry list | — |
| 7 | E2E — promote `multistep-autofill-spike.spec.ts` from spike to real regression coverage (rename, assert actual fill instead of the baseline "nothing happens"); add TTL-expired and URL-mismatch specs | M |

Rough total: **M** (matches this plan's own effort estimate for the design
work; the build itself is a comparably-sized follow-up, not a large one —
most of the hard architectural decisions are made here).
