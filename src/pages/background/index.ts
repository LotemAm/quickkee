import { Vault, isInvalidKey } from '../../background/vault';
import { AutoLock } from '../../background/autolock';
import { loadHandle, ensurePermission, readBytes, writeBytes } from '../../background/fileHandle';
import { loadSettings } from '../../shared/settings';
import { generatePassword, DEFAULT_PWGEN } from '../../shared/pwgen';
import { updateIconForTab } from '../../background/icon';
import { shouldWarnCertError } from '../../background/certwarn';
import { urlMatches } from '../../background/matcher';
import type { Request, Response } from '../../shared/messages';
import { providerFor, __hasOverride } from './cloudRouting';
import { openCloud, saveCloud, retryPending, type SyncDeps } from '../../background/sync';
import { getAccessToken, disconnect, DROPBOX_OAUTH, GDRIVE_OAUTH } from '../../background/sources/oauth';
import { getCache, cacheKey } from '../../background/cache';
import type { CloudFileSource, DbSource } from '../../shared/dbSource';
import { clearAllDrafts } from '../../shared/createDraft';

const vault = new Vault();
let handle: FileSystemFileHandle | null = null;
const autolock = new AutoLock(() => doLock());

const CLIPBOARD_CLEAR_ALARM = 'clipboard-clear';
let pendingClipboardHash: string | null = null;

async function persistPendingClipboardHash(hash: string | null): Promise<void> {
  pendingClipboardHash = hash;
  try {
    if (hash === null) await chrome.storage.session.remove('qkClipHash');
    else await chrome.storage.session.set({ qkClipHash: hash });
  } catch { /* storage.session may be unavailable in some test/dev contexts */ }
}

async function readPendingClipboardHash(): Promise<string | null> {
  if (pendingClipboardHash !== null) return pendingClipboardHash;
  try {
    const { qkClipHash } = await chrome.storage.session.get('qkClipHash');
    return typeof qkClipHash === 'string' ? qkClipHash : null;
  } catch { return null; }
}

async function ensureOffscreen(): Promise<void> {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/pages/offscreen/index.html'),
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: 'Clear copied password from the clipboard after the configured timeout',
  });
}

async function runClipboardClear(): Promise<void> {
  const textHash = await readPendingClipboardHash();
  if (!textHash) return;
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ __qkOffscreen: true, cmd: 'clearIfMatch', textHash });
  } catch { /* offscreen document unavailable; nothing more we can do */ }
  finally {
    await chrome.offscreen.closeDocument?.().catch(() => {});
    await persistPendingClipboardHash(null);
  }
}

let currentSource: DbSource | null = null;
const onlineNow = () => (typeof navigator !== 'undefined' ? navigator.onLine : true);

function depsFor(src: CloudFileSource): SyncDeps {
  return { vault, provider: providerFor(src.provider), online: onlineNow };
}

// Tracks tabs with an active cert-warning badge so match-count updates don't overwrite them.
const warnedTabs = new Set<number>();

