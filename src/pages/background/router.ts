import { Vault, isInvalidKey } from '../../background/vault';
import { AutoLock } from '../../background/autolock';
import { loadHandle, ensurePermission, readBytes, writeBytes } from '../../background/fileHandle';
import { loadSettings } from '../../shared/settings';
import { generatePassword, DEFAULT_PWGEN } from '../../shared/pwgen';
import { urlMatches } from '../../background/matcher';
import type { Request, Response } from '../../shared/messages';
import { CARDHOLDER_NAME_KEY } from '../../shared/entry';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../../shared/bytes';
import { providerFor, __hasOverride } from './cloudRouting';
import { openCloud, saveCloud, type SyncDeps } from '../../background/sync';
import { getAccessToken, disconnect, DROPBOX_OAUTH, GDRIVE_OAUTH } from '../../background/sources/oauth';
import { getCache, cacheKey } from '../../background/cache';
import type { CloudFileSource, DbSource } from '../../shared/dbSource';
import { generateTotp } from '../../background/totp';

/** Name of the alarm used to schedule a deferred clipboard clear (shared with lifecycle wiring in index.ts). */
export const CLIPBOARD_CLEAR_ALARM = 'clipboard-clear';

/** Dependencies + mutable SW state the router needs, injected so it can be tested without `chrome.*` globals. */
export interface SwContext {
  vault: Vault;
  autolock: AutoLock;
  getHandle(): FileSystemFileHandle | null;
  setHandle(h: FileSystemFileHandle | null): void;
  getCurrentSource(): DbSource | null;
  setCurrentSource(s: DbSource | null): void;
  doLock(): void;
  refreshAllIcons(): void;
  online(): boolean;
  persistPendingClipboardHash(hash: string | null): Promise<void>;
}

export function depsFor(ctx: SwContext, src: CloudFileSource): SyncDeps {
  return { vault: ctx.vault, provider: providerFor(src.provider), online: ctx.online };
}

function isExtensionPage(sender: chrome.runtime.MessageSender, ...pages: Array<'popup' | 'panel'>): boolean {
  if (!sender.url) return false;
  try {
    const url = new URL(sender.url);
    if (url.protocol !== 'chrome-extension:') return false;
    const path = url.pathname;
    return pages.some(page => path.endsWith(`/src/pages/${page}/index.html`));
  } catch { return false; }
}

