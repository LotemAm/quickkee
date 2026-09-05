// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import kdbxweb from 'kdbxweb';
import { Vault } from './vault';
import { registerArgon2 } from './crypto';

const password = 'xml-compatibility-fixture-only';
const instant = new Date('2025-01-02T03:04:05.000Z');
const expiry = new Date('2035-06-07T08:09:10.000Z');
const text = 'עברית 日本語 😀 & < > " \'';
const multiline = 'LF\nCRLF\r\nCR\rfinal';
const attachment = new Uint8Array([0, 1, 13, 10, 127, 128, 255]);
const modes = ['password', 'key-v1', 'both-v2', 'binary-key'] as const;
type Mode = typeof modes[number];

const outputDir = process.env.QK_XML_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), 'quickkee-xml-'));
beforeAll(() => {
  registerArgon2();
  mkdirSync(outputDir, { recursive: true });
});

function buffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function keyFile(mode: Mode): Promise<ArrayBuffer | null> {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  if (mode === 'password') return null;
  if (mode === 'binary-key') return buffer(new TextEncoder().encode('arbitrary non-XML test key file'));
  return buffer(await kdbxweb.Credentials.createKeyFileWithHash(key.buffer, mode === 'key-v1' ? 1 : 2));
}

function credentials(mode: Mode, key: ArrayBuffer | null): kdbxweb.Credentials {
  return new kdbxweb.Credentials(
    mode === 'password' || mode === 'both-v2' ? kdbxweb.ProtectedValue.fromString(password) : null,
    key,
  );
}

function stamp(times: kdbxweb.KdbxTimes): void {
  times.creationTime = instant;
  times.lastModTime = instant;
  times.lastAccessTime = instant;
  times.locationChanged = instant;
  times.expiryTime = expiry;
  times.expires = true;
  times.usageCount = 7;
}

async function fixture(version: 3 | 4, mode: Mode) {
  const key = await keyFile(mode);
  const db = kdbxweb.Kdbx.create(credentials(mode, key), 'XML ' + text);
  db.setVersion(version);
  // Small fixtures use the supported AES KDF; existing vault tests cover Argon2.
  db.setKdf(kdbxweb.Consts.KdfId.Aes);
  const root = db.getDefaultGroup();
  const group = db.createGroup(root, 'Group ' + text);
  group.notes = multiline;
  const nested = db.createGroup(group, 'Nested');
  for (const item of [root, ...root.groups, nested]) {
    stamp(item.times);
    item.notes ??= '';
  }
  const entry = db.createEntry(nested);
  entry.fields.set('Title', text);
  entry.fields.set('UserName', 'fixture-user');
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(text + multiline));
  entry.fields.set('URL', 'https://xml.example.test/?a=1&b=2');
  entry.fields.set('Notes', multiline);
  entry.fields.set('Empty', '');
  entry.fields.set('Custom ' + text, text + multiline);
  entry.fields.set('Protected custom', kdbxweb.ProtectedValue.fromString(text + multiline));
  entry.fields.set('otp', kdbxweb.ProtectedValue.fromString('otpauth://totp/XML:test?secret=JBSWY3DPEHPK3PXP&issuer=XML'));
  entry.tags = ['tag-one', 'タグ'];
  entry.binaries.set('bytes & <.bin', await db.createBinary(attachment.buffer));
  stamp(entry.times);
  entry.pushHistory();
  entry.fields.set('UserName', 'current-user');
  entry.times.lastModTime = new Date(instant.getTime() + 1000);
  return { db, key, entry };
}

function timeValues(times: kdbxweb.KdbxTimes) {
  return {
    created: times.creationTime?.toISOString(), modified: times.lastModTime?.toISOString(),
    accessed: times.lastAccessTime?.toISOString(), moved: times.locationChanged?.toISOString(),
    expires: times.expires, expiry: times.expiryTime?.toISOString(), usage: times.usageCount,
  };
}

function binaryValues(value: kdbxweb.KdbxBinary | kdbxweb.KdbxBinaryWithHash): number[] {
  const data = 'value' in value ? value.value : value;
  return Array.from(data instanceof kdbxweb.ProtectedValue ? data.getBinary() : new Uint8Array(data));
}

function entryValues(entry: kdbxweb.KdbxEntry): unknown {
  return {
    id: entry.uuid.id, icon: entry.icon, tags: entry.tags, times: timeValues(entry.times),
    fields: Object.fromEntries([...entry.fields].map(([name, value]) => [name, {
      value: value instanceof kdbxweb.ProtectedValue ? value.getText() : value,
      protected: value instanceof kdbxweb.ProtectedValue,
    }])),
    binaries: Object.fromEntries([...entry.binaries].map(([name, value]) => {

      return [name, binaryValues(value)];
    })),
    history: entry.history.map(entryValues),
  };
}

