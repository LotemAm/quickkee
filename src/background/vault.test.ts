// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as kdbxweb from 'kdbxweb';
import { vi } from 'vitest';
import { Vault, isInvalidKey } from './vault';
import { CARD_FLAG_KEY, OTP_FIELD_KEY } from '../shared/entry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = resolve(__dirname, '../test/fixtures/test.kdbx');

function fixture(): ArrayBuffer {
  const buf = readFileSync(FIXTURE_PATH);
  // Copy into a fresh ArrayBuffer — Node Buffer shares a larger backing store
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

function bytesOf(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const ab = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(ab).set(encoded);
  return ab;
}

test('open + read entry by url', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  expect(v.dirty).toBe(false);
  const matches = v.entriesForUrl('https://github.com/login');
  expect(matches).toHaveLength(1);
  expect(matches[0].username).toBe('octocat');
  expect(matches[0].password).toBe('s3cr3t');
  expect(matches[0].fields.find(f => f.key === 'Token')?.value).toBe('abc123');
});

test('lifecycle tokens survive edits but expire on lock and successful replacement', async () => {
  const v = new Vault();
  expect(v.isSessionCurrent(v.lifecycleGeneration)).toBe(false);
  const first = await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { UserName: 'edited' });
  expect(v.lifecycleGeneration).toBe(first);
  expect(v.isSessionCurrent(first)).toBe(true);
  const replacement = await v.open(fixture(), 'correct horse', null);
  expect(replacement).toBeGreaterThan(first);
  expect(v.getEntry(id)?.username).toBe('octocat');
  expect(v.isSessionCurrent(first)).toBe(false);
  expect(v.isSessionCurrent(replacement)).toBe(true);
  v.lock();
  expect(v.lifecycleGeneration).toBeGreaterThan(replacement);
  expect(v.isSessionCurrent(replacement)).toBe(false);
});

test.each(['lock', 'replacement'] as const)('a delayed open cannot restore the vault after %s', async action => {
  const v = new Vault();
  await v.open(fixture(), 'correct horse', null);
  const db = await kdbxweb.Kdbx.load(fixture(), new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse')));
  let finish!: (db: kdbxweb.Kdbx) => void;
  const load = vi.spyOn(kdbxweb.Kdbx, 'load').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    const opening = v.open(fixture(), 'correct horse', null);
    if (action === 'lock') v.lock();
    else await v.open(fixture(), 'correct horse', null);
    const generation = v.lifecycleGeneration;
    finish(db);
    await expect(opening).rejects.toThrow('staleSession');
    expect(v.lifecycleGeneration).toBe(generation);
    expect(v.isOpen()).toBe(action === 'replacement');
  } finally { load.mockRestore(); }
});

test('failed open preserves the existing lifecycle', async () => {
  const v = new Vault();
  const token = await v.open(fixture(), 'correct horse', null);
  await expect(v.open(fixture(), 'wrong', null)).rejects.toBeDefined();
  expect(v.isSessionCurrent(token)).toBe(true);
});

test('tree exposes group + entry', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const tree = v.getTree();
  const sites = tree.children.find(c => c.name === 'Sites');
  expect(sites?.entries[0].title).toBe('GitHub');
});

test('edit marks dirty and round-trips through serialize', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { UserName: 'newuser' });
  expect(v.dirty).toBe(true);
  const bytes = await v.serialize();
  expect(v.dirty).toBe(true);
  v.dirty = false;
  const v2 = new Vault(); await v2.open(bytes, 'correct horse', null);
  expect(v2.getEntry(id)?.username).toBe('newuser');
});

test('create entry appears in url matches', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const root = v.getTree().groupId;
  const id = v.createEntry(root, { Title: 'Ex', URL: 'https://example.com', UserName: 'u', Password: 'p' });
  expect(v.getEntry(id)?.title).toBe('Ex');
  expect(v.entriesForUrl('https://example.com')[0].id).toBe(id);
});

