import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openWelcomeOnInstall } from './welcome';

const createTab = vi.fn().mockResolvedValue({});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://quickkee/${path}` },
    tabs: { create: createTab },
  });
});
afterEach(() => vi.unstubAllGlobals());

test('opens the welcome tab on first installation', async () => {
  await openWelcomeOnInstall({ reason: 'install' as chrome.runtime.OnInstalledReason });
  expect(createTab).toHaveBeenCalledExactlyOnceWith({
    url: 'chrome-extension://quickkee/src/pages/welcome/index.html',
  });
});

test.each(['update', 'chrome_update', 'shared_module_update'])('does not interrupt users on %s', async reason => {
  await openWelcomeOnInstall({ reason: reason as chrome.runtime.OnInstalledReason });
  expect(createTab).not.toHaveBeenCalled();
});
