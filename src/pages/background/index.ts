import { Vault } from '../../background/vault';
import { AutoLock } from '../../background/autolock';
import { loadHandle, ensurePermission, readBytes, writeBytes } from '../../background/fileHandle';
import { loadSettings } from '../../shared/settings';
import { generatePassword, DEFAULT_PWGEN } from '../../shared/pwgen';
import { updateIconForTab } from '../../background/icon';
import type { Request, Response } from '../../shared/messages';

const vault = new Vault();
let handle: FileSystemFileHandle | null = null;
const autolock = new AutoLock(() => doLock());

function doLock() { vault.lock(); handle = null; autolock.disarm(); refreshAllIcons(); }

async function handle_(req: Request): Promise<Response> {
  autolock.touch();
  switch (req.type) {
    case 'unlock': {
      handle = await loadHandle();
      if (!handle) return { ok: false, error: 'noFile' };
      if (!(await ensurePermission(handle, 'readwrite'))) return { ok: false, error: 'permission' };
      try {
        const bytes = await readBytes(handle);
        const keyFile = req.keyFile ? new Uint8Array(req.keyFile).buffer : null;
        await vault.open(bytes, req.password, keyFile);
      } catch { return { ok: false, error: 'badCredentials' }; }
      const s = await loadSettings(); autolock.arm(s.autoCloseHours); refreshAllIcons();
      return { ok: true };
    }
    case 'lock': doLock(); return { ok: true };
    case 'getStatus':
      return { ok: true, locked: !vault.isOpen(), dbName: handle?.name, dirty: vault.dirty };
    case 'getEntriesForUrl':
      return vault.isOpen() ? { ok: true, entries: vault.entriesForUrl(req.url) } : { ok: false, error: 'locked' };
    case 'getEntry':
      return { ok: true, entry: vault.getEntry(req.entryId) };
    case 'getTree':
      return vault.isOpen() ? { ok: true, tree: vault.getTree() } : { ok: false, error: 'locked' };
    case 'createEntry':
      return { ok: true, entryId: vault.createEntry(req.groupId, req.fields) };
    case 'updateEntry': vault.updateEntry(req.entryId, req.fields); return { ok: true };
    case 'updateGroup': vault.updateGroup(req.groupId, req.fields); return { ok: true };
    case 'save': {
      if (!handle) return { ok: false, error: 'noFile' };
      try { const bytes = await vault.serialize(); await writeBytes(handle, bytes); return { ok: true }; }
      catch (e) { return { ok: false, error: 'saveFailed' }; }
    }
    case 'generatePassword':
      return { ok: true, password: generatePassword(req.opts ?? DEFAULT_PWGEN) };
    case 'fillRequest': {
      const entry = vault.getEntry(req.entryId);
      if (!entry) return { ok: false, error: 'noEntry' };
      await chrome.tabs.sendMessage(req.tabId, { type: 'fill', username: entry.username, password: entry.password });
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((req: Request, _s, sendResponse) => {
  handle_(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // async
});

// keepalive: alarm heartbeat keeps the SW from idling out while unlocked
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => { if (vault.isOpen()) void chrome.runtime.getPlatformInfo(); });

// lock on browser close / SW suspend
chrome.runtime.onSuspend.addListener(doLock);
chrome.runtime.onStartup.addListener(doLock);

// per-tab icon
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) void updateIconForTab(tabId, tab.url, vault);
});
async function refreshAllIcons() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id && t.url) void updateIconForTab(t.id, t.url, vault);
}

// open side panel on action click is configured in panel task
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
