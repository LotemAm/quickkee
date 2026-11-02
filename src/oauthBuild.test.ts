// @vitest-environment node
import { resolve } from 'node:path';
import { resolveConfig } from 'vite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { requireOAuthClients } from '../custom-vite-plugins';

const validDropboxId = 'testdropboxappkey';
const validGoogleId = '123456789-testwebclient.apps.googleusercontent.com';

beforeEach(() => {
  vi.stubEnv('VITE_DROPBOX_CLIENT_ID', validDropboxId);
  vi.stubEnv('VITE_GDRIVE_WEB_CLIENT_ID', validGoogleId);
});

afterEach(() => vi.unstubAllEnvs());

function resolveChromeConfig(mode = 'production', command: 'build' | 'serve' = 'build') {
  return resolveConfig({
    configFile: resolve(import.meta.dirname, '../vite.config.chrome.ts'),
    envDir: false, // Never let an ignored local .env hide missing CI configuration.
    mode,
    logLevel: 'silent',
    // CRXJS clears outDir even during serve config resolution. These tests
    // inspect configuration only and must preserve the user's unpacked build.
    build: { emptyOutDir: false },
  }, command);
}

test.each([
  ['VITE_DROPBOX_CLIENT_ID', undefined],
  ['VITE_DROPBOX_CLIENT_ID', ''],
  ['VITE_DROPBOX_CLIENT_ID', '   '],
  ['VITE_DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_ID'],
  ['VITE_DROPBOX_CLIENT_ID', 'your-dropbox-app-key'],
  ['VITE_GDRIVE_WEB_CLIENT_ID', undefined],
  ['VITE_GDRIVE_WEB_CLIENT_ID', ''],
  ['VITE_GDRIVE_WEB_CLIENT_ID', '   '],
  ['VITE_GDRIVE_WEB_CLIENT_ID', 'GDRIVE_WEB_CLIENT_ID'],
  ['VITE_GDRIVE_WEB_CLIENT_ID', 'your-web-client-id.apps.googleusercontent.com'],
  ['VITE_GDRIVE_WEB_CLIENT_ID', 'invalid-client'],
])('production build rejects %s=%j', async (name, value) => {
  vi.stubEnv(name, value);
  await expect(resolveChromeConfig().then(() => undefined)).rejects.toThrow(name);
}, 20_000); // Cold Vite/CRX config bundling competes with the full parallel suite.

test('production build accepts configured Dropbox and Google Drive clients', async () => {
  const config = await resolveChromeConfig();
  expect(config.env.VITE_DROPBOX_CLIENT_ID).toBe(validDropboxId);
  expect(config.env.VITE_GDRIVE_WEB_CLIENT_ID).toBe(validGoogleId);
});

test.each([undefined, '', 'GDRIVE_CLIENT_ID', 'your-client.apps.googleusercontent.com'])(
  'production build rejects invalid native Google Drive client %j', async (nativeClientId) => {
    await expect(resolveConfig({
      configFile: false,
      envDir: false,
      mode: 'production',
      logLevel: 'silent',
      plugins: [requireOAuthClients(nativeClientId)],
    }, 'build').then(() => undefined)).rejects.toThrow('manifest.oauth2.client_id');
  },
);

test.each([
  ['test', 'build'],
  ['development', 'build'],
  ['production', 'serve'],
] as const)('%s %s does not require production OAuth configuration', async (mode, command) => {
  vi.stubEnv('VITE_DROPBOX_CLIENT_ID', '');
  vi.stubEnv('VITE_GDRIVE_WEB_CLIENT_ID', '');
  await expect(resolveChromeConfig(mode, command)).resolves.toBeDefined();
});