test('createEntry throws on unknown groupId', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  expect(() => v.createEntry('does-not-exist', { Title: 'x' })).toThrow('no group');
});

test('moves an entry between groups while preserving its data', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const entry = v.entriesForUrl('https://github.com')[0];
  const root = v.getTree().groupId;
  const expiry = new Date(2032, 0, 1).getTime();
  v.updateEntry(entry.id, { CustomField: 'keep-me' }, expiry);
  v.setTotpConfig(entry.id, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
  await v.addAttachment(entry.id, 'note.txt', bytesOf('keep attachment'));

  v.moveEntry(entry.id, root);

  expect(v.getTree().entries.some(candidate => candidate.id === entry.id)).toBe(true);
  expect(v.getEntry(entry.id)).toMatchObject({ expires: expiry, hasTotp: true, attachments: [{ name: 'note.txt' }] });
  expect(v.getEntry(entry.id)?.fields).toContainEqual({ key: 'CustomField', value: 'keep-me', protected: false });
});

test('rejects an unknown move destination without moving the entry', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const entry = v.entriesForUrl('https://github.com')[0];
  const originalGroup = v.getTree().children.find(group => group.entries.some(candidate => candidate.id === entry.id))!;

  expect(() => v.moveEntry(entry.id, 'does-not-exist')).toThrow('no group');
  expect(v.getTree().children.find(group => group.groupId === originalGroup.groupId)?.entries.some(candidate => candidate.id === entry.id)).toBe(true);
});

test('validates an update destination before changing entry fields', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const entry = v.entriesForUrl('https://github.com')[0];

  expect(() => v.updateEntry(entry.id, { UserName: 'must-not-change' }, undefined, undefined, undefined, 'missing-group'))
    .toThrow('no group');
  expect(v.getEntry(entry.id)?.username).toBe(entry.username);
});

test('isInvalidKey is true for wrong password', async () => {
  const v = new Vault();
  const err = await v.open(fixture(), 'wrong password', null).then(() => null, e => e);
  expect(err).not.toBeNull();
  expect(isInvalidKey(err)).toBe(true);
});

test('isInvalidKey is false for a corrupt/unreadable file', async () => {
  const v = new Vault();
  const garbage = new ArrayBuffer(64); // not a valid kdbx container
  const err = await v.open(garbage, 'correct horse', null).then(() => null, e => e);
  expect(err).not.toBeNull();
  expect(isInvalidKey(err)).toBe(false);
});

test('isInvalidKey is false for non-kdbx errors', () => {
  expect(isInvalidKey(new Error('CSP blocked wasm'))).toBe(false);
  expect(isInvalidKey('not an error')).toBe(false);
  expect(isInvalidKey(null)).toBe(false);
});

test('mergeRemote unions concurrent edits from a remote clone', async () => {
  // Base: open fixture, serialize so both sides share identical object UUIDs.
  const base = new Vault();
  await base.open(fixture(), 'correct horse', null);
  const baseBytes = await base.serialize();

  // Local edits one entry's username.
  const local = new Vault();
  await local.open(baseBytes, 'correct horse', null);
  const id = local.entriesForUrl('https://github.com')[0].id;
  local.updateEntry(id, { UserName: 'local-user' });

  // Remote (another device) creates a NEW entry from the same base.
  const remote = new Vault();
  await remote.open(baseBytes, 'correct horse', null);
  const rootId = remote.getTree().groupId;
  remote.createEntry(rootId, { Title: 'RemoteOnly', URL: 'https://remote.example', UserName: 'r', Password: 'p' });
  const remoteBytes = await remote.serialize();

  // Merge remote into local: union, no loss.
  await local.mergeRemote(remoteBytes);
  expect(local.dirty).toBe(true);

  // Local edit survives.
  expect(local.getEntry(id)?.username).toBe('local-user');
  // Remote-only entry is now present in local.
  expect(local.entriesForUrl('https://remote.example')).toHaveLength(1);

  // And it round-trips through serialize.
  const merged = await local.serialize();
  const check = new Vault();
  await check.open(merged, 'correct horse', null);
  expect(check.entriesForUrl('https://remote.example')).toHaveLength(1);
  expect(check.getEntry(id)?.username).toBe('local-user');
});

