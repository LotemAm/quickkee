// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import kdbxweb from 'kdbxweb';
import { registerXmlParser } from './xml';
import { Vault } from './vault';

const lines = 'LF\nCRLF\r\nCR\rNEL\u0085LS\u2028end';

beforeEach(() => {
  vi.stubGlobal('DOMParser', undefined);
  vi.stubGlobal('XMLSerializer', undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('configures exact line-ending preservation with the installed serializer fallback', () => {
  registerXmlParser();
  const doc = kdbxweb.XmlUtils.parse('<root>' + lines + '</root>');
  expect(doc.documentElement.textContent).toBe(lines);
  expect(kdbxweb.XmlUtils.serialize(doc)).toBe('<root>' + lines + '</root>');
  expect(typeof globalThis.XMLSerializer).toBe('undefined');
});

test('preserves existing Unicode replacement characters in XML text and attributes', () => {
  registerXmlParser();
  const xml = '<root label="before\uFFFDafter">value\uFFFD' + lines + '</root>';
  const doc = kdbxweb.XmlUtils.parse(xml);
  expect(doc.documentElement.getAttribute('label')).toBe('before\uFFFDafter');
  expect(doc.documentElement.textContent).toBe('value\uFFFD' + lines);
  expect(kdbxweb.XmlUtils.serialize(doc)).toBe(xml);
});

test.each([3, 4] as const)('opens and saves a KDBX %i vault containing Unicode replacement characters without changing values', async version => {
  const password = 'replacement-character-test';
  const db = kdbxweb.Kdbx.create(new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password)), 'Vault\uFFFD');
  db.setVersion(version);
  db.setKdf(kdbxweb.Consts.KdfId.Aes);
  const item = db.createEntry(db.getDefaultGroup());
  item.fields.set('Title', 'Entry\uFFFD');
  item.fields.set('Notes', 'Notes\uFFFD' + lines);
  item.fields.set('Password', kdbxweb.ProtectedValue.fromString('Secret\uFFFD'));
  const bytes = await db.save();

  const vault = new Vault();
  await vault.open(bytes, password, null);
  const expected = vault.getEntry(item.uuid.id);
  expect(expected?.title).toBe('Entry\uFFFD');
  expect(expected?.password).toBe('Secret\uFFFD');
  expect(vault.getEntryNotes(item.uuid.id)).toBe('Notes\uFFFD' + lines);
  const saved = await vault.serialize();
  vault.lock();
  await vault.open(saved, password, null);
  expect(vault.getEntry(item.uuid.id)).toEqual(expected);
  expect(vault.getEntryNotes(item.uuid.id)).toBe('Notes\uFFFD' + lines);
});

test('registration is idempotent and leaves pre-existing native DOM APIs untouched', () => {
  registerXmlParser();
  const configured = globalThis.DOMParser;
  registerXmlParser();
  expect(globalThis.DOMParser).toBe(configured);
  const nativeParser = vi.fn();
  const nativeSerializer = vi.fn();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('DOMParser', nativeParser);
  vi.stubGlobal('XMLSerializer', nativeSerializer);
  registerXmlParser();
  expect(globalThis.DOMParser).toBe(nativeParser);
  expect(globalThis.XMLSerializer).toBe(nativeSerializer);
  expect(globalThis.fetch).toBe(originalFetch);
});

test.each([
  ['warning', '<root attr=unquoted/>'],
  ['error', '<root>&unknown;</root>'],
  ['fatal error', '<root/><extra/>'],
  ['warning with a replacement character', '<root attr=unquoted>\uFFFD</root>'],
  ['error with a replacement character', '<root>\uFFFD&unknown;</root>'],
  ['fatal error with a replacement character', '<root>\uFFFD</root><extra/>'],
])('rejects bounded parser %s instead of returning a repaired document', (_level, xml) => {
  registerXmlParser();
  expect(() => kdbxweb.XmlUtils.parse(xml)).toThrow(kdbxweb.KdbxError);
});

test.each([1, 2])('Vault.open registers before XML key-v%i parsing and remains stable across lock/reopen', async keyVersion => {
  const key = await kdbxweb.Credentials.createKeyFileWithHash(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1).buffer, keyVersion,
  );
  const db = kdbxweb.Kdbx.create(new kdbxweb.Credentials(null, key), 'Adapter fixture');
  db.setKdf(kdbxweb.Consts.KdfId.Aes);
  const item = db.createEntry(db.getDefaultGroup());
  item.fields.set('Title', 'Adapter fixture');
  item.fields.set('Custom lines', lines);
  const bytes = await db.save();
  expect(typeof globalThis.DOMParser).toBe('undefined');

  const keyParsers: (typeof globalThis.DOMParser)[] = [];
  const parse = kdbxweb.XmlUtils.parse;
  vi.spyOn(kdbxweb.XmlUtils, 'parse').mockImplementation(xml => {
    if (xml.includes('<KeyFile>')) keyParsers.push(globalThis.DOMParser);
    return parse(xml);
  });
  const vault = new Vault();
  await vault.open(bytes, null, Uint8Array.from(key).buffer);
  expect(typeof globalThis.DOMParser).toBe('function');
  expect(vault.getEntry(item.uuid.id)?.fields.find(field => field.key === 'Custom lines')?.value).toBe(lines);
  const configured = globalThis.DOMParser;
  expect(keyParsers).toEqual([configured]);
  const saved = await vault.serialize();
  vault.lock();
  expect(globalThis.DOMParser).toBe(configured);
  await vault.open(saved, null, Uint8Array.from(key).buffer);
  expect(globalThis.DOMParser).toBe(configured);
  expect(vault.getEntry(item.uuid.id)?.fields.find(field => field.key === 'Custom lines')?.value).toBe(lines);
});
