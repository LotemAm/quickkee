import { resolve } from 'node:path';
import { mergeConfig, defineConfig } from 'vite';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import zip from 'vite-plugin-zip-pack';
import baseConfig, { baseManifest, baseBuildOptions } from './vite.config.base.ts'

const outDir = resolve(import.meta.dirname, 'dist_chrome');
const releaseDir = resolve(import.meta.dirname, 'release');

export default defineConfig(({ mode }) =>
  mergeConfig(baseConfig, {
    plugins: [
      crx({
        manifest: {
          ...baseManifest,
          background: {
            service_worker: 'src/pages/background/index.ts',
            type: 'module'
          },
        } as ManifestV3Export,
        browser: 'chrome',
        contentScripts: {
          injectCss: true,
        }
      }),
      mode === 'production' && zip({
        inDir: outDir,
        outDir: releaseDir,
        outFileName: 'quickkee.zip',
      }),
    ],
    build: {
      ...baseBuildOptions,
      outDir,
      rolldownOptions: {
        // Offscreen documents are created at runtime via chrome.offscreen.createDocument
        // and are not referenced by manifest.json, so @crxjs won't discover this HTML page
        // on its own; it must be added as an explicit Rolldown input.
        input: {
          offscreen: resolve(import.meta.dirname, 'src/pages/offscreen/index.html'),
        },
      },
    },
  })
)
