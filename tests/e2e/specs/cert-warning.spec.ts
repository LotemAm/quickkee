import { test, expect, swCmd, openExtensionPage } from '../helpers';

test('bad certificate: badge shows red ! for the offending tab', async ({ context, extensionId, https }) => {
  // A page to send SW test commands from.
  const probe = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');

  const site = await context.newPage();
  // Navigation to a self-signed origin fails at the cert interstitial; swallow the error.
  await site.goto(https.url).catch(() => {});

  // SW recorded a cert warning for some tab.
  const { tabs } = await (async () => {
    let r = { tabs: [] as number[] };
    await expect.poll(async () => {
      r = await swCmd(probe, { cmd: 'warned' });
      return r.tabs.length;
    }, { timeout: 8000 }).toBeGreaterThan(0);
    return r;
  })();

  // The visible badge for that tab is the red '!'.
  const badge = await swCmd(probe, { cmd: 'badge', tabId: tabs[0] });
  expect(badge.text).toBe('!');
  // #dc2626 -> rgba(220, 38, 38, 255)
  expect(badge.color).toEqual([220, 38, 38, 255]);
});
