import { resolve } from 'path';
import { mergeConfig, defineConfig } from 'vite';
import { crx, ManifestV3Export } from '@crxjs/vite-plugin';
import baseConfig, { baseManifest, baseBuildOptions } from './vite.config.base'

const outDir = resolve(__dirname, 'dist_chrome');

export default mergeConfig(
  baseConfig,
  defineConfig({
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
      })
    ],
    build: {
      ...baseBuildOptions,
      outDir,
      rollupOptions: {
        // Offscreen documents are created at runtime via chrome.offscreen.createDocument
        // and are not referenced by manifest.json, so @crxjs won't discover this HTML page
        // on its own; it must be added as an explicit Rollup input.
        input: {
          offscreen: resolve(__dirname, 'src/pages/offscreen/index.html'),
        },
      },
    },
  })
)