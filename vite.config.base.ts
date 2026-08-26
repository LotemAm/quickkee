import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { ManifestV3Export } from '@crxjs/vite-plugin';
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type BuildOptions } from 'vite';
import { stripDevIcons, crxI18n } from './custom-vite-plugins.ts';
import manifest from './manifest.json' with { type: 'json' };
import devManifest from './manifest.dev.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };


const isDev = process.env.__DEV__ === 'true';
// set this flag to true, if you want localization support
const localize = false;

export const baseManifest = {
    ...manifest,
    version: pkg.version,
    ...(isDev ? devManifest : {} as ManifestV3Export),
    ...(localize ? {
      name: '__MSG_extName__',
      description: '__MSG_extDescription__',
      default_locale : 'en'
    } : {})
} as ManifestV3Export

export const baseBuildOptions: BuildOptions = {
  sourcemap: isDev,
  emptyOutDir: !isDev
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    stripDevIcons(isDev),
    crxI18n({ localize, src: './src/locales' }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  publicDir: resolve(import.meta.dirname, 'public'),
});
