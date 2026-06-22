import { saveTestBytes } from '../background/fileHandle';

if (import.meta.env.VITE_QK_TEST === '1') {
  (globalThis as unknown as { __qkTest: unknown }).__qkTest = {
    async installDb(name: string, b64: string) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await saveTestBytes(name, bytes.buffer);
    },
  };
}
