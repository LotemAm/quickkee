// @vitest-environment node
//
// Characterization tests for makeRouter()/handle_: these pin the CURRENT observable
// behavior of the message router (error strings, response shapes, dirty-flag semantics)
// as extracted verbatim from src/pages/background/index.ts (plan 009). They assert what
// the router DOES, not what it should do — any surprise here is a report item, not
// something to "fix" in this file.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi, beforeEach, describe } from 'vitest';
import { Vault } from '../../background/vault';
import { AutoLock } from '../../background/autolock';
import { makeRouter, type SwContext } from './router';
import type { DbSource } from '../../shared/dbSource';
import { CARD_FLAG_KEY, CARDHOLDER_NAME_KEY } from '../../shared/entry';
import { CredentialCaptureStore } from '../../background/credentialCaptureStore';

// Keep mock factories free of outer-scope references — vi.mock is hoisted above imports
// and above local `const`/`let` declarations, so factories may only build fresh vi.fn()s.
vi.mock('../../background/fileHandle', () => ({
  loadHandle: vi.fn(),
  ensurePermission: vi.fn(),
  readBytes: vi.fn(),
  writeBytes: vi.fn(),
}));
vi.mock('../../shared/settings', () => ({
  loadSettings: vi.fn(),
}));
vi.mock('../../background/cache', () => ({
  getCache: vi.fn(),
  cacheKey: (provider: string, fileId: string) => `${provider}:${fileId}`,
}));
vi.mock('../../background/sync', () => ({
  openCloud: vi.fn(),
  saveCloud: vi.fn(),
}));

import { loadHandle, ensurePermission, readBytes, writeBytes } from '../../background/fileHandle';
import { loadSettings } from '../../shared/settings';
import { getCache, type CacheRecord } from '../../background/cache';
import { saveCloud } from '../../background/sync';
import type { CloudFileSource } from '../../shared/dbSource';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../../test/fixtures/test.kdbx');
const PW = 'correct horse';

