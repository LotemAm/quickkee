import { StrictMode, useLayoutEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, test, vi } from 'vitest';
import { EntryEditor } from './EntryEditor';

const mocks = vi.hoisted(() => ({
  sendToSW: vi.fn(),
  scanVisibleTabForTotp: vi.fn(),
  copyWithClear: vi.fn(),
  downloadAttachment: vi.fn(),
}));

vi.mock('../../shared/clipboard', () => ({ copyWithClear: mocks.copyWithClear }));
vi.mock('../../shared/attachments', () => ({ downloadAttachment: mocks.downloadAttachment }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.sendToSW }));
vi.mock('../popup/scanVisibleTabForTotp', () => ({ scanVisibleTabForTotp: mocks.scanVisibleTabForTotp }));

const scannedConfig = {
  secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1' as const, digits: 6, period: 30,
  issuer: 'Acme', account: 'alice',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.downloadAttachment.mockResolvedValue(null);
  mocks.scanVisibleTabForTotp.mockResolvedValue({
    tabId: 12, pageUrl: 'https://example.com/login', config: scannedConfig,
  });
  mocks.sendToSW.mockImplementation(async (request: { type: string; entryId?: string }) => {
    if (request.type === 'getEntry' && request.entryId !== 'entry-1') return { ok: true, entry: entry(request.entryId!) };
    if (request.type === 'getEntry') return { ok: true, entry: {
      id: 'entry-1', title: 'Acme', username: 'alice', url: 'https://example.com', password: 'secret',
      fields: [], expired: false, created: null, expires: null, isCard: false,
      hasTotp: false, totpPeriod: null, attachments: [],
    } };
    if (request.type === 'getTotpConfig') return { ok: true, config: null };
    if (request.type === 'previewTotp') return {
      ok: true, code: '123456', period: 30, expiresAt: Date.now() + 30_000,
    };
    return { ok: true };
  });
});

test('scans a page QR into the side-panel editor without saving immediately', async () => {
  render(<EntryEditor entryId="entry-1" groupId="group-1" clearSecs={30}
    groups={[{ groupId: 'group-1', name: 'Sites', depth: 0 }]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={vi.fn()} onDeleted={vi.fn()} />);

  await screen.findByRole('button', { name: 'Apply changes' });
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith({ type: 'getTotpConfig', entryId: 'entry-1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Authenticator code' }));

  const input = screen.getByLabelText('TOTP setup key or URI');
  const scanButton = screen.getByRole('button', { name: 'Scan page QR' });
  expect(input.nextElementSibling).toContainElement(scanButton);
  expect(scanButton).not.toHaveAttribute('title');
  const tooltipId = scanButton.getAttribute('aria-describedby');
  expect(document.getElementById(tooltipId!)).toHaveTextContent('Scan page QR');
  expect(document.getElementById(tooltipId!)).toHaveTextContent('Scan the visible tab locally.');

  fireEvent.click(scanButton);
  expect(await screen.findByText('123456')).toBeVisible();
  expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'updateEntry')).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'TOTP settings' }));
  expect((screen.getByLabelText('TOTP setup key or URI') as HTMLInputElement).value).toContain('otpauth://totp/');
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'updateEntry', entryId: 'entry-1', totp: scannedConfig,
  })));
});

test('changes an existing entry group through the same update request', async () => {
  const onChanged = vi.fn();
  render(<EntryEditor entryId="entry-1" groupId="sites" clearSecs={30}
    groups={[
      { groupId: 'root', name: 'Vault', depth: 0 },
      { groupId: 'sites', name: 'Sites', depth: 1 },
    ]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={onChanged} onDeleted={vi.fn()} />);

  await screen.findByRole('button', { name: 'Apply changes' });
  const groupSelect = screen.getByLabelText('Group');
  expect(groupSelect.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(groupSelect, { target: { value: 'root' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));

  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'updateEntry', entryId: 'entry-1', groupId: 'root',
  })));
  expect(onChanged).toHaveBeenCalledWith('root');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('a held attachment file read sends no attachment or parent callback after session unmount', async () => {
  const fileRead = deferred<ArrayBuffer>();
  const onChanged = vi.fn();
  const view = render(<EntryEditor entryId="entry-1" groupId="group-1" clearSecs={30}
    groups={[{ groupId: 'group-1', name: 'Sites', depth: 0 }]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={onChanged} onDeleted={vi.fn()} />);
  await screen.findByRole('button', { name: 'Apply changes' });
  const file = new File(['private attachment'], 'private.txt');
  Object.defineProperty(file, 'arrayBuffer', { value: () => fileRead.promise });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  view.unmount();
  await act(async () => { fileRead.resolve(new ArrayBuffer(8)); });
  expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'addAttachment')).toBe(false);
  expect(onChanged).not.toHaveBeenCalled();
});

