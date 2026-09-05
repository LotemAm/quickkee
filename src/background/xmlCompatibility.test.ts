// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import kdbxweb from 'kdbxweb';
import { Vault } from './vault';
import { registerArgon2 } from './crypto';
import { registerXmlParser } from './xml';

const password = 'xml-compatibility-fixture-only';
const instant = new Date('2025-01-02T03:04:05.000Z');
const expiry = new Date('2035-06-07T08:09:10.000Z');
const text = 'עברית 日本語 😀 & < > " \'';
const multiline = 'LF\nCRLF\r\nCR\rNEL\u0085LS\u2028final';
const attachment = new Uint8Array([0, 1, 13, 10, 127, 128, 255]);
const modes = ['password', 'key-v1', 'both-v2', 'binary-key'] as const;
type Mode = typeof modes[number];

const outputDir = process.env.QK_XML_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), 'quickkee-xml-'));
beforeAll(() => {
  registerArgon2();
  registerXmlParser();
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

test('the Node KDBX API uses the configured parser and installed serializer fallback', () => {
  expect(typeof globalThis.DOMParser).toBe('function');
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
        const oldVault = new Vault();
        await oldVault.open(oldBytes, mode === 'password' || mode === 'both-v2' ? password : null, key);
        const rewritten = await oldVault.serialize();
        expect(semantics(await kdbxweb.Kdbx.load(rewritten, credentials(mode, key)))).toEqual(oldExpected);
        writeFileSync(join(outputDir, 'reference-' + name + '.kdbx'), new Uint8Array(rewritten));
        writeFileSync(join(outputDir, 'reference-' + name + '.json'), JSON.stringify(oldExpected));
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
      const mergedBytes = await local.save();
      const merged = await kdbxweb.Kdbx.load(mergedBytes, credentials('password', key));
      expect(entryValues(findEntry(merged))).toEqual(localExpected);
      expect(groupValues(merged.getDefaultGroup().groups.find(group => group.uuid.id === remoteGroup.uuid.id)!)).toEqual(remoteExpected);
      writeFileSync(join(outputDir, 'v' + version + '-merged.kdbx'), new Uint8Array(mergedBytes));
      writeFileSync(join(outputDir, 'v' + version + '-merged.json'), JSON.stringify(semantics(merged)));
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

// Written by the preserved 0.7.13 runtime, including NEL and Unicode line separator.
const supplemental: Record<3 | 4, string> = {
  "3": "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",
  "4": "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"
};

test.each([3, 4] as const)('old-parser KDBX %i preserves every line ending through Vault save/reopen', async version => {
  const oldBytes = buffer(Buffer.from(supplemental[version], 'base64'));
  const vault = new Vault();
  await vault.open(oldBytes, password, null);
  const reopened = await kdbxweb.Kdbx.load(await vault.serialize(), credentials('password', null));
  const current = findEntry(reopened);
  expect(reopened.getDefaultGroup().groups.find(group => group.name === 'Group ' + text)?.notes).toBe(multiline);
  for (const item of [current, ...current.history]) {
    expect(item.fields.get('Notes')).toBe(multiline);
    expect(item.fields.get('Custom ' + text)).toBe(text + multiline);
    for (const name of ['Password', 'Protected custom']) {
      expect(item.fields.get(name)).toBeInstanceOf(kdbxweb.ProtectedValue);
      expect((item.fields.get(name) as kdbxweb.ProtectedValue).getText()).toBe(text + multiline);
    }
  }
});
