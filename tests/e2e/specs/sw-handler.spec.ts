import { test, expect, openExtensionPage, installDb, swCmd } from '../helpers';

test('sw test handler reports locked match count of 0 before unlock', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  const r = await swCmd(popup, { cmd: 'match', url: 'http://localhost/', tabId: -1 });
  expect(r).toEqual({ count: 0, cert: false });
});