describe('mergeRemote preserves group and attachment edits', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  async function openClones(withAttachment = false) {
    const base = new Vault();
    await base.open(fixture(), 'correct horse', null);
    const id = base.entriesForUrl('https://github.com')[0].id;
    if (withAttachment) await base.addAttachment(id, 'note.txt', bytesOf('original bytes'));
    const baseBytes = await base.serialize();

    const local = new Vault();
    const remote = new Vault();
    await local.open(baseBytes, 'correct horse', null);
    await remote.open(baseBytes, 'correct horse', null);
    const group = remote['db']!.getDefaultGroup().groups.find(group => group.name === 'Sites')!;
    const entry = group.entries.find(entry => entry.uuid.id === id)!;
    // KeePass serialization has second precision; keep real async crypto timers running.
    vi.setSystemTime(Math.max(Date.now(), group.lastModTime, entry.lastModTime) + 1000);
    return { local, remote, id, group, entry };
  }

  async function mergeAndReopen(local: Vault, remote: Vault) {
    await local.mergeRemote(await remote.serialize());
    const reopened = new Vault();
    await reopened.open(await local.serialize(), 'correct horse', null);
    return reopened;
  }

  test('renamed group survives merge into an unchanged peer and reopen', async () => {
    const { local, remote, group } = await openClones();
    const previousModified = group.lastModTime;

    remote.updateGroup(group.uuid.id, { Name: 'Renamed sites' });

    const reopened = await mergeAndReopen(local, remote);
    expect(reopened.getTree().children.find(child => child.groupId === group.uuid.id)?.name).toBe('Renamed sites');
    expect(group.lastModTime).toBeGreaterThan(previousModified);
    expect(remote.dirty).toBe(true);
  });

  test.each(['added', 'replaced'] as const)('%s attachment bytes survive merge into an unchanged peer and reopen', async action => {
    const { local, remote, id, entry } = await openClones(action === 'replaced');
    const previousModified = entry.lastModTime;
    const changedBytes = bytesOf('new attachment bytes');

    await remote.addAttachment(id, 'note.txt', changedBytes);

    const reopened = await mergeAndReopen(local, remote);
    const mergedBytes = reopened.getAttachmentBytes(id, 'note.txt');
    expect(mergedBytes).not.toBeNull();
    expect(new Uint8Array(mergedBytes!)).toEqual(new Uint8Array(changedBytes));
    expect(entry.lastModTime).toBeGreaterThan(previousModified);
    expect(remote.dirty).toBe(true);
  });

  test('removed attachment stays absent after merge into an unchanged peer and reopen', async () => {
    const { local, remote, id, entry } = await openClones(true);
    const previousModified = entry.lastModTime;

    remote.removeAttachment(id, 'note.txt');

    const reopened = await mergeAndReopen(local, remote);
    expect(reopened.getAttachmentBytes(id, 'note.txt')).toBeNull();
    expect(reopened.getEntry(id)?.attachments).toEqual([]);
    expect(entry.lastModTime).toBeGreaterThan(previousModified);
    expect(remote.dirty).toBe(true);
  });

  test("removing a missing attachment throws 'no attachment' without stamping the entry", async () => {
    const { remote, id, entry } = await openClones(true);
    const previousModified = entry.lastModTime;

    expect(() => remote.removeAttachment(id, 'nope.txt')).toThrow('no attachment');

    expect(entry.lastModTime).toBe(previousModified);
    expect(remote.dirty).toBe(false);
    expect(new TextDecoder().decode(remote.getAttachmentBytes(id, 'note.txt')!)).toBe('original bytes');
  });

  test('failed binary creation preserves the attachment, timestamp, and dirty state', async () => {
    const { remote, id, entry } = await openClones(true);
    const previousModified = entry.lastModTime;
    const createBinary = vi.spyOn(remote['db']!, 'createBinary').mockRejectedValueOnce(new Error('binary creation failed'));
    try {
      await expect(remote.addAttachment(id, 'note.txt', bytesOf('replacement bytes'))).rejects.toThrow('binary creation failed');

      expect(entry.lastModTime).toBe(previousModified);
      expect(remote.dirty).toBe(false);
      expect(new TextDecoder().decode(remote.getAttachmentBytes(id, 'note.txt')!)).toBe('original bytes');
      expect(remote['db']!.binaries.getAll()).toHaveLength(1);
    } finally { createBinary.mockRestore(); }
  });
});

