import * as kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';
import { writeFileSync } from 'node:fs';

kdbxweb.CryptoEngine.setArgon2Impl(async (pwd, salt, mem, iter, len, par, type, ver) => {
  const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
  return fn({
    password: new Uint8Array(pwd),
    salt: new Uint8Array(salt),
    parallelism: par,
    iterations: iter,
    memorySize: mem,
    hashLength: len,
    outputType: 'binary',
    version: ver,
  });
});

const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse'));
const db = kdbxweb.Kdbx.create(creds, 'QuickKee Test');
const group = db.createGroup(db.getDefaultGroup(), 'Sites');
const e = db.createEntry(group);
e.fields.set('Title', 'GitHub');
e.fields.set('UserName', 'octocat');
e.fields.set('Password', kdbxweb.ProtectedValue.fromString('s3cr3t'));
e.fields.set('URL', 'https://github.com');
e.fields.set('Token', 'abc123');
const buf = await db.save();
writeFileSync(new URL('./test.kdbx', import.meta.url), Buffer.from(buf));
console.log('wrote test.kdbx');
