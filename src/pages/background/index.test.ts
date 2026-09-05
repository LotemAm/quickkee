import type { SwContext } from './router';
import { VAULT_STATUS_PORT } from '../../shared/vaultStatus';

const state = vi.hoisted(() => ({ ctx: null as SwContext | null, clearDrafts: vi.fn(), retry: vi.fn() }));
vi.mock('./router', () => ({ CLIPBOARD_CLEAR_ALARM: 'clipboard-clear', depsFor: vi.fn(),
  makeRouter: (ctx: SwContext) => { state.ctx = ctx; return vi.fn(); } }));
vi.mock('./testCommands', () => ({ registerTestCommands: vi.fn() }));
vi.mock('../../background/vault', () => ({ Vault: class {
  lifecycleGeneration = 1; dirty = true; open = true;
  isOpen() { return this.open; }
  lock() { this.lifecycleGeneration++; this.open = false; this.dirty = false; }
} }));
vi.mock('../../background/autolock', () => ({ AutoLock: class { disarm = vi.fn(); } }));
vi.mock('../../background/credentialCaptureStore', () => ({ CredentialCaptureStore: class { clearAll = vi.fn(); clearTab = vi.fn(); } }));
vi.mock('../../background/icon', () => ({ updateIconForTab: vi.fn() }));
vi.mock('../../background/sync', () => ({ retryPending: state.retry }));
vi.mock('../../shared/createDraft', () => ({ clearAllDrafts: state.clearDrafts }));
vi.mock('../../background/sources/googleOAuth', () => ({ GOOGLE_HOSTED_CALLBACK_MESSAGE: 'oauth', handleHostedGoogleOAuthMessage: vi.fn() }));

function event() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return { addListener: (fn: (...args: unknown[]) => void) => listeners.add(fn),
    removeListener: (fn: (...args: unknown[]) => void) => listeners.delete(fn),
    fire: (...args: unknown[]) => [...listeners].forEach(fn => fn(...args)) };
}
async function setup() {
  vi.resetModules();
  const runtime = { id: 'own', getURL: (path: string) => `chrome-extension://own/${path}`,
    onConnect: event(), onMessage: event(), onMessageExternal: event(), onSuspend: event(), onStartup: event(), getPlatformInfo: vi.fn() };
  const alarms = { create: vi.fn(), onAlarm: event() };
  vi.stubGlobal('chrome', { runtime, alarms,
    tabs: { onUpdated: event(), onRemoved: event(), query: vi.fn(async () => []) },
    webNavigation: { onBeforeNavigate: event(), onErrorOccurred: event() } });
  await import('./index');
  const port = { name: VAULT_STATUS_PORT, sender: { id: 'own', url: runtime.getURL('src/pages/popup/index.html') },
    postMessage: vi.fn(), disconnect: vi.fn(), onDisconnect: event(), onMessage: event() };
  runtime.onConnect.fire(port);
  return { runtime, alarms, port, ctx: state.ctx! };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('manual and lifecycle lock publish synchronously after clearing vault/source, before draft cleanup', async () => {
  const { ctx, port, runtime } = await setup();
  ctx.setHandle({ name: 'vault.kdbx' } as FileSystemFileHandle);
  ctx.setCurrentSource({ kind: 'local', handleId: 'db' });
  state.clearDrafts.mockImplementation(() => {
    expect(ctx.getHandle()).toBeNull(); expect(ctx.getCurrentSource()).toBeNull();
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'snapshot', snapshot: expect.objectContaining({ locked: true, dirty: false, generation: 2 }) });
    return new Promise(() => {});
  });
  ctx.doLock();
  expect(state.clearDrafts).toHaveBeenCalledOnce();
  state.clearDrafts.mockReset();
  runtime.onStartup.fire();
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'snapshot', snapshot: expect.objectContaining({ locked: true, generation: 3 }) });
});

test('automatic retry completion publishes changed dirty state and unchanged retries stay quiet', async () => {
  const { ctx, port, alarms } = await setup();
  ctx.setCurrentSource({ kind: 'cloud', provider: 'dropbox', fileId: 'file', basedOnRev: 'rev' });
  state.retry.mockImplementation(async () => { ctx.vault.dirty = false; });
  alarms.onAlarm.fire({ name: 'keepalive' });
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'snapshot', snapshot: expect.objectContaining({ locked: false, dirty: false }) });
  alarms.onAlarm.fire({ name: 'keepalive' });
  await vi.waitFor(() => expect(state.retry).toHaveBeenCalledTimes(2));
  expect(port.postMessage).toHaveBeenCalledTimes(2);
});