test.each(['createEntry', 'updateEntry'])('%s reply cannot invoke parent callbacks after session unmount', async type => {
  const reply = deferred<unknown>();
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === type ? reply.promise : original(request));
  const onChanged = vi.fn(); const onCreated = vi.fn();
  const view = render(<EntryEditor entryId={type === 'createEntry' ? null : 'entry-1'} groupId="group-1" clearSecs={30}
    groups={[{ groupId: 'group-1', name: 'Sites', depth: 0 }]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={onChanged} onCreated={onCreated} onDeleted={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: type === 'createEntry' ? 'Create' : 'Apply changes' }));
  await waitFor(() => expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === type)).toBe(true));
  view.unmount();
  await act(async () => { reply.resolve({ ok: true, entryId: 'new' }); });
  expect(onChanged).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});

const editorProps = {
  groupId: 'group-1', clearSecs: 30,
  groups: [{ groupId: 'group-1', name: 'Sites', depth: 0 }, { groupId: 'group-2', name: 'Other', depth: 0 }],
  pwgen: { length: 20, lower: true, upper: true, digits: true, symbols: true },
};

function entry(id: string, title = id) {
  return { id, title, username: `${id}-user`, url: '', password: `${id}-password`, fields: [],
    expired: false, created: null, expires: null, isCard: false, hasTotp: false, totpPeriod: null, attachments: [] };
}

function editor(entryId: string | null, callbacks = {}, groupId = 'group-1') {
  return <EntryEditor {...editorProps} entryId={entryId} groupId={groupId}
    onChanged={vi.fn()} onDeleted={vi.fn()} {...callbacks} />;
}

function holdLoads() {
  const loads: { entryId: string; type: string; reply: ReturnType<typeof deferred<unknown>> }[] = [];
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string; entryId: string }) => {
    if (request.type !== 'getEntry' && request.type !== 'getTotpConfig') return original(request);
    const reply = deferred<unknown>();
    loads.push({ ...request, reply });
    return reply.promise;
  });
  return loads;
}

function expectNoEditorActions() {
  expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete entry' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add attachment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Scan page QR' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy Password' })).not.toBeInTheDocument();
}

test.each(['entry first', 'TOTP first'])('selection hides all old fields and waits for a coherent load: %s', async order => {
  const view = render(editor('entry-1'));
  await screen.findByDisplayValue('Acme');
  fireEvent.click(screen.getByRole('button', { name: 'Show Password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'old-custom' } });
  fireEvent.click(screen.getByText('More'));
  const loads = holdLoads();
  view.rerender(editor('B'));
  expect(screen.queryByDisplayValue('Acme')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('old-custom')).not.toBeInTheDocument();
  expectNoEditorActions();
  const first = order === 'entry first' ? 0 : 1;
  const replies = [{ ok: true, entry: entry('B') }, { ok: true, config: scannedConfig }];
  await act(async () => { loads[first].reply.resolve(replies[first]); });
  expectNoEditorActions();
  await act(async () => { loads[1 - first].reply.resolve(replies[1 - first]); });
  expect(screen.getByDisplayValue('B')).toBeInTheDocument();
  expect(screen.getByDisplayValue('B-password')).toHaveAttribute('type', 'password');
  expect(screen.getByText('More').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'updateEntry', entryId: 'B', totp: scannedConfig,
    fields: expect.objectContaining({ Title: 'B', Password: 'B-password' }),
  })));
});

test.each(['B', 'A', null])('late A entry and TOTP loads cannot overwrite a replacement selection %s', async target => {
  const loads = holdLoads();
  const view = render(editor('A'));
  view.rerender(editor('B'));
  if (target !== 'B') view.rerender(editor(target));
  if (target !== null) {
    const current = target === 'B' ? 2 : 4;
    await act(async () => {
      loads[current].reply.resolve({ ok: true, entry: entry(target, 'current') });
      loads[current + 1].reply.resolve({ ok: true, config: null });
    });
  }
  await act(async () => {
    loads[1].reply.resolve({ ok: true, config: scannedConfig });
    loads[0].reply.resolve({ ok: true, entry: entry('A', 'stale') });
    if (target !== 'B') {
      loads[2].reply.resolve({ ok: true, entry: entry('B', 'stale-B') });
      loads[3].reply.resolve({ ok: true, config: scannedConfig });
    }
  });
  expect(screen.queryByDisplayValue('stale')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('stale-B')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Authenticator code' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: target === null ? 'Create' : 'Apply changes' }));
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: target === null ? 'createEntry' : 'updateEntry',
    fields: expect.objectContaining({ Title: target === null ? '' : 'current' }),
    ...(target === null ? {} : { entryId: target, totp: null }),
  })));
});