function fixture(): ArrayBuffer {
  const buf = readFileSync(FIXTURE_PATH);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

function fakeHandle(name = 'vault.kdbx'): FileSystemFileHandle {
  return { name } as unknown as FileSystemFileHandle;
}

const DEFAULT_SETTINGS_STUB = { autoCloseHours: 8, clipboardClearSeconds: 30, pwgen: { length: 20, lower: true, upper: true, digits: true, symbols: true }, theme: 'system' as const, offerToSaveCredentials: true };

/** Fresh router + context for each test, mirroring index.ts's module-level wiring. */
function makeCtx() {
  let handle: FileSystemFileHandle | null = null;
  let currentSource: DbSource | null = null;
  const vault = new Vault();
  let captureNumber = 0;
  const credentialCaptures = new CredentialCaptureStore({ storage: null, randomId: () => `capture-${++captureNumber}` });
  const doLock = vi.fn(() => { vault.lock(); handle = null; currentSource = null; autolock.disarm(); void credentialCaptures.clearAll(); });
  const autolock = new AutoLock(() => doLock());
  const refreshAllIcons = vi.fn();
  const persistPendingClipboardHash = vi.fn(async () => {});
  const online = vi.fn(() => true);

  const ctx: SwContext = {
    vault,
    credentialCaptures,
    autolock,
    getHandle: () => handle,
    setHandle: h => { handle = h; },
    getCurrentSource: () => currentSource,
    setCurrentSource: s => { currentSource = s; },
    doLock,
    refreshAllIcons,
    online,
    persistPendingClipboardHash,
  };
  return { ctx, handle_: makeRouter(ctx), doLock, refreshAllIcons };
}

async function unlockHappyPath(handle_: ReturnType<typeof makeRouter>) {
  vi.mocked(loadHandle).mockResolvedValue(fakeHandle());
  vi.mocked(ensurePermission).mockResolvedValue(true);
  vi.mocked(readBytes).mockResolvedValue(fixture());
  vi.mocked(loadSettings).mockResolvedValue(DEFAULT_SETTINGS_STUB);
  return handle_({ type: 'unlock', password: PW, keyFile: null });
}

let chromeMock: { tabs: { get: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> }; alarms: { create: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
  chromeMock = { tabs: { get: vi.fn(), sendMessage: vi.fn() }, alarms: { create: vi.fn(), clear: vi.fn() } };
  vi.stubGlobal('chrome', chromeMock);
});

function contentSender(url = 'https://github.com/login', tabId = 7, frameId = 0): chrome.runtime.MessageSender {
  return { url, frameId, tab: { id: tabId, url } } as chrome.runtime.MessageSender;
}

async function stageAndGetPrompt(
  handle_: ReturnType<typeof makeRouter>,
  candidate: { username: string; password: string; kind?: 'login' | 'password-change' },
) {
  const sender = contentSender();
  const staged = await handle_({ type: 'stageCredentialCapture', kind: candidate.kind ?? 'login', username: candidate.username, password: candidate.password }, sender);
  const prompt = await handle_({ type: 'getPendingCredentialPrompt' }, contentSender('https://github.com/account'));
  return { staged, prompt };
}

describe('getStatus', () => {
  test('while locked reports locked:true, dirty:false', async () => {
    const { handle_ } = makeCtx();
    expect(await handle_({ type: 'getStatus' })).toMatchObject({ ok: true, locked: true, dirty: false });
  });
});

describe('unlock', () => {
  test('no stored handle -> noFile', async () => {
    const { handle_ } = makeCtx();
    vi.mocked(loadHandle).mockResolvedValue(null);
    expect(await handle_({ type: 'unlock', password: PW, keyFile: null })).toEqual({ ok: false, error: 'noFile' });
  });

  test('wrong password -> badCredentials', async () => {
    const { handle_ } = makeCtx();
    vi.mocked(loadHandle).mockResolvedValue(fakeHandle());
    vi.mocked(ensurePermission).mockResolvedValue(true);
    vi.mocked(readBytes).mockResolvedValue(fixture());
    expect(await handle_({ type: 'unlock', password: 'wrong', keyFile: null })).toEqual({ ok: false, error: 'badCredentials' });
  });

  test('happy path unlocks and reports unlocked status', async () => {
    const { handle_ } = makeCtx();
    expect(await unlockHappyPath(handle_)).toEqual({ ok: true });
    expect(await handle_({ type: 'getStatus' })).toMatchObject({ ok: true, locked: false, dbName: 'vault.kdbx' });
  });
});

describe('getEntriesForUrl', () => {
  test('locked -> { ok:false, error:"locked" }; unlocked -> matching entries', async () => {
    const { handle_ } = makeCtx();
    expect(await handle_({ type: 'getEntriesForUrl', url: 'https://github.com' })).toEqual({ ok: false, error: 'locked' });
    await unlockHappyPath(handle_);
    const res = await handle_({ type: 'getEntriesForUrl', url: 'https://github.com' });
    expect(res.ok).toBe(true);
    expect((res as { entries: unknown[] }).entries).toHaveLength(1);
  });
});

describe('save', () => {
  test('no handle and no cloud source -> noFile', async () => {
    const { handle_ } = makeCtx();
    expect(await handle_({ type: 'save' })).toEqual({ ok: false, error: 'noFile' });
  });

  test('local happy path writes bytes and clears dirty', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
    ctx.vault.updateEntry(id, { UserName: 'changed' });
    expect(ctx.vault.dirty).toBe(true);
    vi.mocked(writeBytes).mockResolvedValue(undefined);
    expect(await handle_({ type: 'save' })).toEqual({ ok: true });
    expect(ctx.vault.dirty).toBe(false);
  });

  test('local save failure -> saveFailed and dirty stays true (plan 001 guarantee)', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
    ctx.vault.updateEntry(id, { UserName: 'changed' });
    expect(ctx.vault.dirty).toBe(true);
    vi.mocked(writeBytes).mockRejectedValue(new Error('disk full'));
    expect(await handle_({ type: 'save' })).toEqual({ ok: false, error: 'saveFailed' });
    expect(ctx.vault.dirty).toBe(true);
  });
});

