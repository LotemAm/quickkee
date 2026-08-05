import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd } from '../helpers';

interface SpikeEvent { tabId: number; url: string; frameId: number; ts: number }
type SpikeSelf = { __qkSpikeEvents: SpikeEvent[] };

// Spike for plan 018 (multi-step autofill design doc). Answers two empirical
// questions before any src/ implementation is attempted:
//
//   1. Does today's build do *nothing* on a step-two (password-only) page after
//      the user filled step one and a real navigation occurred? (baseline —
//      confirms the gap the design is meant to close)
//   2. Can the service worker reliably observe "step two navigation completed"
//      via chrome.webNavigation.onCompleted, with usable tabId/url/frameId, in
//      this Playwright + persistent-context extension harness?
//
// This spec makes NO changes to src/ — it registers a webNavigation listener
// directly in the live service worker via Playwright's Worker.evaluate(), which
// is exactly the same API surface the real design would use from inside the SW.
// Step one is filled through QuickKee's actual autofill path (extension popup +
// "Autofill" button), not by hand-typing into the field, so question 1's answer
// is evidence about QuickKee's behavior rather than a tautology.
// See docs/superpowers/specs/2026-07-03-multistep-autofill-design.md, Step 3.

test('spike: step-two page is untouched today, and onCompleted is observable in the SW', async ({
  context, extensionId, http,
}) => {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');

  // Arm the observer *before* any navigation happens, from inside the SW's own
  // global scope -- the same realm a real pendingFills implementation would run in.
  await sw.evaluate(() => {
    (self as unknown as SpikeSelf).__qkSpikeEvents = [];
    chrome.webNavigation.onCompleted.addListener(details => {
      (self as unknown as SpikeSelf).__qkSpikeEvents.push({
        tabId: details.tabId, url: details.url, frameId: details.frameId, ts: Date.now(),
      });
    });
  });

  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.step1Url);
  await site.waitForLoadState('load');
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.step1Url });
  expect(typeof tabId).toBe('number');

  // Fill step one through QuickKee's real autofill path -- same pattern as
  // autofill-single-step.spec.ts: open the extension popup for this tab and
  // click "Autofill". This is load-bearing for question 1 below: if step one
  // were filled by hand-typing into the field instead, an empty #password on
  // step two would be true even with the extension uninstalled, and would
  // prove nothing about QuickKee's behavior.
  const popup = await openPopupForTab(context, extensionId, http.step1Url, tabId);
  await expect(popup.getByText('Localhost Login')).toBeVisible();
  await popup.getByRole('button', { name: 'Autofill' }).click();
  await expect(site.locator('#identifier')).toHaveValue('e2e-user');

  // Real, full-page, same-origin navigation to /step2 (shape "a" in the design
  // doc) -- a plain GET form submit, not a fetch/pushState SPA transition.
  await site.getByRole('button', { name: 'Next' }).click();
  await site.waitForURL(/\/step2/);
  await expect(site.locator('#password')).toBeVisible();

  // Question 1: today's build did not touch the password field -- there is no
  // pending-fill mechanism yet, so it must be empty.
  await expect(site.locator('#password')).toHaveValue('');

  // Question 2: the SW's onCompleted listener recorded this navigation with the
  // right tabId/url/frameId. Poll because the event may arrive slightly after
  // waitForURL resolves (they race the same underlying browser event).
  const readMatched = async () => {
    const all = await sw.evaluate(() => (self as unknown as SpikeSelf).__qkSpikeEvents);
    return all.filter(e => e.tabId === tabId && e.frameId === 0 && e.url.includes('/step2'));
  };
  await expect.poll(async () => (await readMatched()).length, { timeout: 5000 }).toBeGreaterThan(0);

  const matched = await readMatched();
  expect(matched[0].tabId).toBe(tabId);
  expect(matched[0].frameId).toBe(0);
  expect(matched[0].url).toContain('/step2');
});