test.each([
  ['entry failure', { ok: false, error: 'Entry unavailable' }, { ok: true, config: null }],
  ['TOTP failure', { ok: true, entry: entry('A') }, { ok: false, error: 'TOTP unavailable' }],
  ['missing entry', { ok: true, entry: null }, { ok: true, config: null }],
  ['wrong entry', { ok: true, entry: entry('B') }, { ok: true, config: null }],
  ['invalid TOTP config', { ok: true, entry: entry('A') }, { ok: true, config: { ...scannedConfig, secret: '?' } }],
  ['missing entry fields', { ok: true, entry: { id: 'A' } }, { ok: true, config: null }],
  ['missing TOTP config', { ok: true, entry: entry('A') }, { ok: true }],
])('failed coherent load blocks actions and retries both requests: %s', async (_name, entryReply, configReply) => {
  const loads = holdLoads();
  render(editor('A'));
  await act(async () => {
    loads[0].reply.resolve(entryReply);
    loads[1].reply.resolve(configReply);
  });
  expectNoEditorActions();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(loads).toHaveLength(4);
  expectNoEditorActions();
  await act(async () => { loads[3].reply.resolve({ ok: true, config: scannedConfig }); });
  expectNoEditorActions();
  await act(async () => { loads[2].reply.resolve({ ok: true, entry: entry('A') }); });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'updateEntry', entryId: 'A', totp: scannedConfig, fields: expect.objectContaining({ Title: 'A' }),
  })));
});

test('rejected loads can retry while the abandoned companion request is still pending', async () => {
  const loads = holdLoads();
  render(editor('A'));
  await act(async () => { loads[0].reply.reject(new Error('Connection lost')); });
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  expectNoEditorActions();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await act(async () => {
    loads[2].reply.resolve({ ok: true, entry: entry('A') });
    loads[3].reply.resolve({ ok: true, config: null });
    loads[1].reply.resolve({ ok: true, config: scannedConfig });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({ type: 'updateEntry', entryId: 'A', totp: null }));
});

test('StrictMode cleanup never revives abandoned load responses', async () => {
  const loads = holdLoads();
  render(<StrictMode>{editor('A')}</StrictMode>);
  expect(loads).toHaveLength(4);
  await act(async () => {
    loads[2].reply.resolve({ ok: true, entry: entry('A', 'current') });
    loads[3].reply.resolve({ ok: true, config: null });
  });
  await act(async () => {
    loads[0].reply.resolve({ ok: true, entry: entry('A', 'stale') });
    loads[1].reply.resolve({ ok: true, config: scannedConfig });
  });
  expect(screen.getByDisplayValue('current')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('stale')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Authenticator code' })).toBeInTheDocument();
});

test('existing entry group changes retain the draft, but creation group changes reset it', async () => {
  const view = render(editor('entry-1'));
  fireEvent.change(await screen.findByDisplayValue('Acme'), { target: { value: 'draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show Password' }));
  view.rerender(editor('entry-1', {}, 'group-2'));
  expect(screen.getByDisplayValue('draft')).toBeInTheDocument();
  expect(screen.getByDisplayValue('secret')).toHaveAttribute('type', 'text');
  expect(mocks.sendToSW.mock.calls.filter(([request]) => request.type === 'getEntry')).toHaveLength(1);
  view.rerender(editor(null));
  expect(screen.queryByDisplayValue('draft')).not.toBeInTheDocument();
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'new draft' } });
  view.rerender(editor(null, {}, 'group-2'));
  expect(screen.queryByDisplayValue('new draft')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Group')).toHaveValue('group-2');
});

test('password generation preserves edits made while it is pending', async () => {
  const reply = deferred<unknown>();
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === 'generatePassword' ? reply.promise : original(request));
  render(editor('entry-1'));
  await screen.findByDisplayValue('Acme');
  fireEvent.click(screen.getByRole('button', { name: 'Generate password' }));
  fireEvent.change(screen.getByDisplayValue('Acme'), { target: { value: 'edited while generating' } });
  await act(async () => { reply.resolve({ ok: true, password: 'generated' }); });
  expect(screen.getByDisplayValue('generated')).toHaveAttribute('type', 'text');
  expect(screen.getByDisplayValue('edited while generating')).toBeInTheDocument();
});

