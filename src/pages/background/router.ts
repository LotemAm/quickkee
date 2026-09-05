import { Vault, isInvalidKey } from '../../background/vault';
import { AutoLock } from '../../background/autolock';
import { loadHandle, ensurePermission, hasPermission, readBytes, writeBytes } from '../../background/fileHandle';
import { loadSettings } from '../../shared/settings';
import { generatePassword, DEFAULT_PWGEN } from '../../shared/pwgen';
import { urlMatches } from '../../background/matcher';
import { resolvePopupFillTargets, resolveInlineFillTarget, revalidatePopupFillTarget, revalidateInlineFillTarget } from '../../background/fillTargets';
import type { Request, Response } from '../../shared/messages';
import { CARDHOLDER_NAME_KEY } from '../../shared/entry';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../../shared/bytes';
import { providerFor, __hasOverride } from './cloudRouting';
import { openCloud, saveCloud, type SyncDeps } from '../../background/sync';
import { getAccessToken, disconnect, DROPBOX_OAUTH, hasStoredRefreshToken } from '../../background/sources/oauth';
import { disconnectGoogle, getGoogleAccessToken, isGoogleConnected } from '../../background/sources/googleOAuth';
import { getCache, cacheKey } from '../../background/cache';
import type { CloudFileSource, DbSource } from '../../shared/dbSource';
import { generateTotp } from '../../background/totp';
import type { CredentialCaptureStore, CredentialCaptureRecord } from '../../background/credentialCaptureStore';
import type { CredentialPromptEntry, CredentialPromptMetadata, ResponseFor } from '../../shared/messages';
import {
  clearQuickUnlockEnrollment,
  loadQuickUnlockEnrollment,
  saveQuickUnlockEnrollment,
} from '../../background/quickUnlockStore';
import { unwrapQuickUnlockMaterial, wrapQuickUnlockMaterial } from '../../background/quickUnlockCrypto';
import { quickUnlockSourceMatches, type QuickUnlockSource, type QuickUnlockSourceIdentity } from '../../shared/quickUnlock';
import { quickUnlockInfo, quickUnlockWarn } from '../../shared/quickUnlockDebug';
import { flattenGroups } from '../../shared/groups';

/** Name of the alarm used to schedule a deferred clipboard clear (shared with lifecycle wiring in index.ts). */
export const CLIPBOARD_CLEAR_ALARM = 'clipboard-clear';

/** Dependencies + mutable SW state the router needs, injected so it can be tested without `chrome.*` globals. */
export interface SwContext {
  vault: Vault;
  credentialCaptures: CredentialCaptureStore;
  autolock: AutoLock;
  getHandle(): FileSystemFileHandle | null;
  setHandle(h: FileSystemFileHandle | null): void;
  getCurrentSource(): DbSource | null;
  setCurrentSource(s: DbSource | null): void;
  doLock(): void;
  refreshAllIcons(): void;
  online(): boolean;
  cloudConnected?(provider: 'dropbox' | 'gdrive'): Promise<boolean>;
  persistPendingClipboardHash(hash: string | null): Promise<void>;
  publishStatus?(): void;
}

export function depsFor(ctx: SwContext, src: CloudFileSource): SyncDeps {
  return { vault: ctx.vault, provider: providerFor(src.provider), online: ctx.online,
    isCurrent: () => ctx.getCurrentSource() === src };
}

function isExtensionPage(sender: chrome.runtime.MessageSender, ...pages: Array<'popup' | 'panel' | 'options'>): boolean {
  if (!sender.url) return false;
  try {
    const url = new URL(sender.url);
    if (url.protocol !== 'chrome-extension:' && url.protocol !== 'moz-extension:') return false;
    if (url.protocol === 'chrome-extension:' && url.hostname !== chrome.runtime.id) return false;
    const path = url.pathname;
    return pages.some(page => path.endsWith(`/src/pages/${page}/index.html`));
  } catch { return false; }
}

