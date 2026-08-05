import { updateIconForTab } from './icon';

interface BadgeTextCall { tabId: number; text: string }
interface BadgeColorCall { tabId: number; color: string }

test('sets count + green when matches exist', async () => {
  const calls: { text?: BadgeTextCall; color?: BadgeColorCall } = {};
  (globalThis as unknown as { chrome: unknown }).chrome = { action: {
    setBadgeText: (a: BadgeTextCall) => { calls.text = a; return Promise.resolve(); },
    setBadgeBackgroundColor: (a: BadgeColorCall) => { calls.color = a; return Promise.resolve(); } } };
  const vault = { isOpen: () => true, countForUrl: () => 2 };
  await updateIconForTab(7, 'https://github.com', vault);
  expect(calls.text).toEqual({ tabId: 7, text: '2' });
  expect(calls.color?.color).toBe('#16a34a');
});

test('clears badge when locked', async () => {
  const calls: { text?: BadgeTextCall } = {};
  (globalThis as unknown as { chrome: unknown }).chrome = { action: {
    setBadgeText: (a: BadgeTextCall) => { calls.text = a; return Promise.resolve(); },
    setBadgeBackgroundColor: () => Promise.resolve() } };
  const vault = { isOpen: () => false, countForUrl: () => 0 };
  await updateIconForTab(7, 'https://x.com', vault);
  expect(calls.text).toEqual({ tabId: 7, text: '' });
});