test.each(['selection', 'unmount'])('late password generation is inert after %s', async replacement => {
  const reply = deferred<unknown>();
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === 'generatePassword' ? reply.promise : original(request));
  const view = render(editor('entry-1'));
  await screen.findByDisplayValue('Acme');
  fireEvent.click(screen.getByRole('button', { name: 'Generate password' }));
  if (replacement === 'unmount') view.unmount();
  else { view.rerender(editor('B')); await screen.findByDisplayValue('B'); }
  await act(async () => { reply.resolve({ ok: true, password: 'stale generated' }); });
  expect(screen.queryByDisplayValue('stale generated')).not.toBeInTheDocument();
  if (replacement === 'selection') {
    expect(screen.getByDisplayValue('B-password')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
      type: 'updateEntry', entryId: 'B', fields: expect.objectContaining({ Title: 'B', Password: 'B-password' }),
    }));
  }
});

test.each(['success', 'failure'])('old QR %s cannot finish or replace a newer selection scan', async outcome => {
  const oldScan = deferred<unknown>();
  const currentScan = deferred<unknown>();
  mocks.scanVisibleTabForTotp.mockReturnValueOnce(oldScan.promise).mockReturnValueOnce(currentScan.promise);
  const view = render(editor('entry-1'));
  await screen.findByDisplayValue('Acme');
  fireEvent.click(screen.getByRole('button', { name: 'Add Authenticator code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan page QR' }));
  view.rerender(editor('B'));
  await screen.findByDisplayValue('B');
  fireEvent.click(screen.getByRole('button', { name: 'Add Authenticator code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan page QR' }));
  await act(async () => {
    if (outcome === 'success') oldScan.resolve({ config: scannedConfig });
    else oldScan.reject(new Error('Old scan failed'));
  });
  expect(screen.getByRole('button', { name: 'Scanning visible page' })).toBeDisabled();
  expect(screen.queryByText('Old scan failed')).not.toBeInTheDocument();
  expect(screen.getByLabelText('TOTP setup key or URI')).toHaveValue('');
  const currentConfig = { ...scannedConfig, account: 'B' };
  await act(async () => { currentScan.resolve({ config: currentConfig }); });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({ type: 'updateEntry', entryId: 'B', totp: currentConfig }));
});

test('a held file read sends no attachment to any entry after selection changes', async () => {
  const fileRead = deferred<ArrayBuffer>();
  const callbacks = { onChanged: vi.fn() };
  const view = render(editor('entry-1', callbacks));
  await screen.findByDisplayValue('Acme');
  const file = new File(['private'], 'private.txt');
  Object.defineProperty(file, 'arrayBuffer', { value: () => fileRead.promise });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  view.rerender(editor('B', callbacks));
  await screen.findByDisplayValue('B');
  await act(async () => { fileRead.resolve(new ArrayBuffer(8)); });
  expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'addAttachment')).toBe(false);
  expect(callbacks.onChanged).not.toHaveBeenCalled();
});

test.each(['createEntry', 'updateEntry', 'deleteEntry', 'addAttachment', 'removeAttachment'])('%s completion belongs only to its original selection', async type => {
  const reply = deferred<unknown>();
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string; entryId?: string }) => {
    if (request.type === type) return reply.promise;
    if (request.type === 'getEntry' && request.entryId === 'A') return Promise.resolve({ ok: true,
      entry: { ...entry('A'), attachments: [{ name: 'old.txt', size: 8 }] } });
    return original(request);
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const callbacks = { onChanged: vi.fn(), onCreated: vi.fn(), onDeleted: vi.fn() };
  const view = render(editor(type === 'createEntry' ? null : 'A', callbacks));
  await screen.findByRole('button', { name: type === 'createEntry' ? 'Create' : 'Apply changes' });
  if (type === 'addAttachment') {
    const file = new File(['private'], 'private.txt');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  } else {
    if (type === 'removeAttachment') fireEvent.click(screen.getByText('More'));
    const name = { createEntry: 'Create', updateEntry: 'Apply changes', deleteEntry: 'Delete entry', removeAttachment: 'Remove old.txt' }[type];
    fireEvent.click(screen.getByRole('button', { name }));
  }
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({ type })));
  if (type !== 'createEntry') expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({ type, entryId: 'A' }));
  view.rerender(editor('B', callbacks));
  await screen.findByDisplayValue('B');
  await act(async () => { reply.resolve({ ok: true, entryId: 'created' }); });
  expect(callbacks.onChanged).not.toHaveBeenCalled();
  expect(callbacks.onCreated).not.toHaveBeenCalled();
  expect(callbacks.onDeleted).not.toHaveBeenCalled();
  expect(screen.queryByText('private.txt')).not.toBeInTheDocument();
  expect(mocks.sendToSW.mock.calls.filter(([request]) => request.type === type)).toHaveLength(1);
  confirm.mockRestore();
});

