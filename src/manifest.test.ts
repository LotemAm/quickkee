// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from '../manifest.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function csp(file: string): string {
  const m = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  return m.content_security_policy?.extension_pages ?? '';
}

// Regression guard: Argon2 (hash-wasm) needs WebAssembly, which MV3's default
// `script-src 'self'` CSP blocks — that made every unlock fail as "Wrong password"
// in a real browser. Do not drop 'wasm-unsafe-eval'. See
// docs/superpowers/plans/2026-06-22-unlock-csp-wasm-fix.md
// manifest.dev.json carries no CSP of its own; the build shallow-merges it over
// manifest.json, so the base CSP below is what ships in both prod and dev.
test('manifest.json CSP allows wasm-unsafe-eval for Argon2', () => {
  expect(csp('manifest.json')).toContain('wasm-unsafe-eval');
});

test('manifest grants identity permission for OAuth', () => {
  expect(manifest.permissions).toContain('identity');
});

test('manifest grants host permissions for both cloud providers', () => {
  const hosts = manifest.host_permissions ?? [];
  expect(hosts).toEqual(expect.arrayContaining([
    'https://api.dropboxapi.com/*',
    'https://content.dropboxapi.com/*',
    'https://www.googleapis.com/*',
    'https://oauth2.googleapis.com/*',
  ]));
});

// Regression guard: card (and login) forms are frequently rendered inside a
// cross-origin iframe (e.g. Google Wallet's "Add a payment method" dialog embeds
// payments.google.com in an <iframe>). Without all_frames, the content script
// only runs in the top-level document and never sees fields inside such iframes,
// so the inline popup silently never appears there.
test('content script injects into all frames, not just the top-level document', () => {
  const cs = manifest.content_scripts?.[0];
  expect(cs?.all_frames).toBe(true);
});
