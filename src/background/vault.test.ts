// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault, isInvalidKey } from './vault';
import { CARD_FLAG_KEY } from '../shared/entry';

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

test('open + read entry by url', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  expect(v.dirty).toBe(false);
  const matches = v.entriesForUrl('https://github.com/login');
  expect(matches).toHaveLength(1);
  expect(matches[0].username).toBe('octocat');
  expect(matches[0].password).toBe('s3cr3t');
  expect(matches[0].fields.find(f => f.key === 'Token')?.value).toBe('abc123');
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
