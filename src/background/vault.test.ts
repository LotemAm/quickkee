// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault } from './vault';

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
  expect(v.dirty).toBe(false);
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