describe('mutations mark vault dirty', () => {
  test('createEntry / updateEntry / deleteEntry / deleteGroup', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);

    ctx.vault.dirty = false;
    const tree = ctx.vault.getTree();
    const createRes = await handle_({ type: 'createEntry', groupId: tree.groupId, fields: { Title: 'New', URL: 'https://example.com', UserName: 'u', Password: 'p' } });
    expect(createRes.ok).toBe(true);
    expect(ctx.vault.dirty).toBe(true);
    const newId = (createRes as { entryId: string }).entryId;

    ctx.vault.dirty = false;
    expect(await handle_({ type: 'updateEntry', entryId: newId, fields: { UserName: 'u2' } })).toEqual({ ok: true });
    expect(ctx.vault.dirty).toBe(true);

    ctx.vault.dirty = false;
    expect(await handle_({ type: 'deleteEntry', entryId: newId })).toEqual({ ok: true });
    expect(ctx.vault.dirty).toBe(true);

    ctx.vault.dirty = false;
    const groupRes = await handle_({ type: 'createGroup', parentId: tree.groupId, name: 'G' });
    const groupId = (groupRes as { groupId: string }).groupId;
    ctx.vault.dirty = false;
    expect(await handle_({ type: 'deleteGroup', groupId })).toEqual({ ok: true });
    expect(ctx.vault.dirty).toBe(true);
  });
});

describe('fillRequest', () => {
  test('nonexistent entry -> noEntry', async () => {
    const { handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    expect(await handle_({ type: 'fillRequest', entryId: 'nope', tabId: 1 })).toEqual({ ok: false, error: 'noEntry' });
  });

  test('happy path calls chrome.tabs.sendMessage with fill payload', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const entry = ctx.vault.entriesForUrl('https://github.com')[0];
    chromeMock.tabs.get.mockResolvedValue({ url: 'https://github.com/login' });
    expect(await handle_({ type: 'fillRequest', entryId: entry.id, tabId: 7 })).toEqual({ ok: true });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'fill', username: entry.username, password: entry.password });
  });

  test('entry with TOTP includes a freshly generated code in the fill payload', async () => {
    vi.useFakeTimers(); vi.setSystemTime(59_999);
    try {
      const { ctx, handle_ } = makeCtx();
      await unlockHappyPath(handle_);
      const entry = ctx.vault.entriesForUrl('https://github.com')[0];
      ctx.vault.setTotpConfig(entry.id, {
        secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'SHA1', digits: 8, period: 30,
      });
      chromeMock.tabs.get.mockResolvedValue({ url: 'https://github.com/login' });
      expect(await handle_({ type: 'fillRequest', entryId: entry.id, tabId: 7 })).toEqual({ ok: true });
      expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(7, {
        type: 'fill', username: entry.username, password: entry.password, totp: '94287082',
      });
    } finally { vi.useRealTimers(); }
  });

  test('mismatching tab URL -> urlMismatch and sendMessage NOT called (plan 003)', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const entry = ctx.vault.entriesForUrl('https://github.com')[0];
    chromeMock.tabs.get.mockResolvedValue({ url: 'https://evil.example.com' });
    expect(await handle_({ type: 'fillRequest', entryId: entry.id, tabId: 7 })).toEqual({ ok: false, error: 'urlMismatch' });
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('card-marked entry sends fillCard payload (number/cvv/cardholderName/expires) instead of fill', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const entryId = ctx.vault.entriesForUrl('https://github.com')[0].id;
    const expires = new Date(2029, 4, 1).getTime();
    ctx.vault.updateEntry(entryId, { [CARD_FLAG_KEY]: '1', [CARDHOLDER_NAME_KEY]: 'Jane Doe' }, expires);
    chromeMock.tabs.get.mockResolvedValue({ url: 'https://github.com/login' });

    const entry = ctx.vault.getEntry(entryId)!;
    expect(await handle_({ type: 'fillRequest', entryId, tabId: 7 })).toEqual({ ok: true });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: 'fillCard', number: entry.username, cvv: entry.password, cardholderName: 'Jane Doe', expires,
    });
  });

  test('card-marked entry without a Cardholder Name field sends empty cardholderName', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const entryId = ctx.vault.entriesForUrl('https://github.com')[0].id;
    ctx.vault.updateEntry(entryId, { [CARD_FLAG_KEY]: '1' });
    chromeMock.tabs.get.mockResolvedValue({ url: 'https://github.com/login' });

    await handle_({ type: 'fillRequest', entryId, tabId: 7 });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'fillCard', cardholderName: '' }));
  });
});