/** Builds the SW message handler bound to `ctx`. Moved verbatim from index.ts (plan 009). */
export function makeRouter(ctx: SwContext) {
  return async function handle_(req: Request, sender: chrome.runtime.MessageSender = {}): Promise<Response> {
    ctx.autolock.touch();
    switch (req.type) {
      case 'unlock': {
        const handle = await loadHandle();
        ctx.setHandle(handle);
        if (!handle) return { ok: false, error: 'noFile' };
        if (!(await ensurePermission(handle, 'readwrite'))) return { ok: false, error: 'permission' };
        try {
          const bytes = await readBytes(handle);
          const keyFile = req.keyFile ? new Uint8Array(req.keyFile).buffer : null;
          await ctx.vault.open(bytes, req.password, keyFile);
        } catch (e) {
          if (isInvalidKey(e)) return { ok: false, error: 'badCredentials' };
          // Surface non-credential failures (corrupt file, missing WASM/CSP, runtime) instead of masking them.
          return { ok: false, error: `unlockFailed: ${e instanceof Error ? e.message : String(e)}` };
        }
        const s = await loadSettings(); ctx.autolock.arm(s.autoCloseHours); ctx.refreshAllIcons();
        return { ok: true };
      }
      case 'lock': ctx.doLock(); return { ok: true };
      case 'getStatus':
        return { ok: true, locked: !ctx.vault.isOpen(), dbName: ctx.getHandle()?.name, dirty: ctx.vault.dirty };
      case 'getEntriesForUrl':
        return ctx.vault.isOpen() ? { ok: true, entries: ctx.vault.entriesForUrl(req.url) } : { ok: false, error: 'locked' };
      case 'getEntrySummariesForUrl':
        return ctx.vault.isOpen() ? { ok: true, summaries: ctx.vault.entrySummariesForUrl(req.url) } : { ok: false, error: 'locked' };
      case 'getCardEntrySummariesForUrl':
        return ctx.vault.isOpen() ? { ok: true, summaries: ctx.vault.cardSummariesForUrl(req.url) } : { ok: false, error: 'locked' };
      case 'getEntry':
        return { ok: true, entry: ctx.vault.getEntry(req.entryId) };
      case 'getTotpConfig': {
        if (!isExtensionPage(sender, 'panel')) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        try { return { ok: true, config: ctx.vault.getTotpConfig(req.entryId) }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'invalidTotp' }; }
      }
      case 'getTotpCode': {
        if (!isExtensionPage(sender, 'popup', 'panel')) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        try {
          const config = ctx.vault.getTotpConfig(req.entryId);
          if (!config) return { ok: false, error: 'noTotp' };
          return { ok: true, ...await generateTotp(config) };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'invalidTotp' }; }
      }
      case 'previewTotp': {
        if (!isExtensionPage(sender, 'panel')) return { ok: false, error: 'forbidden' };
        try { return { ok: true, ...await generateTotp(req.config) }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'invalidTotp' }; }
      }
      case 'getTree':
        return ctx.vault.isOpen() ? { ok: true, tree: ctx.vault.getTree() } : { ok: false, error: 'locked' };
      case 'createEntry':
        return { ok: true, entryId: ctx.vault.createEntry(req.groupId, req.fields, req.totp) };
      case 'updateEntry': ctx.vault.updateEntry(req.entryId, req.fields, req.expires, req.removeKeys, req.totp); return { ok: true };
      case 'updateGroup': ctx.vault.updateGroup(req.groupId, req.fields); return { ok: true };
      case 'createGroup': return { ok: true, groupId: ctx.vault.createGroup(req.parentId, req.name) };
      case 'deleteGroup': ctx.vault.deleteGroup(req.groupId); return { ok: true };
      case 'deleteEntry': ctx.vault.deleteEntry(req.entryId); return { ok: true };
      case 'addAttachment': {
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        try {
          await ctx.vault.addAttachment(req.entryId, req.name, base64ToArrayBuffer(req.data));
          return { ok: true };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'addAttachmentFailed' }; }
      }
      case 'removeAttachment': {
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        try { ctx.vault.removeAttachment(req.entryId, req.name); return { ok: true }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'removeAttachmentFailed' }; }
      }
      case 'getAttachment': {
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const bytes = ctx.vault.getAttachmentBytes(req.entryId, req.name);
        if (!bytes) return { ok: false, error: 'noAttachment' };
        return { ok: true, data: arrayBufferToBase64(bytes) };
      }
      case 'save': {
        const currentSource = ctx.getCurrentSource();
        if (currentSource?.kind === 'cloud') {
          try {
            const out = await saveCloud(currentSource, depsFor(ctx, currentSource));
            return out.merged ? { ok: true, merged: true } : { ok: true };
          } catch { return { ok: false, error: 'saveFailed' }; }
        }
        const handle = ctx.getHandle();
        if (!handle) return { ok: false, error: 'noFile' };
        try { const bytes = await ctx.vault.serialize(); await writeBytes(handle, bytes); ctx.vault.dirty = false; return { ok: true }; }
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
          const out = await openCloud(src, depsFor(ctx, src), req.password, keyFile);
          ctx.setCurrentSource(src);
          const s = await loadSettings(); ctx.autolock.arm(s.autoCloseHours); ctx.refreshAllIcons();
          return out.merged ? { ok: true, merged: true } : { ok: true };
        } catch (e) {
          if (isInvalidKey(e)) return { ok: false, error: 'badCredentials' };
          return { ok: false, error: `openFailed: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      case 'getSyncStatus': {
        let currentSource = ctx.getCurrentSource();
        if (!currentSource || currentSource.kind !== 'cloud')
          return { ok: true, source: currentSource?.kind ?? null, pendingUpload: false, online: ctx.online() };
        const rec = await getCache(cacheKey(currentSource.provider, currentSource.fileId));
        // Re-read live state after the await: the pre-extraction code closed directly over
        // the mutable module-level `currentSource` and read it fresh at each reference, so a
        // concurrent handler (disconnectCloud/openRemote) mutating it while this await was
        // pending was reflected here. Reusing the pre-await snapshot would be a behavior
        // change from the original — see router.test.ts for the characterization test.
        currentSource = ctx.getCurrentSource();
        return {
          ok: true, source: 'cloud', provider: (currentSource as CloudFileSource).provider,
          pendingUpload: rec?.pendingUpload ?? false, online: ctx.online(), lastSyncedAt: rec?.lastSyncedAt,
        };
      }
      case 'disconnectCloud': {
        await disconnect(req.provider);
        // If the active vault is this provider's, lock so the next save can't route to a
        // now-credential-less provider (surprise OAuth popup). Local edits stay pendingUpload in cache.
        const currentSource = ctx.getCurrentSource();
        if (currentSource?.kind === 'cloud' && currentSource.provider === req.provider) ctx.doLock();
        return { ok: true };
      }
      case 'generatePassword':
        return { ok: true, password: generatePassword(req.opts ?? DEFAULT_PWGEN) };
      case 'fillRequest': {
        const entry = ctx.vault.getEntry(req.entryId);
        if (!entry) return { ok: false, error: 'noEntry' };
        let tab: chrome.tabs.Tab;
        try { tab = await chrome.tabs.get(req.tabId); }
        catch { return { ok: false, error: 'noTab' }; }
        // Entries without a URL can't be validated — allow (explicit user action from the popup).
        if (entry.url && (!tab.url || !urlMatches(entry.url, tab.url)))
          return { ok: false, error: 'urlMismatch' };
        // Card-marked entries are filled into detected card-form fields (cc-number/cc-csc/
        // cc-exp/cc-name) rather than generic username/password fields; regular login
        // entries keep going through the plain 'fill' message.
        if (entry.isCard) {
          const cardholderName = entry.fields.find(f => f.key === CARDHOLDER_NAME_KEY)?.value ?? '';
          await chrome.tabs.sendMessage(req.tabId, {
            type: 'fillCard', number: entry.username, cvv: entry.password, cardholderName, expires: entry.expires,
          });
        } else {
          try {
            const config = ctx.vault.getTotpConfig(entry.id);
            const totp = config ? (await generateTotp(config)).code : undefined;
            await chrome.tabs.sendMessage(req.tabId, {
              type: 'fill', username: entry.username, password: entry.password, ...(totp ? { totp } : {}),
            });
          } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'invalidTotp' }; }
        }
        return { ok: true };
      }
      case 'fillTotpRequest': {
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const entry = ctx.vault.getEntry(req.entryId);
        if (!entry) return { ok: false, error: 'noEntry' };
        const tabId = sender.tab?.id;
        const pageUrl = sender.url ?? sender.tab?.url;
        if (tabId == null || !pageUrl) return { ok: false, error: 'forbidden' };
        if (entry.url && !urlMatches(entry.url, pageUrl)) return { ok: false, error: 'urlMismatch' };
        try {
          const config = ctx.vault.getTotpConfig(entry.id);
          if (!config) return { ok: false, error: 'noTotp' };
          const { code } = await generateTotp(config);
          await chrome.tabs.sendMessage(tabId, { type: 'fillTotp', code }, { frameId: sender.frameId ?? 0 });
          return { ok: true };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'invalidTotp' }; }
      }
      case 'scheduleClipboardClear':
        await ctx.persistPendingClipboardHash(req.textHash);
        chrome.alarms.create(CLIPBOARD_CLEAR_ALARM, { when: Date.now() + req.seconds * 1000 });
        return { ok: true };
      case 'cancelClipboardClear':
        await ctx.persistPendingClipboardHash(null);
        chrome.alarms.clear(CLIPBOARD_CLEAR_ALARM);
        return { ok: true };
    }
  };
}
