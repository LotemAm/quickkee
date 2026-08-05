import kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';
import { writeFileSync } from 'node:fs';

kdbxweb.CryptoEngine.setArgon2Impl(async (pwd, salt, mem, iter, len, par, type, ver) => {
  const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
  const hash = await fn({ password: new Uint8Array(pwd), salt: new Uint8Array(salt),
    parallelism: par, iterations: iter, memorySize: mem, hashLength: len,
    outputType: 'binary', version: ver });
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
});

const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
const db = kdbxweb.Kdbx.create(creds, 'QuickKee E2E');
const group = db.createGroup(db.getDefaultGroup(), 'Sites');
const e = db.createEntry(group);
e.fields.set('Title', 'Localhost Login');
e.fields.set('UserName', 'e2e-user');
e.fields.set('Password', kdbxweb.ProtectedValue.fromString('e2e-pass'));
e.fields.set('URL', 'http://localhost');
const buf = await db.save();
writeFileSync(new URL('./e2e.kdbx', import.meta.url), Buffer.from(buf));
console.log('wrote e2e.kdbx');