describe('TOTP requests', () => {
  const panelSender = { url: 'chrome-extension://quickkee/src/pages/panel/index.html' } as chrome.runtime.MessageSender;
  const popupSender = { url: 'chrome-extension://quickkee/src/pages/popup/index.html' } as chrome.runtime.MessageSender;
  const contentSender = {
    url: 'https://github.com/login', frameId: 3,
    tab: { id: 7, url: 'https://github.com/login' },
  } as chrome.runtime.MessageSender;

  test('setup config is available to the panel but not a content script', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
    ctx.vault.setTotpConfig(id, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });

    expect(await handle_({ type: 'getTotpConfig', entryId: id }, contentSender)).toEqual({ ok: false, error: 'forbidden' });
    expect(await handle_({ type: 'getTotpConfig', entryId: id }, panelSender)).toMatchObject({
      ok: true, config: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 },
    });
  });

  test('setup config is available when the panel is hosted in an extension tab', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
    ctx.vault.setTotpConfig(id, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
    const panelTabSender = {
      ...panelSender,
      tab: { id: 9, url: panelSender.url },
    } as chrome.runtime.MessageSender;

    expect(await handle_({ type: 'getTotpConfig', entryId: id }, panelTabSender)).toMatchObject({
      ok: true, config: { secret: 'JBSWY3DPEHPK3PXP' },
    });
  });

  test('manual code request returns only the current short-lived code', async () => {
    vi.useFakeTimers(); vi.setSystemTime(59_000);
    try {
      const { ctx, handle_ } = makeCtx();
      await unlockHappyPath(handle_);
      const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
      ctx.vault.setTotpConfig(id, {
        secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'SHA1', digits: 8, period: 30,
      });
      expect(await handle_({ type: 'getTotpCode', entryId: id }, popupSender)).toEqual({
        ok: true, code: '94287082', period: 30, expiresAt: 60_000,
      });
    } finally { vi.useRealTimers(); }
  });

  test('inline fill uses the current code immediately and targets the sender frame', async () => {
    vi.useFakeTimers(); vi.setSystemTime(59_999);
    try {
      const { ctx, handle_ } = makeCtx();
      await unlockHappyPath(handle_);
      const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
      ctx.vault.setTotpConfig(id, {
        secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'SHA1', digits: 8, period: 30,
      });
      expect(await handle_({ type: 'fillTotpRequest', entryId: id }, contentSender)).toEqual({ ok: true });
      expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'fillTotp', code: '94287082' }, { frameId: 3 });
    } finally { vi.useRealTimers(); }
  });

  test('inline fill rejects a sender URL that does not match the entry', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
    ctx.vault.setTotpConfig(id, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
    const evil = { ...contentSender, url: 'https://evil.example.com', tab: { id: 7, url: 'https://evil.example.com' } } as chrome.runtime.MessageSender;
    expect(await handle_({ type: 'fillTotpRequest', entryId: id }, evil)).toEqual({ ok: false, error: 'urlMismatch' });
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
  });
});

describe('generatePassword', () => {
  test('returns ok with a non-empty password', async () => {
    const { handle_ } = makeCtx();
    const res = await handle_({ type: 'generatePassword' });
    expect(res.ok).toBe(true);
    expect(typeof (res as { password: string }).password).toBe('string');
    expect((res as { password: string }).password.length).toBeGreaterThan(0);
  });
});

describe('lock', () => {
  test('locks the vault and calls ctx.doLock', async () => {
    const { handle_, doLock } = makeCtx();
    await unlockHappyPath(handle_);
    expect(await handle_({ type: 'lock' })).toEqual({ ok: true });
    expect(doLock).toHaveBeenCalledTimes(1);
    expect(await handle_({ type: 'getStatus' })).toMatchObject({ locked: true });
  });
});

describe('getEntrySummariesForUrl (plan 002)', () => {
  test('locked -> locked error; unlocked -> summaries only (no password field)', async () => {
    const { handle_ } = makeCtx();
    expect(await handle_({ type: 'getEntrySummariesForUrl', url: 'https://github.com' })).toEqual({ ok: false, error: 'locked' });
    await unlockHappyPath(handle_);
    const res = await handle_({ type: 'getEntrySummariesForUrl', url: 'https://github.com' });
    expect(res.ok).toBe(true);
    const summaries = (res as unknown as { summaries: Array<Record<string, unknown>> }).summaries;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).not.toHaveProperty('password');
  });
});

