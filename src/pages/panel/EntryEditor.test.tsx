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
  mocks.scanVisibleTabForTotp.mockReset().mockResolvedValue({
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
    if (request.type === 'getEntryNotes') return { ok: true, notes: '' };
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
    onChanged={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);

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
    onChanged={onChanged} onDeleted={vi.fn()} onClose={vi.fn()} />);

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
    onChanged={onChanged} onDeleted={vi.fn()} onClose={vi.fn()} />);
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
    onChanged={onChanged} onCreated={onCreated} onDeleted={vi.fn()} onClose={vi.fn()} />);
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
    onChanged={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} {...callbacks} />;
}

function replyWithNotes(notes: string) {
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === 'getEntryNotes'
    ? { ok: true, notes } : original(request));
}

function entryMutations() {
  return mocks.sendToSW.mock.calls.map(([request]) => request)
    .filter(request => ['createEntry', 'updateEntry', 'save'].includes(request.type));
}

test('Notes is the first section in collapsed More and applies the exact multiline draft', async () => {
  replyWithNotes('Saved\r\nשלום\rnote');
  const onChanged = vi.fn();
  render(editor('entry-1', { onChanged }));
  const notes = await screen.findByLabelText('Notes', { exact: true });
  expect(notes).toHaveValue('Saved\nשלום\nnote');
  expect(notes.tagName).toBe('TEXTAREA');
  expect(notes.closest('details')).not.toHaveAttribute('open');
  expect(notes.closest('details')!.querySelector('textarea, select')).toBe(notes);
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(notes, { target: { value: '  <b>**literal**</b>\nשלום & 😀\n ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'updateEntry', entryId: 'entry-1', fields: expect.objectContaining({ Notes: '  <b>**literal**</b>\nשלום & 😀\n ' }),
  }));
});

test.each(['untouched', 'undo'])('%s Notes are omitted when changing title, password and group', async action => {
  replyWithNotes(' \tFirst\r\nSecond\rLast ');
  const onChanged = vi.fn();
  render(editor('entry-1', { onChanged }));
  const notes = await screen.findByLabelText('Notes', { exact: true });
  expect(notes).toHaveValue(' \tFirst\nSecond\nLast ');
  fireEvent.click(screen.getByText('More'));
  if (action === 'undo') {
    fireEvent.change(notes, { target: { value: 'temporary' } });
    fireEvent.change(notes, { target: { value: ' \tFirst\nSecond\nLast ' } });
  }
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'group-2' } });
  fireEvent.change(screen.getByDisplayValue('Acme'), { target: { value: 'New title' } });
  fireEvent.change(screen.getByDisplayValue('secret'), { target: { value: 'new password' } });
  fireEvent.click(screen.getByText('More'));
  expect(entryMutations()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith('group-2'));
  expect(entryMutations()).toHaveLength(1);
  expect(entryMutations()[0]).toMatchObject({ type: 'updateEntry', entryId: 'entry-1', groupId: 'group-2',
    fields: { Title: 'New title', Password: 'new password' } });
  expect(entryMutations()[0].fields).not.toHaveProperty('Notes');
  expect(entryMutations()[0].removeKeys).not.toContain('Notes');
});

test('More retains the draft, Copy Notes uses the clipboard timer, and textarea Ctrl+C stays native', async () => {
  render(editor('entry-1'));
  const notes = await screen.findByLabelText('Notes', { exact: true });
  fireEvent.click(screen.getByText('More'));
  expect(screen.getByRole('button', { name: 'Copy Notes' })).toBeDisabled();
  fireEvent.change(notes, { target: { value: '  Current\n\tשלום <b>plain</b> ' } });
  fireEvent.click(screen.getByText('More')); fireEvent.click(screen.getByText('More'));
  expect(screen.getByLabelText('Notes', { exact: true })).toBe(notes);
  fireEvent.click(screen.getByRole('button', { name: 'Copy Notes' }));
  expect(mocks.copyWithClear).toHaveBeenCalledExactlyOnceWith('  Current\n\tשלום <b>plain</b> ', 30);
  expect(screen.getByText('Notes copied')).toBeVisible();
  notes.focus();
  expect(fireEvent.keyDown(notes, { key: 'c', ctrlKey: true })).toBe(true);
  expect(mocks.copyWithClear).toHaveBeenCalledOnce();
  expect(entryMutations()).toEqual([]);
});

