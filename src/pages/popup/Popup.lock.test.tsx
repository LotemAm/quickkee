import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Request } from '../../shared/messages';
import type { EntryView, TreeNode } from '../../shared/entry';
import type { ScannedPageTotp } from './scanVisibleTabForTotp';

const mocks = vi.hoisted(() => ({ send: vi.fn(), scan: vi.fn(), writeDraft: vi.fn(), clearDraft: vi.fn(), copy: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/UnlockScreen', () => ({ UnlockScreen: () => <button>Unlock</button> }));
vi.mock('../../shared/settings', () => ({ loadSettings: async () => ({ theme: 'system', clipboardClearSeconds: 30,
  pwgen: { length: 20, lower: true, upper: true, digits: true, symbols: true } }) }));
vi.mock('../../shared/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../../shared/createDraft', () => ({ loadDraft: async () => null, saveDraft: mocks.writeDraft, clearDraft: mocks.clearDraft }));
vi.mock('./scanVisibleTabForTotp', () => ({ scanVisibleTabForTotp: mocks.scan,
  isScannablePageUrl: (url: string) => url?.startsWith('https:'), UNSUPPORTED_PAGE_MESSAGE: 'unsupported' }));
vi.mock('./ScannedTotpDialog', () => ({ ScannedTotpDialog: ({ config, onConfirm }: {
  config: { secret: string }; onConfirm: (destination: { type: 'existing'; entryId: string }) => Promise<string | null>;
}) => <div><input aria-label="Scanned secret" value={config.secret} readOnly />
  <button onClick={() => void onConfirm({ type: 'existing', entryId: 'entry' })}>Confirm scanned</button></div> }));
vi.mock('../../shared/useClipboardTimer', () => ({ useClipboardTimer: () => ({ copy: mocks.copy, state: null }) }));
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
const tree: TreeNode = { groupId: 'root', name: 'Private group', children: [], entries: [{ id: entry.id, title: entry.title, username: entry.username, url: entry.url,
  expired: entry.expired, isCard: entry.isCard, hasTotp: entry.hasTotp, totpPeriod: entry.totpPeriod, hasAttachments: false }] };
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
  mocks.copy.mockReset();
  mocks.send.mockReset().mockImplementation(async (request: Request) => respond(request));
  mocks.scan.mockReset().mockResolvedValue(scanned);
  mocks.writeDraft.mockReset().mockResolvedValue(undefined);
  mocks.clearDraft.mockReset().mockResolvedValue(undefined);
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

test.each(['lock', 'disconnect', 'replacement'])('%s invalidates a pending search password copy and drops details', async reason => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (request: Request) => request.type === 'getEntry' ? late.promise : respond(request));
  render(<Popup />); transition(false);
  await screen.findByText('Private login');
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'private' } });
  expect(mocks.send.mock.calls.filter(([request]) => request.type === 'getEntry')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
  expect(mocks.send.mock.calls.filter(([request]) => request.type === 'getEntry')).toHaveLength(1);
  if (reason === 'disconnect') act(() => onDisconnect.fire());
  else transition(reason === 'lock', 2);
  await act(async () => { late.resolve({ ok: true, entry: { ...entry, password: 'obsolete',
    fields: [{ key: 'STALE FIELD', value: 'stale', protected: true }] } }); });
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(screen.queryByText('STALE FIELD')).not.toBeInTheDocument();
  expect(screen.queryByText('Loading entry details…')).not.toBeInTheDocument();
  if (reason === 'disconnect') {
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeVisible();
    return;
  }
  if (reason === 'lock') transition(false, 3);
  await screen.findByText('Private login');
  expect(screen.getByPlaceholderText('Search…')).toHaveValue('');
  mocks.send.mockImplementation(async (request: Request) => respond(request));
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'private' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(entry.password, 'Password');
  expect(mocks.send.mock.calls.filter(([request]) => request.type === 'getEntry')).toHaveLength(2);
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


test.each([true, false])('both creation render sites carry the exact session identity (existing entries: %s)', async hasEntries => {
  mocks.send.mockImplementation(async (request: Request) => {
    if (request.type === 'getEntriesForUrl') return { ok: true, entries: hasEntries ? [entry] : [] };
    if (request.type === 'createEntry') return { ok: false, error: 'intentional' };
    return respond(request);
  });
  render(<Popup />); transition(false, 7);
  if (hasEntries) fireEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
  await waitFor(() => expect(screen.getByPlaceholderText('Password')).toHaveValue('generated'));
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Session-bound draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await waitFor(() => expect(mocks.writeDraft).toHaveBeenCalledWith(expect.objectContaining({
    submission: { status: 'creating', sessionKey: 'worker:7:1' },
  }), expect.any(Function)));
});

test.each(['lock', 'disconnect', 'replacement'])('%s while creating cancels persistence and parent reload', async reason => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (r: Request) => r.type === 'createEntry' ? late.promise : respond(r));
  render(<Popup />); transition(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
  await waitFor(() => expect(screen.getByPlaceholderText('Password')).toHaveValue('generated'));
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Private draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create & Fill' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'createEntry' })));
  if (reason === 'disconnect') act(() => onDisconnect.fire());
  else transition(reason === 'lock', 2);
  await act(async () => { await Promise.resolve(); });
  const before = [mocks.send.mock.calls.length, mocks.writeDraft.mock.calls.length, mocks.clearDraft.mock.calls.length];
  await act(async () => { late.resolve({ ok: true, entryId: 'new' }); });
  expect([mocks.send.mock.calls.length, mocks.writeDraft.mock.calls.length, mocks.clearDraft.mock.calls.length]).toEqual(before);
  expect(mocks.send).not.toHaveBeenCalledWith({ type: 'save' });
  expect(mocks.send.mock.calls.some(([r]) => r.type === 'fillRequest')).toBe(false);
});

test('mutation and save metadata refreshes keep the implicit creation form mounted until its save completes', async () => {
  const save = deferred<unknown>();
  let created = false;
  mocks.send.mockImplementation(async (request: Request) => {
    if (request.type === 'getEntriesForUrl') return { ok: true, entries: created ? [entry] : [] };
    if (request.type === 'createEntry') { created = true; return { ok: true, entryId: entry.id }; }
    if (request.type === 'save') return save.promise;
    return respond(request);
  });
  render(<Popup />); transition(false);
  await waitFor(() => expect(screen.getByPlaceholderText('Password')).toHaveValue('generated'));
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Creation must finish' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ type: 'save' }));
  for (const [dirty, sequence] of [[true, 2], [false, 3]] as const) {
    await act(async () => onMessage.fire({ type: 'snapshot', snapshot: {
      workerIdentity: 'worker', generation: 1, sequence, locked: false, dirty,
    } }));
    expect(screen.getByPlaceholderText('Title')).toHaveValue('Creation must finish');
    expect(screen.getByPlaceholderText('Password')).toHaveValue('generated');
    expect(mocks.send.mock.calls.filter(([r]) => r.type === 'getEntriesForUrl')).toHaveLength(1);
    expect(mocks.clearDraft).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls.filter(([r]) => r.type === 'getTree')).toHaveLength(dirty ? 1 : 2);
  }
  await act(async () => { save.resolve({ ok: true }); });
  await screen.findByText('Private login');
  expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls.filter(([r]) => r.type === 'createEntry')).toHaveLength(1);
  expect(mocks.send.mock.calls.filter(([r]) => r.type === 'save')).toHaveLength(1);
});