function groupValues(group: kdbxweb.KdbxGroup): unknown {
  return {
    id: group.uuid.id, name: group.name, notes: group.notes, times: timeValues(group.times),
    entries: group.entries.map(entryValues), groups: group.groups.map(groupValues),
  };
}

function semantics(db: kdbxweb.Kdbx) {
  return {
    version: db.versionMajor, name: db.meta.name,
    groups: db.groups.map(groupValues),
  };
}

function findEntry(db: kdbxweb.Kdbx): kdbxweb.KdbxEntry {
  return db.getDefaultGroup().groups.find(group => group.name === 'Group ' + text)!.groups[0].entries[0];
}

test('the Node KDBX API uses the installed fallback parser and serializer', () => {
  expect(typeof globalThis.DOMParser).toBe('undefined');
  expect(typeof globalThis.XMLSerializer).toBe('undefined');
  expect(kdbxweb.XmlUtils.parse('<root/>').documentElement.nodeName).toBe('root');
  expect(kdbxweb.XmlUtils.serialize(kdbxweb.XmlUtils.parse('<root/>'))).toBe('<root/>');
});

for (const version of [3, 4] as const) {
  describe('KDBX ' + version, () => {
    test.each(modes)('%s preserves exact fields, groups, history, binaries and expiry through save/reopen', async mode => {
      const { db, key } = await fixture(version, mode);
      const expected = semantics(db);
      const bytes = await db.save();
      const name = 'v' + version + '-' + mode;
      writeFileSync(join(outputDir, name + '.kdbx'), new Uint8Array(bytes));
      writeFileSync(join(outputDir, name + '.json'), JSON.stringify(expected));
      const reopened = await kdbxweb.Kdbx.load(bytes, credentials(mode, key));
      expect(semantics(reopened)).toEqual(expected);
      const vault = new Vault();
      await vault.open(bytes, mode === 'password' || mode === 'both-v2' ? password : null, key);
      expect(vault.getEntry(findEntry(reopened).uuid.id)?.fields.find(field => field.key === 'Custom ' + text)?.value).toBe(text + multiline);
      expect(new Uint8Array(vault.getAttachmentBytes(findEntry(reopened).uuid.id, 'bytes & <.bin')!)).toEqual(attachment);
      expect(semantics(await kdbxweb.Kdbx.load(await vault.serialize(), credentials(mode, key)))).toEqual(expected);
      if (process.env.QK_XML_REFERENCE_DIR) {
        const oldBytes = buffer(readFileSync(join(process.env.QK_XML_REFERENCE_DIR, name + '.kdbx')));
        const oldExpected: unknown = JSON.parse(readFileSync(join(process.env.QK_XML_REFERENCE_DIR, name + '.json'), 'utf8'));
        const old = await kdbxweb.Kdbx.load(oldBytes, credentials(mode, key));
        expect(semantics(old)).toEqual(oldExpected);
        expect(semantics(await kdbxweb.Kdbx.load(await old.save(), credentials(mode, key)))).toEqual(oldExpected);
      }
    });

    test('divergent copies retain exact local/remote fields, history and attachments after merge/reopen', async () => {
      const { db, key } = await fixture(version, 'password');
      const base = await db.save();
      const local = await kdbxweb.Kdbx.load(base, credentials('password', key));
      const remote = await kdbxweb.Kdbx.load(base, credentials('password', key));
      const localEntry = findEntry(local);
      localEntry.pushHistory();
      localEntry.fields.set('UserName', 'local ' + text);
      localEntry.times.lastModTime = new Date(instant.getTime() + 2000);
      const remoteGroup = remote.createGroup(remote.getDefaultGroup(), 'Remote ' + text);
      stamp(remoteGroup.times);
      remoteGroup.notes = multiline;
      const remoteEntry = remote.createEntry(remoteGroup);
      remoteEntry.fields.set('Title', 'Remote ' + text);
      remoteEntry.fields.set('Notes', multiline);
      remoteEntry.fields.set('Password', kdbxweb.ProtectedValue.fromString(multiline));
      remoteEntry.binaries.set('remote.bin', await remote.createBinary(attachment.buffer));
      stamp(remoteEntry.times);
      const localExpected = entryValues(localEntry);
      const remoteExpected = groupValues(remoteGroup);
      local.merge(remote);
      const merged = await kdbxweb.Kdbx.load(await local.save(), credentials('password', key));
      expect(entryValues(findEntry(merged))).toEqual(localExpected);
      expect(groupValues(merged.getDefaultGroup().groups.find(group => group.uuid.id === remoteGroup.uuid.id)!)).toEqual(remoteExpected);
    });
  });
}

test.each([
  '<KeePassFile><Root></KeePassFile>',
  '<KeePassFile><Root>&unknown;</Root></KeePassFile>',
  '<KeePassFile/><extra/>',
])('bounded malformed vault XML rejects: %s', async xml => {
  await expect(kdbxweb.Kdbx.loadXml(xml, credentials('password', null))).rejects.toBeInstanceOf(kdbxweb.KdbxError);
});
