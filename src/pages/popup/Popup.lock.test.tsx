import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Request } from '../../shared/messages';
import type { EntryView, TreeNode } from '../../shared/entry';
import type { ScannedPageTotp } from './scanVisibleTabForTotp';

const mocks = vi.hoisted(() => ({ send: vi.fn(), scan: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/UnlockScreen', () => ({ UnlockScreen: () => <button>Unlock</button> }));
vi.mock('../../shared/settings', () => ({ loadSettings: async () => ({ theme: 'system', clipboardClearSeconds: 30,
  pwgen: { length: 20, lower: true, upper: true, digits: true, symbols: true } }) }));
vi.mock('../../shared/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../../shared/createDraft', () => ({ loadDraft: async () => null, saveDraft: vi.fn(), clearDraft: vi.fn() }));
vi.mock('./scanVisibleTabForTotp', () => ({ scanVisibleTabForTotp: mocks.scan,
  isScannablePageUrl: (url: string) => url?.startsWith('https:'), UNSUPPORTED_PAGE_MESSAGE: 'unsupported' }));
vi.mock('./ScannedTotpDialog', () => ({ ScannedTotpDialog: ({ config, onConfirm }: {
  config: { secret: string }; onConfirm: (destination: { type: 'existing'; entryId: string }) => Promise<string | null>;
}) => <div><input aria-label="Scanned secret" value={config.secret} readOnly />
  <button onClick={() => void onConfirm({ type: 'existing', entryId: 'entry' })}>Confirm scanned</button></div> }));
import { Popup } from './Popup';

function event() {
  const listeners = new Set<(message?: unknown) => void>();
  return { addListener: (fn: (message?: unknown) => void) => listeners.add(fn),
    removeListener: (fn: (message?: unknown) => void) => listeners.delete(fn),
    fire: (message?: unknown) => [...listeners].forEach(fn => fn(message)) };
}
let onMessage: ReturnType<typeof event>;
let onDisconnect: ReturnType<typeof event>;
const entry: EntryView = { id: 'entry', title: 'Private login', username: 'alice', password: 'private-password',
  url: 'https://example.test', fields: [], expired: false, created: null, expires: null, isCard: false,
  hasTotp: true, totpPeriod: 30, attachments: [] };
const tree: TreeNode = { groupId: 'root', name: 'Private group', children: [], entries: [{ ...entry, hasAttachments: false }] };
const scanned: ScannedPageTotp = { tabId: 1, pageUrl: entry.url, config: {
  secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30,
} };
function transition(locked: boolean, generation = 1, sequence = generation) {
  act(() => onMessage.fire({ type: 'snapshot', snapshot: { workerIdentity: 'worker', generation, sequence, locked, dirty: false } }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function respond(request: Request) {
  if (request.type === 'getTree') return { ok: true, tree };
  if (request.type === 'getEntriesForUrl') return { ok: true, entries: [entry] };
  if (request.type === 'getEntry') return { ok: true, entry };
  if (request.type === 'getTotpCode') return { ok: true, code: '123456', period: 30, expiresAt: Date.now() + 30_000 };
  if (request.type === 'generatePassword') return { ok: true, password: 'generated' };
  return { ok: true };
}
beforeEach(() => {
  onMessage = event(); onDisconnect = event();
  mocks.send.mockReset().mockImplementation(async (request: Request) => respond(request));
  mocks.scan.mockReset().mockResolvedValue(scanned);
  vi.stubGlobal('chrome', { runtime: { id: 'own', getURL: (path: string) => path,
    connect: () => ({ onMessage, onDisconnect, postMessage: vi.fn(), disconnect: vi.fn() }) },
  tabs: { query: async () => [{ id: 1, url: entry.url }], onActivated: event(), onUpdated: event() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test.each(['lock', 'disconnect'])('%s unmounts visible TOTP, entries and search state', async reason => {
  render(<Popup />); transition(false);
  await screen.findByText('Private login');
  fireEvent.click(screen.getByRole('button', { name: 'Show authenticator code' }));
  await screen.findByText('123456');
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'private' } });
  if (reason === 'lock') transition(true, 2);
  else act(() => onDisconnect.fire());
  expect(screen.getByRole('button', { name: 'Unlock' })).toBeVisible();
  expect(screen.queryByText('123456')).not.toBeInTheDocument();
  expect(screen.queryByText('Private login')).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText('Search…')).not.toBeInTheDocument();
});

test('a late search result cannot populate a replacement session', async () => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (request: Request) => request.type === 'getEntry' ? late.promise : respond(request));
  render(<Popup />); transition(false);
  await screen.findByText('Private login');
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'private' } });
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ type: 'getEntry', entryId: 'entry' }));
  transition(true, 2); transition(false, 3);
  await act(async () => { late.resolve({ ok: true, entry: { ...entry, title: 'STALE SECRET' } }); });
  expect(screen.getByPlaceholderText('Search…')).toHaveValue('');
  expect(screen.queryByText('STALE SECRET')).not.toBeInTheDocument();
});

test('a late scan does not request entries/tree or remount its secret dialog', async () => {
  const late = deferred<ScannedPageTotp>(); mocks.scan.mockReturnValue(late.promise);
  render(<Popup />); transition(false);
  await screen.findByText('Private login');
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan page QR' }));
  const before = mocks.send.mock.calls.length;
  transition(true, 2);
  await act(async () => { late.resolve(scanned); });
  expect(mocks.send.mock.calls).toHaveLength(before);
  expect(screen.queryByLabelText('Scanned secret')).not.toBeInTheDocument();
});

test('lock during scanned-TOTP mutation cancels the helper save and parent refresh/reload', async () => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (request: Request) => request.type === 'updateEntry' ? late.promise : respond(request));
  render(<Popup />); transition(false);
  await screen.findByText('Private login');
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan page QR' }));
  await screen.findByLabelText('Scanned secret');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm scanned' }));
  await waitFor(() => expect(mocks.send.mock.calls.some(([request]) => request.type === 'updateEntry')).toBe(true));
  transition(true, 2);
  const before = mocks.send.mock.calls.length;
  await act(async () => { late.resolve({ ok: true }); });
  expect(mocks.send.mock.calls).toHaveLength(before);
  expect(mocks.send).not.toHaveBeenCalledWith({ type: 'save' });
  expect(screen.getByRole('button', { name: 'Unlock' })).toBeVisible();
});
