import type { Page } from '@playwright/test';
import kdbxweb from 'kdbxweb';
import { registerArgon2 } from '../../src/background/crypto';

/** Build a base64 .kdbx in Node with one entry, optionally mutated. */
export async function makeKdbxB64(mutate?: (db: kdbxweb.Kdbx) => void): Promise<string> {
  registerArgon2();
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
  const db = kdbxweb.Kdbx.create(creds, 'Cloud E2E');
  const g = db.createGroup(db.getDefaultGroup(), 'Sites');
  const e = db.createEntry(g);
  e.fields.set('Title', 'Cloud Login');
  e.fields.set('UserName', 'cloud-user');
  e.fields.set('Password', kdbxweb.ProtectedValue.fromString('cloud-pass'));
  e.fields.set('URL', 'http://localhost');
  if (mutate) mutate(db);
  const buf = await db.save();
  const arr = new Uint8Array(buf); let s = ''; for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Load a base64 .kdbx, apply a mutation, and return updated base64 bytes.
 * The resulting DB shares the same root UUID as the original, so kdbxweb merge works.
 */
export async function mutateKdbxB64(baseB64: string, mutate: (db: kdbxweb.Kdbx) => void): Promise<string> {
  registerArgon2();
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
  const bin = atob(baseB64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const db = await kdbxweb.Kdbx.load(arr.buffer, creds);
  mutate(db);
  const buf = await db.save();
  const arr2 = new Uint8Array(buf); let s = ''; for (const b of arr2) s += String.fromCharCode(b);
  return btoa(s);
}

export async function cloudInstall(page: Page, b64: string): Promise<void> {
  await page.evaluate(({ b64 }) =>
    chrome.runtime.sendMessage({ __qk: 'test', cmd: 'cloudInstall', provider: 'dropbox', fileId: 'f1', name: 'cloud.kdbx', b64 }),
    { b64 });
}
export async function cloudSetRemote(page: Page, b64: string): Promise<void> {
  await page.evaluate(({ b64 }) =>
    chrome.runtime.sendMessage({ __qk: 'test', cmd: 'cloudSetRemote', provider: 'dropbox', fileId: 'f1', name: 'cloud.kdbx', b64 }),
    { b64 });
}
export async function cloudUploadCount(page: Page): Promise<number> {
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ __qk: 'test', cmd: 'cloudUploads' }));
  return (r as { count: number }).count;
}

/**
 * Read merged bytes from the cloud cache (key "dropbox:f1") and decrypt them.
 * Use instead of reReadKdbx for cloud-sourced vaults.
 */
export async function reReadCloudKdbx(page: Page, password = 'correct horse'): Promise<kdbxweb.Kdbx> {
  registerArgon2();
  const b64: string = await page.evaluate(() => new Promise<string>((res, rej) => {
    const open = indexedDB.open('quickkee', 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    open.onsuccess = () => {
      const req = open.result.transaction('cache', 'readonly').objectStore('cache').get('dropbox:f1');
      req.onsuccess = () => {
        const rec = req.result as { bytes: ArrayBuffer } | undefined;
        if (!rec) { rej(new Error('dropbox:f1 not found in cache (cloud file not opened?)')); return; }
        const bytes = new Uint8Array(rec.bytes);
        let s = ''; for (const b of bytes) s += String.fromCharCode(b);
        res(btoa(s));
      };
      req.onerror = () => rej(req.error);
    };
    open.onerror = () => rej(open.error);
  }));
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password));
  return kdbxweb.Kdbx.load(arr.buffer, creds);
}
