import { Vault, isInvalidKey } from '../../background/vault';
import { AutoLock } from '../../background/autolock';
import { loadHandle, ensurePermission, readBytes, writeBytes } from '../../background/fileHandle';
import { loadSettings } from '../../shared/settings';
import { generatePassword, DEFAULT_PWGEN } from '../../shared/pwgen';
import { updateIconForTab } from '../../background/icon';
import { shouldWarnCertError } from '../../background/certwarn';
import type { Request, Response } from '../../shared/messages';
import { providerFor } from './cloudRouting';
import { openCloud, saveCloud, retryPending, type SyncDeps } from '../../background/sync';
import { getAccessToken, disconnect, DROPBOX_OAUTH, GDRIVE_OAUTH } from '../../background/sources/oauth';
import { getCache, cacheKey } from '../../background/cache';
import type { CloudFileSource, DbSource } from '../../shared/dbSource';

const vault = new Vault();
let handle: FileSystemFileHandle | null = null;
const autolock = new AutoLock(() => doLock());

let currentSource: DbSource | null = null;
const onlineNow = () => (typeof navigator !== 'undefined' ? navigator.onLine : true);

function depsFor(src: CloudFileSource): SyncDeps {
  return { vault, provider: providerFor(src.provider), online: onlineNow };
}

// Tracks tabs with an active cert-warning badge so match-count updates don't overwrite them.
const warnedTabs = new Set<number>();

function doLock() { vault.lock(); handle = null; currentSource = null; autolock.disarm(); refreshAllIcons(); }

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
      } catch (e) {
        if (isInvalidKey(e)) return { ok: false, error: 'badCredentials' };
        // Surface non-credential failures (corrupt file, missing WASM/CSP, runtime) instead of masking them.
        return { ok: false, error: `unlockFailed: ${e instanceof Error ? e.message : String(e)}` };
      }
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
      if (currentSource?.kind === 'cloud') {
        try {
          const out = await saveCloud(currentSource, depsFor(currentSource));
          return out.merged ? ({ ok: true, merged: true } as Response) : { ok: true };
        } catch (e) { return { ok: false, error: 'saveFailed' }; }
      }
      if (!handle) return { ok: false, error: 'noFile' };
      try { const bytes = await vault.serialize(); await writeBytes(handle, bytes); return { ok: true }; }
      catch (e) { return { ok: false, error: 'saveFailed' }; }
    }
    case 'connectCloud': {
      try {
        await getAccessToken(req.provider === 'dropbox' ? DROPBOX_OAUTH : GDRIVE_OAUTH);
        return { ok: true };
      } catch { return { ok: false, error: 'authRequired' }; }
    }
    case 'listRemoteFiles': {
      try { return { ok: true, files: await providerFor(req.provider).listKdbxFiles() }; }
      catch { return { ok: false, error: 'authRequired' }; }
    }
    case 'openRemote': {
      const src: CloudFileSource = { kind: 'cloud', provider: req.provider, fileId: req.fileId, basedOnRev: '' };
      try {
        const keyFile = req.keyFile ? new Uint8Array(req.keyFile).buffer : null;
        const out = await openCloud(src, depsFor(src), req.password, keyFile);
        currentSource = src;
        const s = await loadSettings(); autolock.arm(s.autoCloseHours); refreshAllIcons();
        return out.merged ? ({ ok: true, merged: true } as Response) : { ok: true };
      } catch (e) {
        if (isInvalidKey(e)) return { ok: false, error: 'badCredentials' };
        return { ok: false, error: `openFailed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case 'getSyncStatus': {
      if (!currentSource || currentSource.kind !== 'cloud')
        return { ok: true, source: currentSource?.kind ?? null, pendingUpload: false, online: onlineNow() };
      const rec = await getCache(cacheKey(currentSource.provider, currentSource.fileId));
      return {
        ok: true, source: 'cloud', provider: currentSource.provider,
        pendingUpload: rec?.pendingUpload ?? false, online: onlineNow(), lastSyncedAt: rec?.lastSyncedAt,
      };
    }
    case 'disconnectCloud': { await disconnect(req.provider); return { ok: true }; }
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
  if ((req as unknown as { __qk?: string }).__qk === 'test') return false;
  handle_(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // async
});

// keepalive: alarm heartbeat keeps the SW from idling out while unlocked
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });

// retry deferred cloud uploads when connectivity returns or on the keepalive tick
async function tryRetry() {
  if (currentSource?.kind === 'cloud' && onlineNow()) {
    try { await retryPending(currentSource, depsFor(currentSource)); } catch { /* stays pending */ }
  }
}
if (typeof self !== 'undefined' && 'addEventListener' in self) self.addEventListener('online', () => void tryRetry());
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'keepalive') void tryRetry(); });

// lock on browser close / SW suspend
chrome.runtime.onSuspend.addListener(doLock);
chrome.runtime.onStartup.addListener(doLock);

// per-tab icon
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    if (warnedTabs.has(tabId)) return; // cert warning badge takes priority
    void updateIconForTab(tabId, tab.url, vault);
  }
});
async function refreshAllIcons() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id && t.url && !warnedTabs.has(t.id)) void updateIconForTab(t.id, t.url, vault);
  }
}

// open side panel on action click is configured in panel task
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

// certificate error warning badge
// Clear the warning when a new top-frame navigation starts so a stale ! doesn't linger.
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId === 0) warnedTabs.delete(details.tabId);
});

chrome.webNavigation.onErrorOccurred.addListener(details => {
  if (details.frameId !== 0 || !shouldWarnCertError(details)) return;
  warnedTabs.add(details.tabId);
  void chrome.action.setBadgeText({ tabId: details.tabId, text: '!' });
  void chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#dc2626' });
  void chrome.action.setTitle({ tabId: details.tabId, title: 'Warning: certificate error on this site' });
});

if (import.meta.env.VITE_QK_TEST === '1') {
  chrome.runtime.onMessage.addListener((req: any, _s, send) => {
    if (!req || req.__qk !== 'test') return false;
    (async () => {
      switch (req.cmd) {
        case 'badge': {
          const text = await chrome.action.getBadgeText({ tabId: req.tabId });
          const color = await chrome.action.getBadgeBackgroundColor({ tabId: req.tabId });
          send({ text, color });
          break;
        }
        case 'match':
          send({ count: vault.isOpen() ? vault.entriesForUrl(req.url).length : 0, cert: warnedTabs.has(req.tabId) });
          break;
        case 'lock': doLock(); send({ ok: true }); break;
        case 'armShort': autolock.arm(req.hours); send({ ok: true }); break;
        case 'tabId': {
          const tabs = await chrome.tabs.query({});
          send({ id: tabs.find(t => t.url?.startsWith(req.url))?.id });
          break;
        }
        case 'warned': send({ tabs: Array.from(warnedTabs) }); break;
        default: send({});
      }
    })();
    return true;
  });
}
