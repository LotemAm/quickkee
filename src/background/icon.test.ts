import { updateIconForTab } from './icon';

test('sets count + green when matches exist', async () => {
  const calls: any = {};
  (globalThis as any).chrome = { action: {
    setBadgeText: (a: any) => { calls.text = a; return Promise.resolve(); },
    setBadgeBackgroundColor: (a: any) => { calls.color = a; return Promise.resolve(); } } };
  const vault = { isOpen: () => true, entriesForUrl: () => [{}, {}] } as any;
  await updateIconForTab(7, 'https://github.com', vault);
  expect(calls.text).toEqual({ tabId: 7, text: '2' });
  expect(calls.color.color).toBe('#16a34a');
});

test('clears badge when locked', async () => {
  const calls: any = {};
  (globalThis as any).chrome = { action: {
    setBadgeText: (a: any) => { calls.text = a; return Promise.resolve(); },
    setBadgeBackgroundColor: () => Promise.resolve() } };
  const vault = { isOpen: () => false, entriesForUrl: () => [] } as any;
  await updateIconForTab(7, 'https://x.com', vault);
  expect(calls.text).toEqual({ tabId: 7, text: '' });
});