describe('getCardEntrySummariesForUrl', () => {
  test('locked -> locked error', async () => {
    const { handle_ } = makeCtx();
    expect(await handle_({ type: 'getCardEntrySummariesForUrl', url: 'https://github.com' })).toEqual({ ok: false, error: 'locked' });
  });

  test('a card entry with no URL is returned for any site', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const id = ctx.vault.entriesForUrl('https://github.com')[0].id;
    ctx.vault.updateEntry(id, { [CARD_FLAG_KEY]: '1', URL: '' });

    const res = await handle_({ type: 'getCardEntrySummariesForUrl', url: 'https://totally-unrelated.example' });
    expect(res.ok).toBe(true);
    expect((res as unknown as { summaries: Array<{ id: string }> }).summaries.map(s => s.id)).toContain(id);
  });

  test('non-card entries are excluded', async () => {
    const { handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const res = await handle_({ type: 'getCardEntrySummariesForUrl', url: 'https://github.com' });
    expect(res.ok).toBe(true);
    expect((res as unknown as { summaries: unknown[] }).summaries).toHaveLength(0);
  });
});

describe('attachments', () => {
  test('addAttachment/getAttachment/removeAttachment locked -> locked error', async () => {
    const { handle_ } = makeCtx();
    expect(await handle_({ type: 'addAttachment', entryId: 'x', name: 'a.txt', data: 'aGk=' })).toEqual({ ok: false, error: 'locked' });
    expect(await handle_({ type: 'getAttachment', entryId: 'x', name: 'a.txt' })).toEqual({ ok: false, error: 'locked' });
    expect(await handle_({ type: 'removeAttachment', entryId: 'x', name: 'a.txt' })).toEqual({ ok: false, error: 'locked' });
  });

  test('add -> get -> remove happy path, base64 round-trips exactly', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const entryId = ctx.vault.entriesForUrl('https://github.com')[0].id;
    const data = Buffer.from('hello world').toString('base64');

    expect(await handle_({ type: 'addAttachment', entryId, name: 'note.txt', data })).toEqual({ ok: true });
    expect(ctx.vault.dirty).toBe(true);

    const getRes = await handle_({ type: 'getAttachment', entryId, name: 'note.txt' });
    expect(getRes).toEqual({ ok: true, data });

    expect(await handle_({ type: 'removeAttachment', entryId, name: 'note.txt' })).toEqual({ ok: true });
    expect(await handle_({ type: 'getAttachment', entryId, name: 'note.txt' })).toEqual({ ok: false, error: 'noAttachment' });
  });

  test('addAttachment on unknown entryId returns an error', async () => {
    const { handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const res = await handle_({ type: 'addAttachment', entryId: 'does-not-exist', name: 'a.txt', data: 'aGk=' });
    expect(res.ok).toBe(false);
  });

  test('removeAttachment on a name that was never attached returns an error', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const entryId = ctx.vault.entriesForUrl('https://github.com')[0].id;
    const res = await handle_({ type: 'removeAttachment', entryId, name: 'nope.txt' });
    expect(res.ok).toBe(false);
  });
});

describe('getSyncStatus', () => {
  test('final response reflects a LIVE re-read of currentSource after the getCache await, not the pre-await snapshot', async () => {
    // Regression guard: pre-extraction index.ts closed directly over the mutable
    // module-level `currentSource` and re-read it live at every reference. A naive
    // extraction can accidentally snapshot `currentSource` once up front and reuse that
    // stale value for the final response fields, which would change observable behavior
    // if another handler (disconnectCloud/openRemote) mutates currentSource while the
    // getCache() await is in flight. This test pins the ORIGINAL (live-reference) behavior.
    const { ctx, handle_ } = makeCtx();
    const dropbox: CloudFileSource = { kind: 'cloud', provider: 'dropbox', fileId: 'f1', basedOnRev: 'r1' };
    ctx.setCurrentSource(dropbox);

    let resolveCache!: (rec: CacheRecord | null) => void;
    vi.mocked(getCache).mockImplementation(() => new Promise(resolve => { resolveCache = resolve; }));

    const pending = handle_({ type: 'getSyncStatus' });

    // While the getCache() call for the ORIGINAL (dropbox) source is still pending,
    // simulate a concurrent openRemote/disconnectCloud message switching the active source.
    const gdrive: CloudFileSource = { kind: 'cloud', provider: 'gdrive', fileId: 'f2', basedOnRev: 'r2' };
    ctx.setCurrentSource(gdrive);

    resolveCache({ bytes: new ArrayBuffer(0), basedOnRev: 'r1', lastSyncedAt: 111, pendingUpload: true });

    const res = await pending;
    // The cache lookup was keyed off the pre-await (dropbox) source, but the `provider`
    // in the final response must reflect the post-await (gdrive) live state.
    expect(res).toEqual({ ok: true, source: 'cloud', provider: 'gdrive', pendingUpload: true, online: true, lastSyncedAt: 111 });
  });
});

