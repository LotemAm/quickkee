import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Request } from '../../shared/messages';
import type { EntryView, TreeNode } from '../../shared/entry';
import type { TotpImportAssignment, TotpImportResult } from '../../shared/totpImport';

const mocks = vi.hoisted(() => ({ send: vi.fn(), decode: vi.fn(), parse: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/UnlockScreen', () => ({ UnlockScreen: () => <button>Unlock</button> }));
vi.mock('../../shared/settings', () => ({ loadSettings: async () => ({ theme: 'system', clipboardClearSeconds: 30,
  pwgen: { length: 20, lower: true, upper: true, digits: true, symbols: true } }) }));
vi.mock('../../shared/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../../shared/openEntry', () => ({ consumeOpenEntry: async () => null, watchOpenEntry: () => () => {} }));
vi.mock('../../shared/decodeQrImage', () => ({ decodeQrImage: mocks.decode, decodeQrDataUrl: vi.fn() }));
vi.mock('../../background/totpImport', () => ({ googleAuthenticatorImporter: { parse: mocks.parse } }));
vi.mock('./TotpImportDialog', () => ({ TotpImportDialog: ({ result, onConfirm }: {
  result: TotpImportResult; onConfirm: (assignments: TotpImportAssignment[]) => void;
}) => <div><input aria-label="Imported secret" value={result.keys[0].config.secret} readOnly />
  <button onClick={() => onConfirm([])}>Confirm import</button></div> }));
import { Panel } from './Panel';

function event() {
  const listeners = new Set<(message?: unknown) => void>();
  return { addListener: (fn: (message?: unknown) => void) => listeners.add(fn),
    removeListener: (fn: (message?: unknown) => void) => listeners.delete(fn),
    fire: (message?: unknown) => [...listeners].forEach(fn => fn(message)) };
}
let onMessage: ReturnType<typeof event>;
let onDisconnect: ReturnType<typeof event>;
const config = { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1' as const, digits: 6, period: 30 };
const entry: EntryView = { id: 'entry', title: 'Private login', username: 'alice', password: 'private-password',
  url: 'https://example.test', fields: [], expired: false, created: null, expires: null, isCard: false,
  hasTotp: true, totpPeriod: 30, attachments: [] };
const tree: TreeNode = { groupId: 'root', name: 'Private group', children: [], entries: [{ ...entry, hasAttachments: false }] };
function transition(locked: boolean, generation = 1) {
  act(() => onMessage.fire({ type: 'snapshot', snapshot: { workerIdentity: 'worker', generation, sequence: generation, locked, dirty: false } }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function respond(request: Request) {
  if (request.type === 'getTree') return { ok: true, tree };
  if (request.type === 'getEntry') return { ok: true, entry };
  if (request.type === 'getTotpConfig') return { ok: true, config };
  if (request.type === 'getEntryNotes') return { ok: true, notes: 'Private notes\r\nsecond line' };
  if (request.type === 'previewTotp') return { ok: true, code: '123456', period: 30, expiresAt: Date.now() + 30_000 };
  return { ok: true };
}
beforeEach(() => {
  onMessage = event(); onDisconnect = event();
  mocks.send.mockReset().mockImplementation(async (request: Request) => respond(request));
  mocks.decode.mockReset().mockResolvedValue('qr');
  mocks.parse.mockReset().mockReturnValue({ provider: 'google', warnings: [], keys: [{ id: 'key', issuer: 'Private', account: 'alice', config }] });
  vi.stubGlobal('chrome', { runtime: { id: 'own', getURL: (path: string) => path,
    connect: () => ({ onMessage, onDisconnect, postMessage: vi.fn(), disconnect: vi.fn() }) } });
});
afterEach(() => vi.unstubAllGlobals());

test.each(['lock', 'disconnect'])('%s removes revealed password, TOTP and editor state', async reason => {
  render(<Panel />); transition(false);
  fireEvent.click(await screen.findByRole('button', { name: /Private login/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show Password' }));
  expect(screen.getByDisplayValue('private-password')).toHaveAttribute('type', 'text');
  await screen.findByText('123456');
  fireEvent.click(screen.getByRole('button', { name: 'TOTP settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show TOTP secret' }));
  fireEvent.click(screen.getByText('More'));
  expect(screen.getByLabelText('Notes', { exact: true })).toHaveValue('Private notes\nsecond line');
  fireEvent.change(screen.getByLabelText('Notes', { exact: true }), { target: { value: 'Private unsaved Notes' } });
  if (reason === 'lock') transition(true, 2); else act(() => onDisconnect.fire());
  expect(screen.getByRole('button', { name: 'Unlock' })).toBeVisible();
  expect(screen.queryByDisplayValue('private-password')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('TOTP setup key or URI')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Notes', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Private unsaved Notes')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
  if (reason === 'lock') {
    transition(false, 3);
    await screen.findByRole('button', { name: /Private login/ });
    expect(screen.queryByDisplayValue('private-password')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notes', { exact: true })).not.toBeInTheDocument();
  }
  expect(mocks.send.mock.calls.some(([request]) => ['updateEntry', 'createEntry', 'save'].includes(request.type))).toBe(false);
});

test.each([
  { reason: 'lock', phase: 'load' }, { reason: 'disconnect', phase: 'load' },
  { reason: 'lock', phase: 'apply' }, { reason: 'disconnect', phase: 'apply' },
])('$reason during Notes $phase discards late replies and cannot trigger follow-up writes', async ({ reason, phase }) => {
  const late = deferred<unknown>();
  const type = phase === 'load' ? 'getEntryNotes' : 'updateEntry';
  mocks.send.mockImplementation(async (request: Request) => request.type === type ? late.promise : respond(request));
  render(<Panel />); transition(false);
  fireEvent.click(await screen.findByRole('button', { name: /Private login/ }));
  if (phase === 'apply') {
    const notes = await screen.findByLabelText('Notes', { exact: true });
    fireEvent.click(screen.getByText('More'));
    fireEvent.change(notes, { target: { value: 'Private draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  }
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ type, entryId: 'entry' })));
  const before = mocks.send.mock.calls.length;
  if (reason === 'lock') transition(true, 2); else act(() => onDisconnect.fire());
  await act(async () => { late.resolve(phase === 'load' ? { ok: true, notes: 'Late secret\r\nnotes' } : { ok: true }); });
  expect(screen.getByRole('button', { name: 'Unlock' })).toBeVisible();
  expect(screen.queryByLabelText('Notes', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Late secret\nnotes')).not.toBeInTheDocument();
  expect(mocks.send.mock.calls).toHaveLength(before);
  expect(mocks.send.mock.calls.filter(([request]) => request.type === 'updateEntry')).toHaveLength(phase === 'apply' ? 1 : 0);
});

test('a delayed tree cannot populate the replacement session or select an old entry', async () => {
  const late = deferred<unknown>();
  mocks.send.mockImplementationOnce(() => late.promise);
  render(<Panel />); transition(false);
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ type: 'getTree' }));
  transition(true, 2); transition(false, 3);
  await screen.findByRole('button', { name: /Private login/ });
  await act(async () => { late.resolve({ ok: true, tree: { ...tree, name: 'STALE SECRET' } }); });
  expect(screen.queryByText('STALE SECRET')).not.toBeInTheDocument();
});

test('a late QR read cannot parse secrets, read the next file, or restore an import dialog', async () => {
  const late = deferred<string>(); mocks.decode.mockReturnValue(late.promise);
  render(<Panel />); transition(false);
  await screen.findByRole('button', { name: /Private login/ });
  fireEvent.change(screen.getByLabelText('Google Authenticator QR images'), {
    target: { files: [new File(['x'], 'one.png'), new File(['y'], 'two.png')] },
  });
  transition(true, 2);
  await act(async () => { late.resolve('secret qr data'); });
  expect(mocks.decode).toHaveBeenCalledOnce();
  expect(mocks.parse).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Imported secret')).not.toBeInTheDocument();
});

test('lock during import cancels tree/status follow-ups and removes the secret dialog', async () => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (request: Request) => request.type === 'importTotp' ? late.promise : respond(request));
  render(<Panel />); transition(false);
  await screen.findByRole('button', { name: /Private login/ });
  fireEvent.change(screen.getByLabelText('Google Authenticator QR images'), { target: { files: [new File(['x'], 'one.png')] } });
  await screen.findByLabelText('Imported secret');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  const before = mocks.send.mock.calls.length;
  transition(true, 2);
  await act(async () => { late.resolve({ ok: true }); });
  expect(mocks.send.mock.calls).toHaveLength(before);
  expect(screen.queryByLabelText('Imported secret')).not.toBeInTheDocument();
});