test.each(['', '  \n\t ', 'created\nשלום & <text>'])('new entry includes nonempty Notes without reading an entry: %j', async draft => {
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === 'createEntry'
    ? { ok: true, entryId: 'created' } : original(request));
  const onCreated = vi.fn();
  render(editor(null, { onCreated }));
  const notes = screen.getByLabelText('Notes', { exact: true });
  expect(notes).toHaveValue('');
  expect(notes.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(notes, { target: { value: draft } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith('created', 'group-1'));
  expect(mocks.sendToSW.mock.calls.some(([request]) => ['getEntry', 'getEntryNotes'].includes(request.type))).toBe(false);
  expect(entryMutations()).toHaveLength(1);
  expect(entryMutations()[0]).toMatchObject({ type: 'createEntry', groupId: 'group-1' });
  if (draft !== '') expect(entryMutations()[0].fields.Notes).toBe(draft);
  else expect(entryMutations()[0].fields).not.toHaveProperty('Notes');
});

test.each(['', '  \n\t '])('editing Notes to %j writes it once and advances the successful baseline', async draft => {
  replyWithNotes('original');
  const onChanged = vi.fn(); render(editor('entry-1', { onChanged }));
  const notes = await screen.findByLabelText('Notes', { exact: true });
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(notes, { target: { value: draft } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(entryMutations()[0].fields.Notes).toBe(draft);
  expect(entryMutations()[0].removeKeys).not.toContain('Notes');
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  expect(entryMutations()).toHaveLength(2);
  expect(entryMutations()[1].fields).not.toHaveProperty('Notes');
});

test.each([
  { ok: false, error: 'Notes unavailable' }, { ok: true }, { ok: true, notes: null }, { ok: true, notes: 42 }, new Error('Worker disconnected'),
])('failed Notes load blocks the editor and retries coherently: %j', async reply => {
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === 'getEntryNotes'
    ? reply instanceof Error ? Promise.reject(reply) : reply : original(request));
  render(editor('entry-1'));
  await screen.findByRole('alert');
  expectNoEditorActions(); expect(screen.queryByLabelText('Notes', { exact: true })).not.toBeInTheDocument();
  replyWithNotes('Retry\r\nnotes');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByLabelText('Notes', { exact: true })).toHaveValue('Retry\nnotes');
  for (const type of ['getEntry', 'getTotpConfig', 'getEntryNotes']) {
    expect(mocks.sendToSW.mock.calls.filter(([request]) => request.type === type)).toHaveLength(2);
  }
  expect(entryMutations()).toEqual([]);
});

test.each([
  { type: 'updateEntry', throws: false }, { type: 'updateEntry', throws: true },
  { type: 'createEntry', throws: false }, { type: 'createEntry', throws: true },
])('$type failure (throws=$throws) retains Notes and retries without false success', async ({ type, throws }) => {
  replyWithNotes('baseline');
  const original = mocks.sendToSW.getMockImplementation()!;
  let attempts = 0;
  mocks.sendToSW.mockImplementation((request: { type: string }) => {
    if (request.type !== type) return original(request);
    if (++attempts > 1) return { ok: true, entryId: 'created' };
    return throws ? Promise.reject(new Error('connection lost')) : { ok: false, error: 'write failed' };
  });
  const callbacks = { onChanged: vi.fn(), onCreated: vi.fn() };
  render(editor(type === 'createEntry' ? null : 'entry-1', callbacks));
  const notes = await screen.findByLabelText('Notes', { exact: true });
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(notes, { target: { value: 'keep this draft\n ' } });
  const apply = screen.getByRole('button', { name: type === 'createEntry' ? 'Create' : 'Apply changes' });
  fireEvent.click(apply); await screen.findByText(throws ? `Could not ${type === 'createEntry' ? 'create' : 'update'} entry.` : 'write failed');
  expect(notes).toHaveValue('keep this draft\n ');
  expect(callbacks.onChanged).not.toHaveBeenCalled(); expect(callbacks.onCreated).not.toHaveBeenCalled();
  fireEvent.click(apply);
  await waitFor(() => expect(type === 'createEntry' ? callbacks.onCreated : callbacks.onChanged).toHaveBeenCalledOnce());
  expect(entryMutations()).toHaveLength(2);
  for (const request of entryMutations()) expect(request).toMatchObject({ type, fields: { Notes: 'keep this draft\n ' } });
});

test('a successful apply advances only to its submitted Notes while keeping a newer draft', async () => {
  replyWithNotes('baseline');
  const pending = deferred<unknown>(); const original = mocks.sendToSW.getMockImplementation()!;
  let updates = 0;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === 'updateEntry' && ++updates === 1
    ? pending.promise : original(request));
  const onChanged = vi.fn(); render(editor('entry-1', { onChanged }));
  const notes = await screen.findByLabelText('Notes', { exact: true });
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(notes, { target: { value: 'submitted' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  fireEvent.change(notes, { target: { value: 'newer\nlocal draft' } });
  await act(async () => { pending.resolve({ ok: true }); });
  expect(notes).toHaveValue('newer\nlocal draft');
  expect(entryMutations()[0].fields.Notes).toBe('submitted');
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  expect(entryMutations()[1].fields.Notes).toBe('newer\nlocal draft');
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(3));
  expect(entryMutations()).toHaveLength(3);
  expect(entryMutations()[2].fields).not.toHaveProperty('Notes');
});

test('Notes cannot be overwritten or removed through Additional fields', async () => {
  replyWithNotes('baseline');
  render(editor('entry-1')); await screen.findByLabelText('Notes', { exact: true });
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: ' Notes ' } });
  fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: 'wrong place' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(entryMutations()).toHaveLength(1));
  expect(entryMutations()[0].fields).not.toHaveProperty('Notes');
  expect(entryMutations()[0].removeKeys).not.toContain('Notes');
});