test('serialize does not clear dirty', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { UserName: 'newuser' });
  expect(v.dirty).toBe(true);
  await v.serialize();
  expect(v.dirty).toBe(true);
});

test('entrySummariesForUrl returns matches without passwords or custom fields', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const summaries = v.entrySummariesForUrl('https://github.com/login');
  expect(summaries).toHaveLength(1);
  expect(summaries[0].title).toBe('GitHub');
  expect(summaries[0].username).toBe('octocat');
  expect(Object.keys(summaries[0])).not.toContain('password');
  expect(Object.keys(summaries[0])).not.toContain('fields');
});

test('countForUrl equals entriesForUrl length for matching URL and 0 for non-matching', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const count = v.countForUrl('https://github.com/login');
  const entries = v.entriesForUrl('https://github.com/login');
  expect(count).toBe(entries.length);
  expect(count).toBe(1);
  const noMatch = v.countForUrl('https://nonexistent.example');
  expect(noMatch).toBe(0);
});

test('deleteEntry marks dirty and round-trips through serialize', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.deleteEntry(id);
  expect(v.dirty).toBe(true);
  expect(v.entriesForUrl('https://github.com')).toHaveLength(0);
  const bytes = await v.serialize();
  const v2 = new Vault(); await v2.open(bytes, 'correct horse', null);
  expect(v2.entriesForUrl('https://github.com')).toHaveLength(0);
});

test("deleteEntry('nonexistent') throws 'no entry'", async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  expect(() => v.deleteEntry('does-not-exist')).toThrow('no entry');
});

test('deleteEntry on locked vault throws locked', async () => {
  const v = new Vault();
  expect(() => v.deleteEntry('any-id')).toThrow('locked');
});

test('deleteEntry moves the entry into the recycle bin group (not a permanent purge)', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.deleteEntry(id);
  // Reach into the private db field to assert the underlying kdbxweb placement.
  const db = v['db'] as import('kdbxweb').Kdbx;
  const binUuid = db.meta.recycleBinUuid;
  expect(binUuid).toBeDefined();
  const bin = db.getGroup(binUuid!);
  expect(bin).toBeDefined();
  const found = bin!.entries.find(e => e.uuid.id === id);
  expect(found).toBeDefined();
});

test('getTree omits the Recycle Bin group and its entries after a delete', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.deleteEntry(id);

  const db = v['db'] as import('kdbxweb').Kdbx;
  const binUuid = db.meta.recycleBinUuid;
  expect(binUuid).toBeDefined();

  const tree = v.getTree();
  const walk = (n: import('../shared/entry').TreeNode): import('../shared/entry').TreeNode[] =>
    [n, ...n.children.flatMap(walk)];
  const allNodes = walk(tree);

  // The Recycle Bin group itself must not appear anywhere in the tree.
  expect(allNodes.some(n => n.groupId === binUuid!.id)).toBe(false);
  // Nor should the deleted entry appear under any surviving group.
  expect(allNodes.some(n => n.entries.some(e => e.id === id))).toBe(false);
});

test('setting the card flag round-trips through serialize and is excluded from fields[]', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1' });

  const view = v.getEntry(id)!;
  expect(view.isCard).toBe(true);
  expect(view.fields.find(f => f.key === CARD_FLAG_KEY)).toBeUndefined();

  const bytes = await v.serialize();
  const v2 = new Vault(); await v2.open(bytes, 'correct horse', null);
  expect(v2.getEntry(id)?.isCard).toBe(true);
});