test('late attachment download errors do not appear in a replacement editor', async () => {
  const reply = deferred<string | null>();
  mocks.downloadAttachment.mockReturnValueOnce(reply.promise);
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string; entryId?: string }) => {
    if (request.type === 'getEntry' && request.entryId === 'A') return Promise.resolve({ ok: true,
      entry: { ...entry('A'), attachments: [{ name: 'old.txt', size: 8 }] } });
    return original(request);
  });
  const view = render(editor('A'));
  await screen.findByDisplayValue('A');
  fireEvent.click(screen.getByText('More'));
  fireEvent.click(screen.getByRole('button', { name: 'Download old.txt' }));
  expect(mocks.downloadAttachment).toHaveBeenCalledWith('A', 'old.txt');
  view.rerender(editor('B'));
  await screen.findByDisplayValue('B');
  await act(async () => { reply.resolve('Old download failed'); });
  expect(screen.queryByText('Old download failed')).not.toBeInTheDocument();
});

test('selection changes clear clipboard UI and disable old credential keyboard shortcuts during loading', async () => {
  const view = render(editor('entry-1'));
  await screen.findByDisplayValue('Acme');
  fireEvent.click(screen.getByRole('button', { name: 'Copy Password' }));
  expect(mocks.copyWithClear).toHaveBeenLastCalledWith('secret', 30);
  const loads = holdLoads();
  view.rerender(editor('B'));
  expect(screen.queryByText(/Copied/)).not.toBeInTheDocument();
  fireEvent.keyDown(window, { ctrlKey: true, key: 'c' });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'b' });
  expect(mocks.copyWithClear).toHaveBeenCalledTimes(1);
  await act(async () => {
    loads[0].reply.resolve({ ok: true, entry: entry('B') });
    loads[1].reply.resolve({ ok: true, config: null });
  });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'c' });
  expect(mocks.copyWithClear).toHaveBeenLastCalledWith('B-password', 30);
});

test.each(['success', 'failure'])('QR %s after unmount cannot restore preview work or invoke a callback', async outcome => {
  const reply = deferred<unknown>();
  mocks.scanVisibleTabForTotp.mockReturnValueOnce(reply.promise);
  const callbacks = { onChanged: vi.fn() };
  const view = render(editor('entry-1', callbacks));
  await screen.findByDisplayValue('Acme');
  fireEvent.click(screen.getByRole('button', { name: 'Add Authenticator code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan page QR' }));
  const callsBefore = mocks.sendToSW.mock.calls.length;
  view.unmount();
  await act(async () => {
    if (outcome === 'success') reply.resolve({ config: scannedConfig });
    else reply.reject(new Error('Old scan failed'));
  });
  expect(mocks.sendToSW).toHaveBeenCalledTimes(callsBefore);
  expect(callbacks.onChanged).not.toHaveBeenCalled();
  expect(screen.queryByText('Old scan failed')).not.toBeInTheDocument();
});

test('changing creation group resets card fields, expiry, TOTP, custom fields and reveal state', () => {
  const view = render(editor(null));
  fireEvent.click(screen.getByText('More'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as credit card data' }));
  fireEvent.change(screen.getByLabelText('Cardholder Name'), { target: { value: 'Private holder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show Card Number' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show CVV' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Private field' } });
  fireEvent.change(view.container.querySelector('input[type="datetime-local"]')!, { target: { value: '2030-01-02T03:04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Authenticator code' }));
  fireEvent.change(screen.getByLabelText('TOTP setup key or URI'), { target: { value: '?' } });
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  view.rerender(editor(null, {}, 'group-2'));
  expect(screen.queryByLabelText('Cardholder Name')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Private field')).not.toBeInTheDocument();
  expect(view.container.querySelector('input[type="datetime-local"]')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Show Password' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Authenticator code' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  expect(screen.getByText('More').closest('details')).not.toHaveAttribute('open');
});


test('keyboard shortcuts cannot copy the old entry during the replacement commit', async () => {
  function Selection({ entryId }: { entryId: string }) {
    useLayoutEffect(() => {
      if (entryId === 'B') {
        window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'c' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'b' }));
      }
    }, [entryId]);
    return editor(entryId);
  }
  const view = render(<Selection entryId="entry-1" />);
  await screen.findByDisplayValue('Acme');
  holdLoads();
  view.rerender(<Selection entryId="B" />);
  expect(mocks.copyWithClear).not.toHaveBeenCalled();
});
