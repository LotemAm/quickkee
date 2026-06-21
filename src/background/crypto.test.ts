// @vitest-environment node
import * as kdbxweb from 'kdbxweb';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerArgon2 } from './crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = resolve(__dirname, '../test/fixtures/test.kdbx');

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(FIXTURE_PATH);
  // Copy into a fresh ArrayBuffer — Node Buffer shares a larger backing store
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

test('opens fixture with correct password', async () => {
  registerArgon2();
  const ab = loadFixture();
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
  const db = await kdbxweb.Kdbx.load(ab, creds);
  expect(db.meta.name).toBe('QuickKee Test');

  // Assert fixture contents
  const root = db.getDefaultGroup();
  const sitesGroup = root.groups.find((g) => g.name === 'Sites');
  expect(sitesGroup).toBeDefined();

  const entry = sitesGroup!.entries[0];
  const title = entry.fields.get('Title');
  const userName = entry.fields.get('UserName');
  const token = entry.fields.get('Token');

  expect(
    title instanceof kdbxweb.ProtectedValue ? title.getText() : title,
  ).toBe('GitHub');
  expect(
    userName instanceof kdbxweb.ProtectedValue ? userName.getText() : userName,
  ).toBe('octocat');
  expect(
    token instanceof kdbxweb.ProtectedValue ? token.getText() : token,
  ).toBe('abc123');
});

test('rejects wrong password', async () => {
  registerArgon2();
  const ab = loadFixture();
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('wrong'));
  await expect(kdbxweb.Kdbx.load(ab, creds)).rejects.toThrow();
});