test('entries without the card flag default to isCard false', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const view = v.entriesForUrl('https://github.com/login')[0];
  expect(view.isCard).toBe(false);
});

test('clearing the card flag reverts isCard to false', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1' });
  expect(v.getEntry(id)?.isCard).toBe(true);
  v.updateEntry(id, { [CARD_FLAG_KEY]: '' });
  expect(v.getEntry(id)?.isCard).toBe(false);
});

test('entrySummariesForUrl and getTree both expose isCard', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1' });

  const summaries = v.entrySummariesForUrl('https://github.com/login');
  expect(summaries[0].isCard).toBe(true);

  const tree = v.getTree();
  const sites = tree.children.find(c => c.name === 'Sites');
  expect(sites?.entries.find(e => e.id === id)?.isCard).toBe(true);
});

test('TOTP config is protected, omitted from fields, and round-trips through serialize', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.setTotpConfig(id, {
    secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 45,
    issuer: 'GitHub', account: 'octocat',
  });

  const view = v.getEntry(id)!;
  expect(view.hasTotp).toBe(true);
  expect(view.totpPeriod).toBe(45);
  expect(view.fields.find(f => f.key === OTP_FIELD_KEY)).toBeUndefined();
  expect(v.getTotpConfig(id)).toMatchObject({ secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 45 });

  const db = v['db'] as import('kdbxweb').Kdbx;
  const rawEntry = db.getDefaultGroup().groups.flatMap(g => g.entries).find(e => e.uuid.id === id)!;
  expect(rawEntry.fields.get(OTP_FIELD_KEY)).toBeInstanceOf((await import('kdbxweb')).ProtectedValue);

  const bytes = await v.serialize();
  const v2 = new Vault(); await v2.open(bytes, 'correct horse', null);
  expect(v2.getEntry(id)).toMatchObject({ hasTotp: true, totpPeriod: 45 });
  expect(v2.getTotpConfig(id)).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 45 });
});

test('reads KeePass TimeOtp fields and normalizes them only when explicitly edited', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, {
    'TimeOtp-Secret-Base32': 'JBSWY3DPEHPK3PXP',
    'TimeOtp-Algorithm': 'HMAC-SHA-512',
    'TimeOtp-Length': '7',
    'TimeOtp-Period': '60',
  });

  expect(v.getTotpConfig(id)).toMatchObject({ algorithm: 'SHA512', digits: 7, period: 60 });
  expect(v.getEntry(id)).toMatchObject({ hasTotp: true, totpPeriod: 60 });

  v.setTotpConfig(id, v.getTotpConfig(id));
  const db = v['db'] as import('kdbxweb').Kdbx;
  const rawEntry = db.getDefaultGroup().groups.flatMap(g => g.entries).find(e => e.uuid.id === id)!;
  expect(rawEntry.fields.has(OTP_FIELD_KEY)).toBe(true);
  expect(rawEntry.fields.has('TimeOtp-Secret-Base32')).toBe(false);
  expect(rawEntry.fields.has('TimeOtp-Algorithm')).toBe(false);
  expect(rawEntry.fields.has('TimeOtp-Length')).toBe(false);
  expect(rawEntry.fields.has('TimeOtp-Period')).toBe(false);
});

test('removing TOTP clears all recognized formats', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.setTotpConfig(id, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
  v.setTotpConfig(id, null);
  expect(v.getTotpConfig(id)).toBeNull();
  expect(v.getEntry(id)).toMatchObject({ hasTotp: false, totpPeriod: null });
});

test('cardSummariesForUrl: a card entry with no URL matches every site', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1', URL: '' });

  expect(v.cardSummariesForUrl('https://github.com').map(s => s.id)).toContain(id);
  expect(v.cardSummariesForUrl('https://totally-unrelated.example').map(s => s.id)).toContain(id);
});

