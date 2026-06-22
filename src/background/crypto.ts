import * as kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';

let registered = false;

export function registerArgon2(): void {
  if (registered) return;
  registered = true;
  kdbxweb.CryptoEngine.setArgon2Impl(async (pwd, salt, mem, iter, len, par, type, ver): Promise<ArrayBuffer> => {
    const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
    const hash = await fn({
      password: new Uint8Array(pwd),
      salt: new Uint8Array(salt),
      parallelism: par,
      iterations: iter,
      memorySize: mem,
      hashLength: len,
      outputType: 'binary',
      version: ver,
    });
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer;
  });
}