test.each(['B', 'A', 'create', 'unmount'])('late Notes responses cannot restore A after switching to %s', async target => {
  const notesLoads: ReturnType<typeof deferred<unknown>>[] = [];
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => {
    if (request.type !== 'getEntryNotes') return original(request);
    const pending = deferred<unknown>(); notesLoads.push(pending); return pending.promise;
  });
  const onChanged = vi.fn(); const view = render(editor('A', { onChanged }));
  await waitFor(() => expect(notesLoads).toHaveLength(1));
  expectNoEditorActions();
  if (target === 'unmount') view.unmount();
  else {
    view.rerender(editor('B', { onChanged }));
    if (target === 'A') view.rerender(editor('A', { onChanged }));
    if (target === 'create') view.rerender(editor(null));
    if (target !== 'create') {
      expectNoEditorActions();
      await act(async () => { notesLoads.at(-1)!.resolve({ ok: true, notes: 'current\r\nline\rend' }); });
      expect(screen.getByLabelText('Notes', { exact: true })).toHaveValue('current\nline\nend');
    }
  }
  await act(async () => {
    notesLoads[0].resolve({ ok: true, notes: 'stale A\r\nsecret' });
    if (target === 'A' || target === 'create') notesLoads[1].resolve({ ok: true, notes: 'stale B' });
  });
  expect(screen.queryByDisplayValue('stale A\nsecret')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('stale B')).not.toBeInTheDocument();
  expect(entryMutations()).toEqual([]); expect(onChanged).not.toHaveBeenCalled();
  if (target === 'create') expect(screen.getByLabelText('Notes', { exact: true })).toHaveValue('');
  else if (target === 'unmount') expect(screen.queryByLabelText('Notes', { exact: true })).not.toBeInTheDocument();
  else {
    fireEvent.change(screen.getByDisplayValue(target), { target: { value: 'unrelated edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(entryMutations()).toHaveLength(1);
    expect(entryMutations()[0]).toMatchObject({ entryId: target, fields: { Title: 'unrelated edit' } });
    expect(entryMutations()[0].fields).not.toHaveProperty('Notes');
  }
});

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
  fireEvent.change(screen.getByLabelText('Notes', { exact: true }), { target: { value: 'Notes draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show Password' }));
  view.rerender(editor('entry-1', {}, 'group-2'));
  expect(screen.getByDisplayValue('draft')).toBeInTheDocument();
  expect(screen.getByLabelText('Notes', { exact: true })).toHaveValue('Notes draft');
  expect(screen.getByDisplayValue('secret')).toHaveAttribute('type', 'text');
  expect(mocks.sendToSW.mock.calls.filter(([request]) => request.type === 'getEntry')).toHaveLength(1);
  view.rerender(editor(null));
  expect(screen.queryByDisplayValue('draft')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Notes', { exact: true })).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Notes', { exact: true }), { target: { value: 'New Notes draft' } });
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'new draft' } });
  view.rerender(editor(null, {}, 'group-2'));
  expect(screen.queryByDisplayValue('new draft')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Notes', { exact: true })).toHaveValue('');
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
  await act(async () => { view.rerender(editor('B')); });
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
  fireEvent.click(screen.getByRole('button', { name: 'Credit card' }));
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

test.each(['selected', 'clear button', 'empty input', 'untouched'] as const)(
  'creation sends the current expiry: %s', async action => {
    const onCreated = vi.fn();
    const original = mocks.sendToSW.getMockImplementation()!;
    mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === 'createEntry'
      ? Promise.resolve({ ok: true, entryId: 'created' }) : original(request));
    const view = render(editor(null, { onCreated }));
    fireEvent.click(screen.getByText('More'));
    const dateInput = view.container.querySelector('input[type="datetime-local"]')!;
    if (action !== 'untouched') fireEvent.change(dateInput, { target: { value: '2030-06-15T12:34' } });
    if (action === 'clear button') fireEvent.click(screen.getByRole('button', { name: 'Clear expiry' }));
    if (action === 'empty input') fireEvent.change(dateInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('created', 'group-1'));
    const creates = mocks.sendToSW.mock.calls.filter(([request]) => request.type === 'createEntry');
    expect(creates).toHaveLength(1);
    expect(creates[0][0]).toMatchObject({
      type: 'createEntry', groupId: 'group-1',
      expires: action === 'selected' ? new Date(2030, 5, 15, 12, 34).getTime() : null,
    });
    expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'updateEntry')).toBe(false);
  },
);

test('creation carries Notes and expiry together with card, custom and TOTP fields', async () => {
  const view = render(editor(null));
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(screen.getByLabelText('Notes', { exact: true }), { target: { value: 'Card notes\nשלום' } });
  fireEvent.click(screen.getByRole('button', { name: 'Credit card' }));
  fireEvent.change(screen.getByLabelText('Cardholder Name'), { target: { value: 'Test Holder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Reference' } });
  fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: 'keep-me' } });
  fireEvent.change(view.container.querySelector('input[type="datetime-local"]')!, { target: { value: '2030-06-15T12:34' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Authenticator code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan page QR' }));
  await screen.findByText('123456');
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'createEntry', expires: new Date(2030, 5, 15, 12, 34).getTime(), totp: scannedConfig,
    fields: expect.objectContaining({ 'QK-IsCard': '1', 'Cardholder Name': 'Test Holder', Reference: 'keep-me', Notes: 'Card notes\nשלום' }),
  }));
});