function validSecretBytes(bytes: number[], expectedLength?: number): boolean {
  return Array.isArray(bytes)
    && (expectedLength === undefined || bytes.length === expectedLength)
    && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

/** Track preceding reads and our own successful open; never adopt a token read after an await. */
function captureOpen(ctx: SwContext) {
  let session = ctx.vault.lifecycleGeneration;
  let source = ctx.getCurrentSource();
  let handle = ctx.getHandle();
  let mutationVersion = ctx.vault.mutationVersion;
  const sourceCurrent = () => ctx.getCurrentSource() === source && ctx.getHandle() === handle;
  const guard = () => {
    if (ctx.vault.lifecycleGeneration !== session || ctx.vault.mutationVersion !== mutationVersion || !sourceCurrent()) throw new Error('staleSession');
  };
  return {
    guard, sourceCurrent,
    opened(token: number) {
      if (!ctx.vault.isSessionCurrent(token) || !sourceCurrent()) throw new Error('staleSession');
      session = token;
      mutationVersion = ctx.vault.mutationVersion;
    },
    install(nextHandle: FileSystemFileHandle | null, next: DbSource) {
      guard();
      ctx.setHandle(nextHandle); ctx.setCurrentSource(next); source = next; handle = nextHandle;
    },
  };
}

function finishOpen(ctx: SwContext, autoCloseHours: number): void {
  ctx.autolock.arm(autoCloseHours);
  ctx.publishStatus?.();
}

/** Optional presentation work cannot turn a committed open into a reported failure. */
function refreshAfterOpen(ctx: SwContext): void {
  try { void Promise.resolve(ctx.refreshAllIcons()).catch(() => {}); }
  catch { /* The session is already committed. */ }
}

async function openLocalVault(
  ctx: SwContext,
  handle: FileSystemFileHandle,
  password: string | null,
  keyFile: ArrayBuffer | null,
  opening = captureOpen(ctx),
): Promise<void> {
  opening.guard();
  const bytes = await readBytes(handle);
  opening.guard();
  const settings = await loadSettings();
  opening.guard();
  const session = await ctx.vault.open(bytes, password, keyFile);
  opening.opened(session);
  opening.install(handle, { kind: 'local', handleId: 'db' });
  finishOpen(ctx, settings.autoCloseHours);
  refreshAfterOpen(ctx);
}

async function openCloudVault(
  ctx: SwContext,
  source: CloudFileSource,
  password: string | null,
  keyFile: ArrayBuffer | null,
  opening = captureOpen(ctx),
) {
  opening.guard();
  const settings = await loadSettings();
  opening.guard();
  const outcome = await openCloud(source, { ...depsFor(ctx, source),
    isCurrent: opening.sourceCurrent,
    commitOpen: adopt => {
      opening.guard();
      const session = adopt();
      opening.opened(session);
      opening.install(null, source);
      finishOpen(ctx, settings.autoCloseHours);
      return session;
    },
  }, password, keyFile);
  opening.guard();
  refreshAfterOpen(ctx);
  return outcome;
}

function sourceMatchesActive(source: QuickUnlockSource, ctx: SwContext): boolean {
  const active = ctx.getCurrentSource();
  let selected: QuickUnlockSourceIdentity | null = null;
  if (active?.kind === 'local') {
    const label = ctx.getHandle()?.name;
    if (label) selected = { kind: 'local', label };
  } else if (active?.kind === 'cloud') {
    selected = { kind: 'cloud', provider: active.provider, fileId: active.fileId };
  }
  return quickUnlockSourceMatches(source, selected);
}

async function cloudConnected(ctx: SwContext, provider: 'dropbox' | 'gdrive'): Promise<boolean> {
  if (ctx.cloudConnected) return ctx.cloudConnected(provider);
  if (import.meta.env.VITE_QK_TEST === '1' && __hasOverride()) return true;
  return provider === 'dropbox' ? hasStoredRefreshToken('dropbox') : isGoogleConnected();
}

function contentAuthority(sender: chrome.runtime.MessageSender): { tabId: number; url: string } | null {
  if (sender.frameId !== 0 || sender.tab?.id == null || !sender.url) return null;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'http:' || url.protocol === 'https:' ? { tabId: sender.tab.id, url: sender.url } : null;
  } catch { return null; }
}