test('cardSummariesForUrl: a card entry WITH a URL is still restricted to matching sites', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1', URL: 'https://github.com' });

  expect(v.cardSummariesForUrl('https://github.com').map(s => s.id)).toContain(id);
  expect(v.cardSummariesForUrl('https://totally-unrelated.example').map(s => s.id)).not.toContain(id);
});

test('cardSummariesForUrl excludes non-card entries regardless of URL match', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  expect(v.cardSummariesForUrl('https://github.com/login')).toHaveLength(0);
});

test('addAttachment: getEntry shows it with correct name and size', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  const data = bytesOf('hello world');
  await v.addAttachment(id, 'note.txt', data);
  expect(v.dirty).toBe(true);

  const view = v.getEntry(id)!;
  expect(view.attachments).toEqual([{ name: 'note.txt', size: 11 }]);
});

test('addAttachment: entry summary and tree expose hasAttachments', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  await v.addAttachment(id, 'note.txt', bytesOf('x'));

  const summaries = v.entrySummariesForUrl('https://github.com/login');
  expect(summaries[0].hasAttachments).toBe(true);

  const tree = v.getTree();
  const sites = tree.children.find(c => c.name === 'Sites');
  expect(sites?.entries.find(e => e.id === id)?.hasAttachments).toBe(true);
});

test('addAttachment: overwriting the same name cleans up the orphaned pool entry', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  await v.addAttachment(id, 'note.txt', bytesOf('first'));
  await v.addAttachment(id, 'note.txt', bytesOf('second version'));

  const view = v.getEntry(id)!;
  expect(view.attachments).toEqual([{ name: 'note.txt', size: 'second version'.length }]);

  const db = v['db'] as import('kdbxweb').Kdbx;
  expect(db.binaries.getAll()).toHaveLength(1);
});

test('removeAttachment: getAttachment returns null and the pool entry is gone', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  await v.addAttachment(id, 'note.txt', bytesOf('hello'));
  v.removeAttachment(id, 'note.txt');

  expect(v.getEntry(id)?.attachments).toEqual([]);
  expect(v.getAttachmentBytes(id, 'note.txt')).toBeNull();

  const db = v['db'] as import('kdbxweb').Kdbx;
  expect(db.binaries.getAll()).toHaveLength(0);
});

test('attachment bytes round-trip exactly through serialize + reload', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  const original = bytesOf('the quick brown fox');
  await v.addAttachment(id, 'note.txt', original);

  const bytes = await v.serialize();
  const v2 = new Vault(); await v2.open(bytes, 'correct horse', null);
  const roundTripped = v2.getAttachmentBytes(id, 'note.txt');
  expect(roundTripped && new TextDecoder().decode(roundTripped)).toBe('the quick brown fox');
});

test('importTotp assigns keys to existing entries and creates requested new entries', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const existingId = v.entriesForUrl('https://github.com')[0].id;
  const rootId = v.getTree().groupId;

  v.importTotp([
    {
      keyId: 'existing-key',
      config: {
        secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30,
        issuer: 'GitHub', account: 'alice@example.com',
      },
      destination: { type: 'existing', entryId: existingId },
    },
    {
      keyId: 'new-key',
      config: {
        secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA256', digits: 8, period: 30,
        issuer: 'Acme', account: 'bob@example.com',
      },
      destination: {
        type: 'new', groupId: rootId,
        fields: { Title: 'Acme', UserName: 'bob@example.com', Password: '', URL: '' },
      },
    },
  ]);

  expect(v.getTotpConfig(existingId)).toMatchObject({ issuer: 'GitHub', account: 'alice@example.com' });
  const created = v.getTree().entries.find(entry => entry.title === 'Acme');
  expect(created?.hasTotp).toBe(true);
  expect(v.getTotpConfig(created!.id)).toMatchObject({
    secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA256', digits: 8,
  });
});

