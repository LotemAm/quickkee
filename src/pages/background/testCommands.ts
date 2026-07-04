import type { SwContext } from './router';

/**
 * The E2E test-command listener, gated at the call site in index.ts by a statically
 * analyzable `import.meta.env.VITE_QK_TEST === '1'` check so this module (and its
 * strings like `cloudInstall`) are dead-code-eliminated from production builds.
 */
export function registerTestCommands(ctx: SwContext & { warnedTabs: Set<number> }) {
  chrome.runtime.onMessage.addListener((req: any, _s, send) => {
    if (!req || req.__qk !== 'test') return false;
    (async () => {
      switch (req.cmd) {
        case 'badge': {
          const text = await chrome.action.getBadgeText({ tabId: req.tabId });
          const color = await chrome.action.getBadgeBackgroundColor({ tabId: req.tabId });
          send({ text, color });
          break;
        }
        case 'match':
          send({ count: ctx.vault.isOpen() ? ctx.vault.countForUrl(req.url) : 0, cert: ctx.warnedTabs.has(req.tabId) });
          break;
        case 'lock': ctx.doLock(); send({ ok: true }); break;
        case 'armShort': ctx.autolock.arm(req.hours); send({ ok: true }); break;
        case 'tabId': {
          const tabs = await chrome.tabs.query({});
          send({ id: tabs.find(t => t.url?.startsWith(req.url))?.id });
          break;
        }
        case 'warned': send({ tabs: Array.from(ctx.warnedTabs) }); break;
        case 'cloudInstall': {
          // Install a fake provider holding the given base64 .kdbx as remote rev "r1".
          const fake = (await import('./cloudRouting')).__makeFake(req.provider);
          const bin = atob(req.b64); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          fake.setFile(req.fileId, req.name, bytes.buffer, 'r1');
          (await import('./cloudRouting')).__setProviderOverride(fake);
          (globalThis as any).__qkFake = fake;
          send({ ok: true });
          break;
        }
        case 'cloudSetRemote': {
          // Replace remote bytes + bump rev to simulate another device's push.
          const fake = (globalThis as any).__qkFake as import('../../background/sources/fakeCloudProvider').FakeCloudProvider;
          const bin = atob(req.b64); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          fake.setFile(req.fileId, req.name, bytes.buffer, 'r2');
          send({ ok: true });
          break;
        }
        case 'cloudUploads': {
          const fake = (globalThis as any).__qkFake as import('../../background/sources/fakeCloudProvider').FakeCloudProvider;
          send({ count: fake?.uploads.length ?? 0 });
          break;
        }
        default: send({});
      }
    })();
    return true;
  });
}
