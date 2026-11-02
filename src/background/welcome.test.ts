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
  await openWelcomeOnInstall({ reason: 'install' });
  expect(createTab).toHaveBeenCalledExactlyOnceWith({
    url: 'chrome-extension://quickkee/src/pages/welcome/index.html',
  });
});

const updateEvents: chrome.runtime.InstalledDetails[] = [
  { reason: 'update', previousVersion: '0.4.0' },
  { reason: 'chrome_update' },
  { reason: 'shared_module_update', id: 'shared-module' },
];

test.each(updateEvents)('does not interrupt users on $reason', async details => {
  await openWelcomeOnInstall(details);
  expect(createTab).not.toHaveBeenCalled();
});