describe('credential capture', () => {
  test('requires an unlocked vault, enabled setting, top frame, and HTTP(S) sender provenance', async () => {
    const { handle_ } = makeCtx();
    const request = { type: 'stageCredentialCapture' as const, username: 'octocat', password: 'new-secret', kind: 'login' as const };
    expect(await handle_(request, contentSender())).toEqual({ ok: false, error: 'locked' });

    await unlockHappyPath(handle_);
    vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS_STUB, offerToSaveCredentials: false });
    expect(await handle_(request, contentSender())).toEqual({ ok: true, staged: false });

    vi.mocked(loadSettings).mockResolvedValue(DEFAULT_SETTINGS_STUB);
    expect(await handle_(request, contentSender('https://github.com/login', 7, 2))).toEqual({ ok: false, error: 'forbidden' });
    expect(await handle_(request, { ...contentSender(), url: 'chrome-extension://quickkee/page.html' })).toEqual({ ok: false, error: 'forbidden' });
    expect(await handle_(request, contentSender())).toEqual({ ok: true, staged: true });
  });

  test('does not stage after a concurrent vault lock while settings are loading', async () => {
    const { handle_, doLock } = makeCtx();
    await unlockHappyPath(handle_);
    let resolveSettings!: (settings: typeof DEFAULT_SETTINGS_STUB) => void;
    vi.mocked(loadSettings).mockImplementationOnce(() => new Promise(resolve => { resolveSettings = resolve; }));
    const pending = handle_({ type: 'stageCredentialCapture', username: 'octocat', password: 'new-secret', kind: 'login' }, contentSender());
    await vi.waitFor(() => expect(loadSettings).toHaveBeenCalledTimes(2));
    doLock();
    resolveSettings(DEFAULT_SETTINGS_STUB);
    expect(await pending).toEqual({ ok: false, error: 'locked' });
  });

  test('suppresses identical credentials and classifies update, create, and ambiguous matches', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const existing = ctx.vault.entriesForUrl('https://github.com')[0];

    const identical = await stageAndGetPrompt(handle_, { username: existing.username, password: existing.password });
    expect(identical.prompt).toEqual({ ok: true, prompt: null });

    const update = await stageAndGetPrompt(handle_, { username: existing.username.toUpperCase(), password: 'changed-secret' });
    expect(update.prompt).toMatchObject({ ok: true, prompt: {
      suggestedAction: 'update', entries: [{ id: existing.id, title: existing.title, username: existing.username }],
    } });

    const create = await stageAndGetPrompt(handle_, { username: 'brand-new-user', password: 'new-secret' });
    expect(create.prompt).toMatchObject({ ok: true, prompt: { suggestedAction: 'save', entries: [] } });

    ctx.vault.createEntry(ctx.vault.getTree().groupId, {
      Title: 'Duplicate GitHub', UserName: existing.username, Password: 'other-secret', URL: 'https://github.com/',
    });
    const ambiguous = await stageAndGetPrompt(handle_, { username: existing.username, password: 'third-secret' });
    expect(ambiguous.prompt).toMatchObject({ ok: true, prompt: { suggestedAction: 'choose' } });
    expect((ambiguous.prompt as { ok: true; prompt: { entries: unknown[] } }).prompt.entries).toHaveLength(2);
  });

  test('an empty username updates only a sole match and requires a choice when several exist', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const sole = await stageAndGetPrompt(handle_, { username: '', password: 'changed-secret' });
    expect(sole.prompt).toMatchObject({ ok: true, prompt: { suggestedAction: 'update' } });

    ctx.vault.createEntry(ctx.vault.getTree().groupId, {
      Title: 'Another GitHub', UserName: 'another-user', Password: 'other-secret', URL: 'https://github.com/',
    });
    const multiple = await stageAndGetPrompt(handle_, { username: '', password: 'third-secret' });
    expect(multiple.prompt).toMatchObject({ ok: true, prompt: { suggestedAction: 'choose' } });
  });

  test('updates only submitted credential fields, persists, and preserves unrelated entry data', async () => {
    const { ctx, handle_, refreshAllIcons } = makeCtx();
    await unlockHappyPath(handle_);
    const existing = ctx.vault.entriesForUrl('https://github.com')[0];
    const expiry = new Date(2032, 0, 1).getTime();
    ctx.vault.updateEntry(existing.id, { CustomField: 'keep-me' }, expiry);
    ctx.vault.setTotpConfig(existing.id, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
    vi.mocked(writeBytes).mockResolvedValue(undefined);

    const { prompt } = await stageAndGetPrompt(handle_, { username: existing.username.toUpperCase(), password: 'changed-secret' });
    const captureId = (prompt as { ok: true; prompt: { captureId: string } }).prompt.captureId;
    expect(await handle_({ type: 'commitCredentialCapture', captureId }, contentSender('https://github.com/account'))).toEqual({ ok: true });

    const updated = ctx.vault.getEntry(existing.id)!;
    expect(updated).toMatchObject({
      id: existing.id, title: existing.title, username: existing.username.toUpperCase(),
      password: 'changed-secret', url: 'https://github.com/', expires: expiry, hasTotp: true,
    });
    expect(updated.fields).toContainEqual({ key: 'CustomField', value: 'keep-me', protected: false });
    expect(writeBytes).toHaveBeenCalledOnce();
    expect(refreshAllIcons).toHaveBeenCalled();
  });

  test('a local save failure keeps an idempotent create retry without duplicating the entry', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const { prompt } = await stageAndGetPrompt(handle_, { username: 'retry-user', password: 'new-secret' });
    const captureId = (prompt as { ok: true; prompt: { captureId: string } }).prompt.captureId;
    const commit = { type: 'commitCredentialCapture' as const, captureId };
    const sender = contentSender('https://github.com/account');

    vi.mocked(writeBytes).mockRejectedValueOnce(new Error('disk full'));
    expect(await handle_(commit, sender)).toEqual({ ok: false, error: 'saveFailed' });
    expect(ctx.vault.entriesForUrl('https://github.com').filter(entry => entry.username === 'retry-user')).toHaveLength(1);

    vi.mocked(writeBytes).mockResolvedValueOnce(undefined);
    expect(await handle_(commit, sender)).toEqual({ ok: true });
    expect(ctx.vault.entriesForUrl('https://github.com').filter(entry => entry.username === 'retry-user')).toHaveLength(1);
    expect(await handle_({ type: 'getPendingCredentialPrompt' }, sender)).toEqual({ ok: true, prompt: null });
  });

  test('a cloud save failure uses the same retained mutation and duplicate-free retry path', async () => {
    const { ctx, handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    ctx.setCurrentSource({ kind: 'cloud', provider: 'dropbox', fileId: 'vault', basedOnRev: 'r1' });
    const { prompt } = await stageAndGetPrompt(handle_, { username: 'cloud-retry-user', password: 'new-secret' });
    const captureId = (prompt as { ok: true; prompt: { captureId: string } }).prompt.captureId;
    const sender = contentSender('https://github.com/account');

    vi.mocked(saveCloud).mockRejectedValueOnce(new Error('offline'));
    expect(await handle_({ type: 'commitCredentialCapture', captureId }, sender)).toEqual({ ok: false, error: 'saveFailed' });
    vi.mocked(saveCloud).mockResolvedValueOnce({ basedOnRev: 'r2', merged: false, pendingUpload: false });
    expect(await handle_({ type: 'commitCredentialCapture', captureId }, sender)).toEqual({ ok: true });
    expect(ctx.vault.entriesForUrl('https://github.com').filter(entry => entry.username === 'cloud-retry-user')).toHaveLength(1);
  });

  test('rejects commit and dismissal from a different tab or bound origin', async () => {
    const { handle_ } = makeCtx();
    await unlockHappyPath(handle_);
    const { prompt } = await stageAndGetPrompt(handle_, { username: 'new-user', password: 'new-secret' });
    const captureId = (prompt as { ok: true; prompt: { captureId: string } }).prompt.captureId;
    expect(await handle_({ type: 'commitCredentialCapture', captureId }, contentSender('https://evil.test/', 7))).toEqual({ ok: false, error: 'forbidden' });
    expect(await handle_({ type: 'dismissCredentialCapture', captureId }, contentSender('https://github.com/account', 8))).toEqual({ ok: false, error: 'forbidden' });
  });
});