test('importTotp validates every destination before changing the vault', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const existingId = v.entriesForUrl('https://github.com')[0].id;

  expect(() => v.importTotp([
    {
      keyId: 'valid-first',
      config: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 },
      destination: { type: 'existing', entryId: existingId },
    },
    {
      keyId: 'invalid-second',
      config: { secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA1', digits: 6, period: 30 },
      destination: { type: 'new', groupId: 'missing-group', fields: { Title: 'Nope' } },
    },
  ])).toThrow('no group');

  expect(v.getTotpConfig(existingId)).toBeNull();
  expect(v.dirty).toBe(false);
});

describe('password health report', () => {
  const NOW = Date.UTC(2026, 7, 27);
  const DAY = 24 * 60 * 60 * 1000;

  test('reads real protected password fields and returns only redacted reuse findings', async () => {
    const v = new Vault(); await v.open(fixture(), 'correct horse', null);
    const root = v.getTree().groupId;
    const secret = 'Vault-Only-Reuse-Fixture-938475';
    const first = v.createEntry(root, { Title: 'Alpha', UserName: 'alpha', URL: 'https://alpha.test', Password: secret });
    const second = v.createEntry(root, { Title: 'Beta', UserName: 'beta', URL: 'https://beta.test', Password: secret });

    const db = v['db'] as import('kdbxweb').Kdbx;
    for (const id of [first, second]) {
      const raw = db.getDefaultGroup().entries.find(entry => entry.uuid.id === id)!;
      expect(raw.fields.get('Password')).toBeInstanceOf((await import('kdbxweb')).ProtectedValue);
    }

    const report = v.getPasswordHealthReport(NOW);
    expect(report.counts['reused-password']).toBe(2);
    expect(report.entries.filter(entry => entry.entryId === first || entry.entryId === second)
      .map(entry => entry.issues.find(issue => issue.code === 'reused-password')?.reuseGroupId))
      .toEqual(['reuse-1', 'reuse-1']);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  test('excludes cards, pure notes, and entries moved to the recycle bin', async () => {
    const v = new Vault(); await v.open(fixture(), 'correct horse', null);
    const baselineTotal = v.getPasswordHealthReport(NOW).totalEntries;
    const root = v.getTree().groupId;
    const card = v.createEntry(root, {
      Title: 'Card', UserName: '4111111111111111', Password: '123', [CARD_FLAG_KEY]: '1',
    });
    const note = v.createEntry(root, { Title: 'Secure note', Notes: 'remember this' });
    const deleted = v.createEntry(root, {
      Title: 'Deleted login', UserName: 'deleted', Password: 'password', URL: 'https://deleted.test',
    });
    v.deleteEntry(deleted);

    const report = v.getPasswordHealthReport(NOW);
    expect(report.entries.map(entry => entry.entryId)).not.toEqual(expect.arrayContaining([card, note, deleted]));
    expect(report.totalEntries).toBe(baselineTotal);
  });

  test('surfaces last-modified time and computes stale and expiry relative to the requested time', async () => {
    const v = new Vault(); await v.open(fixture(), 'correct horse', null);
    const id = v.entriesForUrl('https://github.com')[0].id;
    const modifiedAt = NOW - 366 * DAY;
    const db = v['db'] as import('kdbxweb').Kdbx;
    const raw = db.getDefaultGroup().groups.flatMap(group => group.entries).find(entry => entry.uuid.id === id)!;
    raw.times.lastModTime = new Date(modifiedAt);
    raw.times.expires = true;
    raw.times.expiryTime = new Date(NOW - 1);

    const result = v.getPasswordHealthReport(NOW).entries.find(entry => entry.entryId === id)!;
    expect(result.modifiedAt).toBe(modifiedAt);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['stale-entry', 'expired-entry']));
  });

  test('does not mutate the serialized database model or dirty state', async () => {
    const v = new Vault(); await v.open(fixture(), 'correct horse', null);
    expect(v.dirty).toBe(false);
    const db = v['db'] as import('kdbxweb').Kdbx;
    const before = await db.saveXml();

    v.getPasswordHealthReport(NOW);

    expect(v.dirty).toBe(false);
    expect(await db.saveXml()).toBe(before);
  });
});
