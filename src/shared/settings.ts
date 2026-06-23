import { DEFAULT_PWGEN, type PwGenOpts } from './pwgen';
import type { ThemeMode } from './theme';

export interface Settings { autoCloseHours: number; clipboardClearSeconds: number; pwgen: PwGenOpts; theme: ThemeMode }

export const DEFAULT_SETTINGS: Settings = { autoCloseHours: 8, clipboardClearSeconds: 30, pwgen: DEFAULT_PWGEN, theme: 'system' };

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}
