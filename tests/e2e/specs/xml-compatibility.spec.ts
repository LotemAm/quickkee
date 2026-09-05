import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import kdbxweb from 'kdbxweb';
import { test, expect, installDb, openExtensionPage, reReadKdbx } from '../helpers';
import { cloudInstall, cloudSetRemote, cloudUploadCount, reReadCloudKdbx } from '../cloudSeam';
import type { Request, ResponseFor } from '../../../src/shared/messages';
import { registerArgon2 } from '../../../src/background/crypto';

const password = 'xml-compatibility-fixture-only';
const text = 'עברית 日本語 😀 & < > " \'';
const multiline = 'LF\nCRLF\r\nCR\rfinal';
const expiry = Date.parse('2035-06-07T08:09:10.000Z');
const attachment = [0, 1, 13, 10, 127, 128, 255];
const modes = ['password', 'key-v1', 'both-v2', 'binary-key'] as const;
type Mode = typeof modes[number];

// Generated synthetic KDBX 3/4 files saved by kdbxweb 2.1.1 + xmldom 0.7.13.
// Keeping encrypted baseline bytes makes candidate reads independent of its writer.
const baseline: Record<3 | 4, string> = {
  "3": "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",
  "4": "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"
};

function bytes(b64: string): ArrayBuffer {
  return Uint8Array.from(Buffer.from(b64, 'base64')).buffer;
}

async function request<R extends Request>(page: Page, req: R): Promise<ResponseFor<R['type']>> {
  return page.evaluate(message => chrome.runtime.sendMessage(message), req) as Promise<ResponseFor<R['type']>>;
}

function entry(db: kdbxweb.Kdbx): kdbxweb.KdbxEntry {
  return db.getDefaultGroup().groups.find(group => group.name === 'Group ' + text)!.groups[0].entries[0];
}

function assertPreserved(db: kdbxweb.Kdbx, version: 3 | 4, username = 'current-user') {
  const current = entry(db);
  expect(db.versionMajor).toBe(version);
  expect(db.meta.name).toBe('XML ' + text);
  expect(db.getDefaultGroup().groups.find(group => group.name === 'Group ' + text)?.notes).toBe(multiline);
  expect(current.fields.get('Title')).toBe(text);
  expect(current.fields.get('UserName')).toBe(username);
  expect(current.fields.get('Notes')).toBe(multiline);
  expect(current.fields.get('Empty')).toBe('');
  expect(current.fields.get('Custom ' + text)).toBe(text + multiline);
  for (const field of ['Password', 'Protected custom']) {
    expect(current.fields.get(field)).toBeInstanceOf(kdbxweb.ProtectedValue);
    expect((current.fields.get(field) as kdbxweb.ProtectedValue).getText()).toBe(text + multiline);
  }
  expect(current.fields.get('otp')).toBeInstanceOf(kdbxweb.ProtectedValue);
  expect((current.fields.get('otp') as kdbxweb.ProtectedValue).getText()).toBe('otpauth://totp/XML:test?secret=JBSWY3DPEHPK3PXP&issuer=XML');
  expect(current.tags).toEqual(['tag-one', 'タグ']);
  expect(current.times.expires).toBe(true);
  expect(current.times.expiryTime?.getTime()).toBe(expiry);
  expect(current.times.creationTime?.toISOString()).toBe('2025-01-02T03:04:05.000Z');
  expect(current.history.some(old => old.fields.get('UserName') === 'fixture-user')).toBe(true);
  const old = current.history.find(item => item.fields.get('UserName') === 'fixture-user')!;
  expect(old.fields.get('Notes')).toBe(multiline);
  expect((old.fields.get('Password') as kdbxweb.ProtectedValue).getText()).toBe(text + multiline);
  const binary = current.binaries.get('bytes & <.bin');
  if (!binary || !('value' in binary)) throw new Error('Fixture attachment not resolved');
  const value = binary.value;
  expect(Array.from(value instanceof kdbxweb.ProtectedValue ? value.getBinary() : new Uint8Array(value))).toEqual(attachment);
}

async function access(mode: Mode) {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const keyFile = mode === 'password' ? null : mode === 'binary-key'
    ? new TextEncoder().encode('arbitrary non-XML test key file')
    : await kdbxweb.Credentials.createKeyFileWithHash(key.buffer, mode === 'key-v1' ? 1 : 2);
  const pwd = mode === 'password' || mode === 'both-v2' ? password : null;
  return {
    keyFile, pwd,
    credentials: new kdbxweb.Credentials(pwd ? kdbxweb.ProtectedValue.fromString(pwd) : null, keyFile),
  };
}