function normalizedUsername(username: string): string {
  return username.trim().toLocaleLowerCase();
}

function promptEntry(entry: ReturnType<Vault['entriesForUrl']>[number]): CredentialPromptEntry {
  return { id: entry.id, title: entry.title, username: entry.username };
}

function classifyCapture(record: CredentialCaptureRecord, vault: Vault): {
  identical: boolean;
  suggestedAction: CredentialPromptMetadata['suggestedAction'];
  entries: CredentialPromptEntry[];
} {
  const matching = vault.entriesForUrl(record.sourceUrl).filter(entry => !entry.isCard);
  const username = normalizedUsername(record.username);
  if (matching.some(entry => normalizedUsername(entry.username) === username && entry.password === record.password))
    return { identical: true, suggestedAction: 'save', entries: [] };

  if (record.mutation) {
    const target = matching.find(entry => entry.id === record.mutation?.entryId);
    return {
      identical: false,
      suggestedAction: record.mutation.type === 'update' ? 'update' : 'save',
      entries: target && record.mutation.type === 'update' ? [promptEntry(target)] : [],
    };
  }

  const plausible = username
    ? matching.filter(entry => normalizedUsername(entry.username) === username)
    : matching;
  if (plausible.length === 1)
    return { identical: false, suggestedAction: 'update', entries: plausible.map(promptEntry) };
  if (plausible.length > 1)
    return { identical: false, suggestedAction: 'choose', entries: plausible.map(promptEntry) };
  return { identical: false, suggestedAction: 'save', entries: [] };
}

async function persistVault(ctx: SwContext): Promise<ResponseFor<'save'>> {
  const currentSource = ctx.getCurrentSource();
  if (currentSource?.kind === 'cloud') {
    try {
      const out = await saveCloud(currentSource, depsFor(ctx, currentSource));
      return out.merged ? { ok: true, merged: true } : { ok: true };
    } catch { return { ok: false, error: 'saveFailed' }; }
  }
  const handle = ctx.getHandle();
  if (!handle) return { ok: false, error: 'noFile' };
  const session = ctx.vault.lifecycleGeneration;
  const mutationVersion = ctx.vault.mutationVersion;
  const guard = () => {
    if (!ctx.vault.isSessionCurrent(session) || ctx.getCurrentSource() !== currentSource || ctx.getHandle() !== handle)
      throw new Error('staleSession');
  };
  try {
    guard();
    const bytes = await ctx.vault.serialize();
    guard();
    await writeBytes(handle, bytes);
    guard();
    ctx.vault.acknowledgeCached(session, mutationVersion);
    return { ok: true };
  } catch { return { ok: false, error: 'saveFailed' }; }
}

function canonicalSiteUrl(url: string): string {
  return `${new URL(url).origin}/`;
}

