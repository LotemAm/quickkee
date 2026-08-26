import { Vault } from '../../background/vault';
import { AutoLock } from '../../background/autolock';
import { updateIconForTab } from '../../background/icon';
import { shouldWarnCertError } from '../../background/certwarn';
import type { Request } from '../../shared/messages';
import { retryPending } from '../../background/sync';
import type { DbSource } from '../../shared/dbSource';
import { clearAllDrafts } from '../../shared/createDraft';
import { makeRouter, depsFor, CLIPBOARD_CLEAR_ALARM, type SwContext } from './router';
import { registerTestCommands } from './testCommands';

const vault = new Vault();
let handle: FileSystemFileHandle | null = null;
const autolock = new AutoLock(() => doLock());

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

// Tracks tabs with an active cert-warning badge so match-count updates don't overwrite them.
const warnedTabs = new Set<number>();

function doLock() { vault.lock(); handle = null; currentSource = null; autolock.disarm(); void clearAllDrafts(); refreshAllIcons(); }

const ctx: SwContext = {
  vault,
  autolock,
  getHandle: () => handle,
  setHandle: h => { handle = h; },
  getCurrentSource: () => currentSource,
  setCurrentSource: s => { currentSource = s; },
  doLock,
  refreshAllIcons,
  online: onlineNow,
  persistPendingClipboardHash,
};

const handle_ = makeRouter(ctx);

chrome.runtime.onMessage.addListener((req: Request, sender, sendResponse) => {
  if ((req as unknown as { __qk?: string }).__qk === 'test') return false;
  if ((req as unknown as { __qkOffscreen?: boolean }).__qkOffscreen) return false;
  handle_(req, sender).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
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
    try { await retryPending(currentSource, depsFor(ctx, currentSource)); } catch { /* stays pending */ }
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

// Registered synchronously (not via dynamic import) so the test-command listener is live
// before the E2E harness can send its first `__qk: 'test'` message; a dynamic import here
// raced the harness and dropped early messages. The `if` stays a statically analyzable
// `import.meta.env.VITE_QK_TEST === '1'` check so production builds still dead-code-eliminate
// this branch (and, since it becomes the only reference to `registerTestCommands`, the
// unused import + the whole testCommands module get tree-shaken out too).
if (import.meta.env.VITE_QK_TEST === '1') {
  registerTestCommands({ ...ctx, warnedTabs });
}
