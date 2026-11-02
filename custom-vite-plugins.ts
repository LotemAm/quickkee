import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, PluginOption } from 'vite';

// Check the resolved environment so .env files and CI overrides follow Vite's
// normal precedence. Test-mode builds intentionally use fake cloud providers.
export function requireOAuthClients(nativeGoogleClientId: string | undefined): Plugin {
  return {
    name: 'require-oauth-clients',
    configResolved(config) {
      if (config.command !== 'build' || config.mode !== 'production') return;

      const googleClientPattern = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
      const clients = [
        ['VITE_DROPBOX_CLIENT_ID', config.env.VITE_DROPBOX_CLIENT_ID, /^[a-z0-9]+$/i],
        ['VITE_GDRIVE_WEB_CLIENT_ID', config.env.VITE_GDRIVE_WEB_CLIENT_ID, googleClientPattern],
        ['manifest.oauth2.client_id', nativeGoogleClientId, googleClientPattern],
      ] as const;
      const invalid = clients
        .filter(([, value, pattern]) => typeof value !== 'string' || !pattern.test(value))
        .map(([name]) => name);
      if (invalid.length) {
        throw new Error(`Production build requires configured OAuth client IDs: ${invalid.join(', ')}. See .env.example and README.md.`);
      }
    },
  };
}

// plugin to remove dev icons from prod build
export function stripDevIcons (isDev: boolean) {
  if (isDev) return null

  return {
    name: 'strip-dev-icons',
    resolveId (source: string) {
      return source === 'virtual-module' ? source : null
    },
    renderStart (outputOptions: { dir?: string | null }) {
      const outDir = outputOptions.dir
      if (!outDir) return
      fs.rm(resolve(outDir, 'dev-icon-32.png'), () => console.log(`Deleted dev-icon-32.png from prod build`))
      fs.rm(resolve(outDir, 'dev-icon-128.png'), () => console.log(`Deleted dev-icon-128.png from prod build`))
    }
  }
}

// plugin to support i18n 
export function crxI18n (options: { localize: boolean, src: string }): PluginOption {
  if (!options.localize) return null

  const getJsonFiles = (dir: string): Array<string> => {
    const files = fs.readdirSync(dir, {recursive: true}) as string[]
    return files.filter(file => !!file && file.endsWith('.json'))
  }
  const entry = resolve(import.meta.dirname, options.src)
  const localeFiles = getJsonFiles(entry)
  const files = localeFiles.map(file => {
    return {
      id: '',
      fileName: file,
      source: fs.readFileSync(resolve(entry, file))
    }
  })
  return {
    name: 'crx-i18n',
    enforce: 'pre',
    buildStart: {
      order: 'post',
      handler() {
        files.forEach((file) => {
            const refId = this.emitFile({
              type: 'asset',
              source: file.source,
              fileName: '_locales/'+file.fileName
            })
            file.id = refId
        })
      }
    }
  }
}
