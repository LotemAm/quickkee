import type { SwContext } from './router';
import type { FakeCloudProvider } from '../../background/sources/fakeCloudProvider';
import { __makeFake, __setProviderOverride } from './cloudRouting';

interface TestCommandMessage {
  __qk?: string;
  cmd?: string;
  tabId?: number;
  url?: string;
  hours?: number;
  provider?: 'dropbox' | 'gdrive';
  b64?: string;
  fileId?: string;
  name?: string;
  username?: string;
  password?: string;
}

/**
 * The E2E test-command listener, gated at the call site in index.ts by a statically
 * analyzable `import.meta.env.VITE_QK_TEST === '1'` check so this module (and its
 * strings like `cloudInstall`) are dead-code-eliminated from production builds.
 */
export function registerTestCommands(ctx: SwContext & { warnedTabs: Set<number> }) {
  chrome.runtime.onMessage.addListener((req: TestCommandMessage, _s, send) => {
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
          send({ count: ctx.vault.isOpen() ? ctx.vault.countForUrl(req.url ?? '') : 0, cert: ctx.warnedTabs.has(req.tabId ?? -1) });
          break;
        case 'lock': ctx.doLock(); send({ ok: true }); break;
        case 'armShort': ctx.autolock.arm(req.hours ?? 0); send({ ok: true }); break;
        case 'tabId': {
          const tabs = await chrome.tabs.query({});
          send({ id: tabs.find(t => t.url?.startsWith(req.url ?? ''))?.id });
          break;
        }
        case 'warned': send({ tabs: Array.from(ctx.warnedTabs) }); break;
        case 'credentialPrepare': {
          const entry = ctx.vault.entriesForUrl(req.url ?? '')[0];
          if (!entry) { send({ ok: false }); break; }
          ctx.vault.updateEntry(entry.id, { Notes: 'keep-note', CustomField: 'keep-custom' });
          ctx.vault.setTotpConfig(entry.id, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
          send({ ok: true });
          break;
        }
        case 'credentialDuplicate': {
          const source = ctx.vault.entriesForUrl(req.url ?? '')[0];
          if (!source) { send({ ok: false }); break; }
          ctx.vault.createEntry(ctx.vault.getTree().groupId, {
            Title: 'Duplicate account', UserName: req.username ?? source.username,
            Password: req.password ?? 'duplicate-pass', URL: source.url,
          });
          send({ ok: true });
          break;
        }
        case 'credentialPending': {
          send({ prompt: req.tabId == null || !req.url ? null : await ctx.credentialCaptures.pendingForPage(req.tabId, req.url) });
          break;
        }
        case 'cloudInstall': {
          // Install a fake provider holding the given base64 .kdbx as remote rev "r1".
          const fake = __makeFake(req.provider!);
          const bin = atob(req.b64 ?? ''); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          fake.setFile(req.fileId ?? '', req.name ?? '', bytes.buffer, 'r1');
          __setProviderOverride(fake);
          (globalThis as unknown as { __qkFake: FakeCloudProvider }).__qkFake = fake;
          send({ ok: true });
          break;
        }
        case 'cloudSetRemote': {
          // Replace remote bytes + bump rev to simulate another device's push.
          const fake = (globalThis as unknown as { __qkFake: FakeCloudProvider }).__qkFake;
          const bin = atob(req.b64 ?? ''); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          fake.setFile(req.fileId ?? '', req.name ?? '', bytes.buffer, 'r2');
          send({ ok: true });
          break;
        }
        case 'cloudUploads': {
          const fake = (globalThis as unknown as { __qkFake: FakeCloudProvider }).__qkFake;
          send({ count: fake?.uploads.length ?? 0 });
          break;
        }
        default: send({});
      }
    })();
    return true;
  });
}
