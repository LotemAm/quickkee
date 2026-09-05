import { test, expect, swCmd, getTabId, openExtensionPage } from '../helpers';

test('bad certificate: badge shows red ! for the offending tab', async ({ context, extensionId, http, https }) => {
  const probe = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');

  // The test listener registers after the certificate listener. This handshake
  // ensures startup is complete and no warning from an earlier navigation exists.
  const warnedTabs = async () => {
    const tabs = (await swCmd(probe, { cmd: 'warned' }))?.tabs;
    return Array.isArray(tabs) ? tabs : null;
  };
  await expect.poll(warnedTabs).toEqual([]);

  // Identify the exact page before its certificate interstitial changes the URL.
  const site = await context.newPage();
  const targetUrl = `${http.url}?certificate-warning-target`;
  await site.goto(targetUrl);
  const tabId = await getTabId(probe, targetUrl);
  const probeTabId = await getTabId(probe, probe.url());
  expect(tabId).not.toBe(probeTabId);
  await expect.poll(async () => (await swCmd(probe, { cmd: 'badge', tabId })).text).toBe('');
  await expect.poll(warnedTabs).toEqual([]);

  await expect(site.goto(https.url)).rejects.toThrow(/net::ERR_CERT_AUTHORITY_INVALID\b/);

  // A warning on any other tab cannot satisfy this assertion.
  await expect.poll(warnedTabs, { timeout: 8000 }).toEqual([tabId]);
  await expect.poll(async () => swCmd(probe, { cmd: 'badge', tabId })).toEqual({
    text: '!',
    color: [220, 38, 38, 255], // #dc2626
  });
  expect((await swCmd(probe, { cmd: 'badge', tabId: probeTabId })).text).toBe('');
});
