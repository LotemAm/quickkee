import type { Vault } from './vault';

export async function updateIconForTab(
  tabId: number, url: string, vault: Pick<Vault, 'isOpen' | 'countForUrl'>,
): Promise<void> {
  const count = vault.isOpen() ? vault.countForUrl(url) : 0;
  await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: count > 0 ? '#16a34a' : '#6b7280' });
}