function doLock() { vault.lock(); handle = null; currentSource = null; autolock.disarm(); void clearAllDrafts(); refreshAllIcons(); }

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
    case 'getEntrySummariesForUrl':
      return vault.isOpen() ? { ok: true, summaries: vault.entrySummariesForUrl(req.url) } : { ok: false, error: 'locked' };
    case 'getEntry':
      return { ok: true, entry: vault.getEntry(req.entryId) };
    case 'getTree':
      return vault.isOpen() ? { ok: true, tree: vault.getTree() } : { ok: false, error: 'locked' };
    case 'createEntry':
      return { ok: true, entryId: vault.createEntry(req.groupId, req.fields) };
    case 'updateEntry': vault.updateEntry(req.entryId, req.fields, req.expires, req.removeKeys); return { ok: true };
    case 'updateGroup': vault.updateGroup(req.groupId, req.fields); return { ok: true };
    case 'createGroup': return { ok: true, groupId: vault.createGroup(req.parentId, req.name) };
    case 'deleteGroup': vault.deleteGroup(req.groupId); return { ok: true };
    case 'deleteEntry': vault.deleteEntry(req.entryId); return { ok: true };
    case 'save': {
      if (currentSource?.kind === 'cloud') {
        try {
          const out = await saveCloud(currentSource, depsFor(currentSource));
          return out.merged ? { ok: true, merged: true } : { ok: true };
        } catch { return { ok: false, error: 'saveFailed' }; }
      }
      if (!handle) return { ok: false, error: 'noFile' };
      try { const bytes = await vault.serialize(); await writeBytes(handle, bytes); vault.dirty = false; return { ok: true }; }
      catch { return { ok: false, error: 'saveFailed' }; }
    }
    case 'connectCloud': {
      // In test mode with a fake provider installed, skip real OAuth.
      if (import.meta.env.VITE_QK_TEST === '1' && __hasOverride()) return { ok: true };
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
        return out.merged ? { ok: true, merged: true } : { ok: true };
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
    case 'disconnectCloud': {
      await disconnect(req.provider);
      // If the active vault is this provider's, lock so the next save can't route to a
      // now-credential-less provider (surprise OAuth popup). Local edits stay pendingUpload in cache.
      if (currentSource?.kind === 'cloud' && currentSource.provider === req.provider) doLock();
      return { ok: true };
    }
    case 'generatePassword':
      return { ok: true, password: generatePassword(req.opts ?? DEFAULT_PWGEN) };
    case 'fillRequest': {
      const entry = vault.getEntry(req.entryId);
      if (!entry) return { ok: false, error: 'noEntry' };
      let tab: chrome.tabs.Tab;
      try { tab = await chrome.tabs.get(req.tabId); }
      catch { return { ok: false, error: 'noTab' }; }
      // Entries without a URL can't be validated — allow (explicit user action from the popup).
      if (entry.url && (!tab.url || !urlMatches(entry.url, tab.url)))
        return { ok: false, error: 'urlMismatch' };
      await chrome.tabs.sendMessage(req.tabId, { type: 'fill', username: entry.username, password: entry.password });
      return { ok: true };
    }
    case 'scheduleClipboardClear':
      await persistPendingClipboardHash(req.textHash);
      chrome.alarms.create(CLIPBOARD_CLEAR_ALARM, { when: Date.now() + req.seconds * 1000 });
      return { ok: true };
    case 'cancelClipboardClear':
      await persistPendingClipboardHash(null);
      chrome.alarms.clear(CLIPBOARD_CLEAR_ALARM);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((req: Request, _s, sendResponse) => {
  if ((req as unknown as { __qk?: string }).__qk === 'test') return false;
  if ((req as unknown as { __qkOffscreen?: boolean }).__qkOffscreen) return false;
  handle_(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // async
});

// keepalive: alarm heartbeat keeps the SW from idling out while unlocked.
// 0.5 is Chrome's documented floor for periodInMinutes (30s, since Chrome 120); values
// below it are silently clamped up with a console warning, so state the real value instead
// of relying on that clamp. Whether this alarm cadence is actually sufficient to outrun the
// SW's 30s idle-eviction deadline is unconfirmed — see plans/reports/013-keepalive-findings.md.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });

// retry deferred cloud uploads when connectivity returns or on the keepalive tick
async function tryRetry() {
  if (currentSource?.kind === 'cloud' && onlineNow()) {
    try { await retryPending(currentSource, depsFor(currentSource)); } catch { /* stays pending */ }
  }
}
if (typeof self !== 'undefined' && 'addEventListener' in self) self.addEventListener('online', () => void tryRetry());
chrome.alarms.onAlarm.addListener(a => {
  switch (a.name) {
    case 'keepalive':
      if (vault.isOpen()) void chrome.runtime.getPlatformInfo(); // keepalive heartbeat (preserve MVP behavior)
      void tryRetry();
      break;
    case CLIPBOARD_CLEAR_ALARM:
      void runClipboardClear();
      break;
  }
});

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
          send({ count: vault.isOpen() ? vault.countForUrl(req.url) : 0, cert: warnedTabs.has(req.tabId) });
          break;
        case 'lock': doLock(); send({ ok: true }); break;
        case 'armShort': autolock.arm(req.hours); send({ ok: true }); break;
        case 'tabId': {
          const tabs = await chrome.tabs.query({});
          send({ id: tabs.find(t => t.url?.startsWith(req.url))?.id });
          break;
        }
        case 'warned': send({ tabs: Array.from(warnedTabs) }); break;
        case 'cloudInstall': {
          // Install a fake provider holding the given base64 .kdbx as remote rev "r1".
          const fake = (await import('./cloudRouting')).__makeFake(req.provider);
          const bin = atob(req.b64); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          fake.setFile(req.fileId, req.name, bytes.buffer, 'r1');
          (await import('./cloudRouting')).__setProviderOverride(fake);
          (globalThis as any).__qkFake = fake;
          send({ ok: true });
          break;
        }
        case 'cloudSetRemote': {
          // Replace remote bytes + bump rev to simulate another device's push.
          const fake = (globalThis as any).__qkFake as import('../../background/sources/fakeCloudProvider').FakeCloudProvider;
          const bin = atob(req.b64); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          fake.setFile(req.fileId, req.name, bytes.buffer, 'r2');
          send({ ok: true });
          break;
        }
        case 'cloudUploads': {
          const fake = (globalThis as any).__qkFake as import('../../background/sources/fakeCloudProvider').FakeCloudProvider;
          send({ count: fake?.uploads.length ?? 0 });
          break;
        }
        default: send({});
      }
    })();
    return true;
  });
}