function defaultEntryTitle(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** Builds the SW message handler bound to `ctx`. Moved verbatim from index.ts (plan 009). */
export function makeRouter(ctx: SwContext) {
  return async function handle_(req: Request, sender: chrome.runtime.MessageSender = {}): Promise<Response> {
    try {
    switch (req.type) {
      // Only explicit input and successful fill/capture actions count as activity.
      // Polls, TOTP refreshes and future status subscriptions must never touch here.
      case 'vaultActivity': {
        if (sender.id !== chrome.runtime.id) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const token = ctx.vault.lifecycleGeneration;
        const fromPage = isExtensionPage(sender, 'popup', 'panel') &&
          new URL(sender.url!).protocol === 'chrome-extension:' &&
          ['/src/pages/popup/index.html', '/src/pages/panel/index.html'].includes(new URL(sender.url!).pathname);
        if (!fromPage) {
          if (!Number.isInteger(sender.tab?.id) || sender.tab!.id! < 0) return { ok: false, error: 'forbidden' };
          try { await resolveInlineFillTarget(sender, ''); }
          catch { return { ok: false, error: 'forbidden' }; }
        }
        if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
        ctx.autolock.touch();
        return { ok: true };
      }
      case 'unlock': {
        const opening = captureOpen(ctx);
        const keyBytes = req.keyFile ? new Uint8Array(req.keyFile) : null;
        try {
          const handle = await loadHandle();
          opening.guard();
          if (!handle) return { ok: false, error: 'noFile' };
          const permitted = await ensurePermission(handle, 'readwrite');
          opening.guard();
          if (!permitted) return { ok: false, error: 'permission' };
          const keyFile = keyBytes
            ? keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer
            : null;
          await openLocalVault(ctx, handle, req.password, keyFile, opening);
        } catch (e) {
          if (isInvalidKey(e)) return { ok: false, error: 'badCredentials' };
          // Surface non-credential failures (corrupt file, missing WASM/CSP, runtime) instead of masking them.
          return { ok: false, error: `unlockFailed: ${e instanceof Error ? e.message : String(e)}` };
        } finally { keyBytes?.fill(0); req.keyFile?.fill(0); }
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
      case 'getEntryNotes': {
        if (!isExtensionPage(sender, 'panel')) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        try { return { ok: true, notes: ctx.vault.getEntryNotes(req.entryId) }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Could not load Notes.' }; }
      }
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
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        try { return { ok: true, ...await generateTotp(req.config) }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'invalidTotp' }; }
      }
      case 'importTotp': {
        if (!isExtensionPage(sender, 'panel')) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        try { ctx.vault.importTotp(req.assignments); return { ok: true }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'importTotpFailed' }; }
      }
      case 'getTree':
        return ctx.vault.isOpen() ? { ok: true, tree: ctx.vault.getTree() } : { ok: false, error: 'locked' };
      case 'getPasswordHealthReport':
        if (!isExtensionPage(sender, 'panel')) return { ok: false, error: 'forbidden' };
        return ctx.vault.isOpen()
          ? { ok: true, report: ctx.vault.getPasswordHealthReport() }
          : { ok: false, error: 'locked' };
      case 'createEntry':
        return { ok: true, entryId: ctx.vault.createEntry(req.groupId, req.fields, req.totp, req.expires) };
      case 'updateEntry': ctx.vault.updateEntry(req.entryId, req.fields, req.expires, req.removeKeys, req.totp, req.groupId); return { ok: true };
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
        return persistVault(ctx);
      }
      case 'connectCloud': {
        // In test mode with a fake provider installed, skip real OAuth.
        if (import.meta.env.VITE_QK_TEST === '1' && __hasOverride()) return { ok: true };
        try {
          if (req.provider === 'dropbox') await getAccessToken(DROPBOX_OAUTH);
          else await getGoogleAccessToken({ interactive: true });
          return { ok: true };
        } catch { return { ok: false, error: 'authRequired' }; }
      }
      case 'getCloudConnectionStatus': {
        const [dropbox, gdrive] = await Promise.all([
          hasStoredRefreshToken('dropbox'),
          isGoogleConnected(),
        ]);
        return { ok: true, connected: { dropbox, gdrive } };
      }
      case 'listRemoteFiles': {
        try { return { ok: true, files: await providerFor(req.provider).listKdbxFiles() }; }
        catch { return { ok: false, error: 'authRequired' }; }
      }
      case 'openRemote': {
        const src: CloudFileSource = { kind: 'cloud', provider: req.provider, fileId: req.fileId, basedOnRev: '' };
        const keyBytes = req.keyFile ? new Uint8Array(req.keyFile) : null;
        try {
          const keyFile = keyBytes
            ? keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer
            : null;
          const out = await openCloudVault(ctx, src, req.password, keyFile);
          return out.merged ? { ok: true, merged: true } : { ok: true };
        } catch (e) {
          if (isInvalidKey(e)) return { ok: false, error: 'badCredentials' };
          return { ok: false, error: `openFailed: ${e instanceof Error ? e.message : String(e)}` };
        } finally { keyBytes?.fill(0); req.keyFile?.fill(0); }
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
        if (!isExtensionPage(sender, 'options')) return { ok: false, error: 'forbidden' };
        let enrollment;
        try { enrollment = await loadQuickUnlockEnrollment(); }
        catch {
          if (!req.removeQuickUnlock) return { ok: false, error: 'quickUnlockConfirmationRequired' };
          await clearQuickUnlockEnrollment();
        }
        if (enrollment?.record.source.kind === 'cloud' && enrollment.record.source.provider === req.provider) {
          if (!req.removeQuickUnlock) return { ok: false, error: 'quickUnlockConfirmationRequired' };
          await clearQuickUnlockEnrollment();
        }
        if (req.provider === 'gdrive') await disconnectGoogle();
        else await disconnect(req.provider);
        // If the active vault is this provider's, lock so the next save can't route to a
        // now-credential-less provider (surprise OAuth popup). Local edits stay pendingUpload in cache.
        const currentSource = ctx.getCurrentSource();
        if (currentSource?.kind === 'cloud' && currentSource.provider === req.provider) ctx.doLock();
        return { ok: true };
      }
      case 'getQuickUnlockStatus': {
        if (!isExtensionPage(sender, 'popup', 'panel', 'options')) return { ok: false, error: 'forbidden' };
        try {
          const enrollment = await loadQuickUnlockEnrollment();
          if (!enrollment) return { ok: true, enrolled: false, corrupt: false, source: null };
          const { record } = enrollment;
          return {
            ok: true,
            enrolled: true,
            corrupt: false,
            source: record.source,
            credentialId: record.credentialId,
            prfInput: record.prfInput,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
        } catch { return { ok: true, enrolled: false, corrupt: true, source: null }; }
      }
      case 'enrollQuickUnlock': {
        quickUnlockInfo('background.enrollment-requested', {
          sourceKind: req.source.kind,
          hasPassword: req.password !== null,
          hasKeyFile: req.keyFile !== null,
          keyFileBytes: req.keyFile?.length ?? 0,
          prfOutputBytes: req.prfOutput.length,
          replaceExisting: req.replaceExisting,
        });
        if (!isExtensionPage(sender, 'popup', 'panel')) {
          quickUnlockWarn('background.enrollment-rejected', undefined, { reason: 'forbidden' });
          return { ok: false, error: 'forbidden' };
        }
        if (!ctx.vault.isOpen()) {
          quickUnlockWarn('background.enrollment-rejected', undefined, { reason: 'locked' });
          return { ok: false, error: 'locked' };
        }
        if (!sourceMatchesActive(req.source, ctx)) {
          quickUnlockWarn('background.enrollment-rejected', undefined, { reason: 'sourceMismatch' });
          return { ok: false, error: 'sourceMismatch' };
        }
        if ((req.password === null && req.keyFile === null)
          || (req.keyFile !== null && !validSecretBytes(req.keyFile))
          || !validSecretBytes(req.prfOutput, 32)) {
          quickUnlockWarn('background.enrollment-rejected', undefined, { reason: 'invalidEnrollment' });
          return { ok: false, error: 'invalidEnrollment' };
        }
        const keyFile = req.keyFile ? new Uint8Array(req.keyFile) : null;
        const prfOutput = new Uint8Array(req.prfOutput);
        let stage = 'existing-enrollment-check';
        try {
          try {
            const existing = await loadQuickUnlockEnrollment();
            if (existing && !req.replaceExisting) {
              quickUnlockWarn('background.enrollment-rejected', undefined, { reason: 'replacementConfirmationRequired' });
              return { ok: false, error: 'replacementConfirmationRequired' };
            }
          } catch {
            if (!req.replaceExisting) {
              quickUnlockWarn('background.enrollment-rejected', undefined, { reason: 'corruptEnrollment' });
              return { ok: false, error: 'corruptEnrollment' };
            }
          }
          stage = 'wrap-material';
          quickUnlockInfo('background.enrollment-wrapping', { sourceKind: req.source.kind });
          const record = await wrapQuickUnlockMaterial({
            credentialId: req.credentialId,
            prfInput: req.prfInput,
            prfOutput,
            source: req.source,
            material: { password: req.password, keyFile },
          });
          stage = 'persist-enrollment';
          quickUnlockInfo('background.enrollment-persisting', { sourceKind: req.source.kind });
          await saveQuickUnlockEnrollment(record, req.source.kind === 'local' ? ctx.getHandle() : null);
          quickUnlockInfo('background.enrollment-saved', { sourceKind: req.source.kind });
          return { ok: true };
        } catch (error) {
          quickUnlockWarn('background.enrollment-failed', error, { stage });
          return { ok: false, error: 'enrollmentFailed' };
        }
        finally {
          keyFile?.fill(0);
          prfOutput.fill(0);
          req.keyFile?.fill(0);
          req.prfOutput.fill(0);
        }
      }
      case 'quickUnlock': {
        if (!isExtensionPage(sender, 'popup', 'panel')) return { ok: false, error: 'forbidden' };
        if (ctx.vault.isOpen()) return { ok: false, error: 'alreadyUnlocked' };
        if (!validSecretBytes(req.prfOutput, 32)) return { ok: false, error: 'invalidPrfOutput' };
        const opening = captureOpen(ctx);
        const prfOutput = new Uint8Array(req.prfOutput);
        let keyFile: Uint8Array | null = null;
        try {
          let enrollment;
          try { enrollment = await loadQuickUnlockEnrollment(); }
          catch { return { ok: false, error: 'corruptEnrollment' }; }
          if (!enrollment) return { ok: false, error: 'notEnrolled' };
          if (req.credentialId !== enrollment.record.credentialId) return { ok: false, error: 'unknownCredential' };
          if (enrollment.record.source.kind === 'cloud'
            && !(await cloudConnected(ctx, enrollment.record.source.provider)))
            return { ok: false, error: 'authRequired' };
          let material;
          try { material = await unwrapQuickUnlockMaterial(enrollment.record, prfOutput); }
          catch { return { ok: false, error: 'corruptEnrollment' }; }
          keyFile = material.keyFile;
          const keyBuffer = keyFile ? keyFile.buffer.slice(keyFile.byteOffset, keyFile.byteOffset + keyFile.byteLength) as ArrayBuffer : null;
          if (enrollment.record.source.kind === 'local') {
            if (!enrollment.localHandle) return { ok: false, error: 'corruptEnrollment' };
            const permitted = await hasPermission(enrollment.localHandle, 'readwrite');
            if (!permitted) return { ok: false, error: 'permissionRequired' };
            try { await openLocalVault(ctx, enrollment.localHandle, material.password, keyBuffer, opening); }
            catch (error) {
              return isInvalidKey(error)
                ? { ok: false, error: 'staleCredentials' }
                : { ok: false, error: 'sourceUnavailable' };
            }
            return { ok: true };
          }
          const source: CloudFileSource = {
            kind: 'cloud',
            provider: enrollment.record.source.provider,
            fileId: enrollment.record.source.fileId,
            basedOnRev: '',
          };
          try {
            const outcome = await openCloudVault(ctx, source, material.password, keyBuffer, opening);
            return outcome.merged ? { ok: true, merged: true } : { ok: true };
          } catch (error) {
            if (isInvalidKey(error)) return { ok: false, error: 'staleCredentials' };
            if (error instanceof Error && error.message === 'offlineNoCache') return { ok: false, error: 'offlineNoCache' };
            return { ok: false, error: 'authRequired' };
          }
        } finally {
          keyFile?.fill(0);
          prfOutput.fill(0);
          req.prfOutput.fill(0);
        }
      }
      case 'disableQuickUnlock':
        if (!isExtensionPage(sender, 'popup', 'panel', 'options')) return { ok: false, error: 'forbidden' };
        await clearQuickUnlockEnrollment();
        return { ok: true };
      case 'generatePassword':
        return { ok: true, password: generatePassword(req.opts ?? DEFAULT_PWGEN) };
      case 'fillRequest': {
        if (sender.id !== chrome.runtime.id || !isExtensionPage(sender, 'popup') ||
          new URL(sender.url!).pathname !== '/src/pages/popup/index.html') return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const token = ctx.vault.lifecycleGeneration;
        const entry = ctx.vault.getEntry(req.entryId);
        if (!entry) return { ok: false, error: 'noEntry' };
        try {
          let tab: chrome.tabs.Tab;
          try { tab = await chrome.tabs.get(req.tabId); }
          catch { return { ok: false, error: 'noTab' }; }
          if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
          if (entry.url && (!tab.url || !urlMatches(entry.url, tab.url)))
            return { ok: false, error: 'urlMismatch' };
          const { top, targets } = await resolvePopupFillTargets(req.tabId, entry.url);
          if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
          let totp: string | undefined;
          if (!entry.isCard) {
            const config = ctx.vault.getTotpConfig(entry.id);
            if (config) {
              totp = (await generateTotp(config)).code;
              if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
            }
          }
          const message = entry.isCard ? {
            type: 'fillCard', number: entry.username, cvv: entry.password,
            cardholderName: entry.fields.find(f => f.key === CARDHOLDER_NAME_KEY)?.value ?? '', expires: entry.expires,
          } : { type: 'fill', username: entry.username, password: entry.password, ...(totp ? { totp } : {}) };
          let delivered = false;
          for (const target of targets) {
            try {
              const valid = await revalidatePopupFillTarget(top, target);
              if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
              if (!valid) continue;
              await chrome.tabs.sendMessage(target.tabId, message, { documentId: target.documentId });
              delivered = true;
            } catch { /* Disappearing documents never justify a broader retry. */ }
            if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
          }
          if (!delivered) return { ok: false, error: 'fillDeliveryFailed' };
          ctx.autolock.touch();
          return { ok: true };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'fillDeliveryFailed' }; }
      }
      case 'fillTotpRequest': {
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const token = ctx.vault.lifecycleGeneration;
        const entry = ctx.vault.getEntry(req.entryId);
        if (!entry) return { ok: false, error: 'noEntry' };
        try {
          const target = await resolveInlineFillTarget(sender, entry.url);
          if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
          const config = ctx.vault.getTotpConfig(entry.id);
          if (!config) return { ok: false, error: 'noTotp' };
          const { code } = await generateTotp(config);
          if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
          const valid = await revalidateInlineFillTarget(target);
          if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
          if (!valid) return { ok: false, error: 'fillDeliveryFailed' };
          await chrome.tabs.sendMessage(target.tabId, { type: 'fillTotp', code }, { documentId: target.documentId });
          if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
          ctx.autolock.touch();
          return { ok: true };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'fillDeliveryFailed' }; }
      }
      case 'scheduleClipboardClear':
        await ctx.persistPendingClipboardHash(req.textHash);
        chrome.alarms.create(CLIPBOARD_CLEAR_ALARM, { when: Date.now() + req.seconds * 1000 });
        return { ok: true };
      case 'cancelClipboardClear':
        await ctx.persistPendingClipboardHash(null);
        chrome.alarms.clear(CLIPBOARD_CLEAR_ALARM);
        return { ok: true };
      case 'stageCredentialUsername': {
        const authority = contentAuthority(sender);
        if (!authority) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const settings = await loadSettings();
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        if (!settings.offerToSaveCredentials) return { ok: true, staged: false };
        if (typeof req.username !== 'string' || !req.username.trim())
          return { ok: false, error: 'invalidCapture' };
        await ctx.credentialCaptures.stageUsername({
          tabId: authority.tabId, sourceUrl: authority.url, username: req.username,
        });
        return { ok: true, staged: true };
      }
      case 'stageCredentialCapture': {
        const authority = contentAuthority(sender);
        if (!authority) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const settings = await loadSettings();
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        if (!settings.offerToSaveCredentials) return { ok: true, staged: false };
        if (typeof req.username !== 'string' || typeof req.password !== 'string' || req.password.length === 0
          || (req.kind !== 'login' && req.kind !== 'password-change'))
          return { ok: false, error: 'invalidCapture' };
        await ctx.credentialCaptures.stage({
          tabId: authority.tabId, sourceUrl: authority.url,
          username: req.username, password: req.password, kind: req.kind,
        });
        return { ok: true, staged: true };
      }
      case 'getPendingCredentialPrompt': {
        const authority = contentAuthority(sender);
        if (!authority) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: true, prompt: null };
        const safe = await ctx.credentialCaptures.pendingForPage(authority.tabId, authority.url);
        if (!safe) return { ok: true, prompt: null };
        const record = await ctx.credentialCaptures.authorizeAction(safe.captureId, authority);
        if (!record) return { ok: true, prompt: null };
        const classification = classifyCapture(record, ctx.vault);
        if (classification.identical) {
          await ctx.credentialCaptures.dismiss(record.id, authority);
          return { ok: true, prompt: null };
        }
        const tree = ctx.vault.getTree();
        return { ok: true, prompt: {
          captureId: safe.captureId,
          site: safe.site,
          username: safe.username,
          kind: safe.kind,
          suggestedAction: classification.suggestedAction,
          entries: classification.entries,
          rootGroupId: tree.groupId,
          groups: flattenGroups(tree),
          ...(record.mutation ? { retry: true } : {}),
        } };
      }
      case 'dismissCredentialCapture': {
        const authority = contentAuthority(sender);
        if (!authority || !(await ctx.credentialCaptures.dismiss(req.captureId, authority)))
          return { ok: false, error: 'forbidden' };
        return { ok: true };
      }
      case 'commitCredentialCapture': {
        const authority = contentAuthority(sender);
        if (!authority) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        const token = ctx.vault.lifecycleGeneration;
        const record = await ctx.credentialCaptures.authorizeAction(req.captureId, authority);
        if (!record) return { ok: false, error: 'forbidden' };
        if (!ctx.vault.isOpen()) return { ok: false, error: 'locked' };
        if (req.entryId && (req.saveAsNew || req.groupId)) return { ok: false, error: 'invalidSelection' };
        if (req.groupId && !req.saveAsNew) return { ok: false, error: 'invalidSelection' };

        if (!record.mutation) {
          const classification = classifyCapture(record, ctx.vault);
          if (classification.identical) {
            await ctx.credentialCaptures.dismiss(record.id, authority);
            if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
            ctx.autolock.touch();
            return { ok: true };
          }
          const matching = ctx.vault.entriesForUrl(record.sourceUrl).filter(entry => !entry.isCard);
          const selected = req.entryId ? matching.find(entry => entry.id === req.entryId) : undefined;
          if (req.entryId && !selected) return { ok: false, error: 'invalidSelection' };

          try {
            if (req.saveAsNew || (!req.entryId && classification.suggestedAction === 'save')) {
              const tree = ctx.vault.getTree();
              const groupId = req.groupId ?? tree.groupId;
              if (!flattenGroups(tree).some(group => group.groupId === groupId))
                return { ok: false, error: 'invalidSelection' };
              const entryId = ctx.vault.createEntry(groupId, {
                Title: defaultEntryTitle(record.sourceUrl),
                UserName: record.username,
                Password: record.password,
                URL: canonicalSiteUrl(record.sourceUrl),
              });
              if (!(await ctx.credentialCaptures.markMutation(record.id, authority, { type: 'create', entryId })))
                return { ok: false, error: 'forbidden' };
            } else {
              const target = selected ?? (classification.suggestedAction === 'update'
                ? matching.find(entry => entry.id === classification.entries[0]?.id)
                : undefined);
              if (!target) return { ok: false, error: 'selectionRequired' };
              ctx.vault.updateEntry(target.id, {
                ...(record.username ? { UserName: record.username } : {}),
                Password: record.password,
                URL: canonicalSiteUrl(record.sourceUrl),
              });
              if (!(await ctx.credentialCaptures.markMutation(record.id, authority, { type: 'update', entryId: target.id })))
                return { ok: false, error: 'forbidden' };
            }
          } catch { return { ok: false, error: 'commitFailed' }; }
        }

        const saved = await persistVault(ctx);
        if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
        if (!saved.ok) return saved;
        await ctx.credentialCaptures.dismiss(record.id, authority);
        if (!ctx.vault.isSessionCurrent(token)) return { ok: false, error: 'locked' };
        ctx.autolock.touch();
        ctx.refreshAllIcons();
        return { ok: true };
      }
    }
    } finally { ctx.publishStatus?.(); }
  };
}
