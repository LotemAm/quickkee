import { test, expect, swCmd, openExtensionPage } from '../helpers';

test('bad certificate: badge shows red ! for the offending tab', async ({ context, extensionId, https }) => {
  // A page to send SW test commands from.
  const probe = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');

  // The service-worker fixture is discoverable before its module has necessarily finished
  // registering listeners. The test-command listener is registered after the certificate
  // listener, so this handshake guarantees the warning event cannot race SW startup.
  await expect.poll(async () => (await swCmd(probe, { cmd: 'warned' }))?.tabs ?? null)
    .toEqual([]);

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