async function savedBytes(page: Page): Promise<ArrayBuffer> {
  const values = await page.evaluate(() => new Promise<number[]>((resolveBytes, reject) => {
    const open = indexedDB.open('quickkee', 2);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('handles', 'readonly');
      const read = transaction.objectStore('handles').get('testBytes');
      read.onsuccess = () => {
        if (!(read.result instanceof ArrayBuffer)) reject(new Error('Missing saved test vault'));
        else resolveBytes(Array.from(new Uint8Array(read.result)));
      };
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
  return Uint8Array.from(values).buffer;
}

for (const version of [3, 4] as const) {
  for (const mode of modes) {
    test('actual worker KDBX ' + version + ' ' + mode + ' preserves baseline XML values through open/save/reopen', async ({ context, extensionId }, testInfo) => {
      registerArgon2();
      const initial = await kdbxweb.Kdbx.load(bytes(baseline[version]), (await access('password')).credentials);
      assertPreserved(initial, version);
      const material = await access(mode);
      const initialId = entry(initial).uuid.id;
      const data = mode === 'password' ? bytes(baseline[version]) : await (async () => {
        initial.credentials = material.credentials;
        return initial.save();
      })();
      const fixturePath = testInfo.outputPath('xml-baseline.kdbx');
      writeFileSync(fixturePath, new Uint8Array(data));
      const page = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const globals = await worker.evaluate(() => ({
        DOMParser: typeof globalThis.DOMParser, XMLSerializer: typeof globalThis.XMLSerializer,
      }));
      expect(globals).toEqual({ DOMParser: 'undefined', XMLSerializer: 'undefined' });
      console.log('XML_WORKER_RUNTIME ' + JSON.stringify({ version, mode, ...globals }));
      await installDb(page, fixturePath);
      const unlock: Request = { type: 'unlock', password: material.pwd, keyFile: material.keyFile ? Array.from(material.keyFile) : null };
      expect(await request(page, unlock)).toEqual({ ok: true });
      const details = await request(page, { type: 'getEntry', entryId: initialId });
      if (!details.ok || !details.entry) throw new Error('Worker did not open the fixture entry');
      expect(details.entry.password).toBe(text + multiline);
      expect(details.entry.fields.find(field => field.key === 'Custom ' + text)?.value).toBe(text + multiline);
      expect(details.entry.expires).toBe(expiry);
      expect(await request(page, { type: 'updateEntry', entryId: initialId, fields: { UserName: 'worker ' + text } })).toEqual({ ok: true });
      expect((await request(page, { type: 'save' })).ok).toBe(true);
      const saved = await savedBytes(page);
      const reopened = mode === 'password'
        ? await reReadKdbx(page, password)
        : await kdbxweb.Kdbx.load(saved, (await access(mode)).credentials);
      assertPreserved(reopened, version, 'worker ' + text);
      expect(entry(reopened).uuid.id).toBe(initialId);
      expect(entry(reopened).history.some(old => old.fields.get('UserName') === 'current-user')).toBe(true);
      expect(await request(page, { type: 'lock' })).toEqual({ ok: true });
      expect(await request(page, unlock)).toEqual({ ok: true });
      const after = await request(page, { type: 'getEntry', entryId: initialId });
      if (!after.ok || !after.entry) throw new Error('Worker did not reopen saved fixture');
      expect(after.entry.password).toBe(text + multiline);
      expect(after.entry.username).toBe('worker ' + text);
    });
  }

  test('actual worker KDBX ' + version + ' cloud merge retains divergent changes and XML metadata', async ({ context, extensionId }) => {
    registerArgon2();
    const page = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
    await cloudInstall(page, baseline[version]);
    expect((await request(page, { type: 'openRemote', provider: 'dropbox', fileId: 'f1', fileName: 'cloud.kdbx', password, keyFile: null })).ok).toBe(true);
    const remote = await kdbxweb.Kdbx.load(bytes(baseline[version]), (await access('password')).credentials);
    const id = entry(remote).uuid.id;
    const remoteEntry = remote.createEntry(remote.getDefaultGroup());
    remoteEntry.fields.set('Title', 'Remote ' + text);
    remoteEntry.fields.set('Notes', multiline);
    remoteEntry.fields.set('Password', kdbxweb.ProtectedValue.fromString(text + multiline));
    remoteEntry.times.expires = true;
    remoteEntry.times.expiryTime = new Date(expiry);
    await cloudSetRemote(page, Buffer.from(await remote.save()).toString('base64'));
    expect(await request(page, { type: 'updateEntry', entryId: id, fields: { UserName: 'local ' + text } })).toEqual({ ok: true });
    expect(await request(page, { type: 'save' })).toEqual({ ok: true, merged: true });
    expect(await cloudUploadCount(page)).toBeGreaterThan(0);
    const merged = await reReadCloudKdbx(page, password);
    assertPreserved(merged, version, 'local ' + text);
    const received = merged.getDefaultGroup().entries.find(item => item.uuid.id === remoteEntry.uuid.id)!;
    expect(received.fields.get('Title')).toBe('Remote ' + text);
    expect(received.fields.get('Notes')).toBe(multiline);
    expect((received.fields.get('Password') as kdbxweb.ProtectedValue).getText()).toBe(text + multiline);
    expect(received.times.expiryTime?.getTime()).toBe(expiry);
  });
}

// The production worker must be observed directly too: the test build has extra commands.
// Rebuild only with no fixture context open, and restore the test build for subsequent specs.
// eslint-disable-next-line no-empty-pattern
test('production extension worker runtime has no native XML globals', async ({}, testInfo) => {
  // Two bounded builds (60s each), plus worker startup and observation.
  test.setTimeout(180_000);
  const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const build = (script: string) => execFileSync(yarn, [script], { cwd: process.cwd(), windowsHide: true, timeout: 60_000 });
  try {
    build('build:production');
    const extension = resolve('dist_chrome');
    const context = await chromium.launchPersistentContext(testInfo.outputPath('production-profile'), {
      headless: false, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run'],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const globals = await worker.evaluate(() => ({
        DOMParser: typeof globalThis.DOMParser, XMLSerializer: typeof globalThis.XMLSerializer,
      }));
      expect(globals).toEqual({ DOMParser: 'undefined', XMLSerializer: 'undefined' });
      console.log('XML_PRODUCTION_RUNTIME ' + JSON.stringify(globals));
      const page = await openExtensionPage(context, new URL(worker.url()).host, 'src/pages/popup/index.html');
      expect(await request(page, { type: 'getStatus' })).toMatchObject({ ok: true, locked: true });
      const noTestHarness = await page.evaluate(() => !('__qkTest' in window));
      expect(noTestHarness).toBe(true);
    } finally { await context.close(); }
  } finally { build('build:chrome:test'); }
});

