import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Request } from '../../shared/messages';
import { DEFAULT_PWGEN } from '../../shared/pwgen';
import { CreateForm } from './CreateForm';
import type { CreateDraft, DraftSubmission } from '../../shared/createDraft';

const mocks = vi.hoisted(() => ({ send: vi.fn(), load: vi.fn(), write: vi.fn(), clear: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/createDraft', () => ({ loadDraft: mocks.load, saveDraft: mocks.write, clearDraft: mocks.clear }));

function requests(type: Request['type']) { return mocks.send.mock.calls.filter(([r]) => r.type === type); }
function respond(request: Request): unknown {
  if (request.type === 'generatePassword') return { ok: true, password: 'generated' };
  if (request.type === 'createEntry') return { ok: true, entryId: 'new' };
  if (request.type === 'getEntry') return { ok: true, entry: { id: request.entryId } };
  return { ok: true };
}
async function setup(draft?: CreateDraft) {
  if (draft) mocks.load.mockResolvedValue(draft);
  const onCreated = vi.fn();
  const view = render(<CreateForm sessionKey="session-a" url="https://example.test" tabId={1} defaultGroupId="root"
    groups={[{ groupId: 'root', name: 'Root', depth: 0 }]} clearSecs={30} pwgen={DEFAULT_PWGEN}
    scanPage={{ disabled: false, scanning: false, description: 'Scan', onClick: vi.fn() }} onCreated={onCreated} />);
  await waitFor(() => expect(screen.getByPlaceholderText('Password')).toHaveValue(draft?.password ?? 'generated'));
  if (!draft) fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Private draft' } });
  return { ...view, onCreated };
}
beforeEach(() => {
  mocks.send.mockReset().mockImplementation(async (r: Request) => respond(r));
  mocks.load.mockReset().mockResolvedValue(null);
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.clear.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { sidePanel: { open: vi.fn().mockResolvedValue(undefined) } });
});

test.each([
  ['create error', 'createEntry', { ok: false, error: 'createFailed' }],
  ['create rejection', 'createEntry', new Error('connection lost')],
  ['missing entry ID', 'createEntry', { ok: true }],
  ['save error', 'save', { ok: false, error: 'saveFailed' }],
  ['save rejection', 'save', new Error('disk full')],
] as const)('%s retains the draft and never reports success or fills', async (_label, type, result) => {
  mocks.send.mockImplementation(async (r: Request) => {
    if (r.type !== type) return respond(r);
    if (result instanceof Error) throw result;
    return result;
  });
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Fill' }));
  await screen.findByRole('alert');
  expect(screen.getByPlaceholderText('Title')).toHaveValue('Private draft');
  expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ title: 'Private draft', password: 'generated' }), expect.any(Function));
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
  expect(requests('fillRequest')).toHaveLength(0);
});

test('retry after a failed save persists the known entry without creating a duplicate', async () => {
  let saves = 0;
  mocks.send.mockImplementation(async (r: Request) => r.type === 'save' && ++saves === 1
    ? { ok: false, error: 'saveFailed' } : respond(r));
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')).toHaveLength(1);
  expect(requests('save')).toHaveLength(2);
  expect(mocks.clear).toHaveBeenCalledTimes(1);
});

test.each(['Create & Save', 'Create & Fill'])('%s completes after successful persistence', async label => {
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')).toHaveLength(1);
  expect(requests('save')).toHaveLength(1);
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(requests('fillRequest')).toHaveLength(label === 'Create & Fill' ? 1 : 0);
});



function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const config = { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 } as const;
function recovery(submission?: DraftSubmission): CreateDraft {
  return { url: 'https://example.test', title: 'Recovered draft', username: 'alice', password: 'recovered',
    groupId: 'root', entryUrl: 'https://example.test/login', opts: DEFAULT_PWGEN, totp: config, savedAt: Date.now(), submission };
}

test('a confirmed create failure leaves editable fields and permits a new attempt', async () => {
  let creates = 0;
  mocks.send.mockImplementation(async (r: Request) => r.type === 'createEntry' && ++creates === 1
    ? { ok: false, error: 'failed' } : respond(r));
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await screen.findByRole('alert');
  expect(screen.getByPlaceholderText('Title')).toBeEnabled();
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Corrected draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')).toHaveLength(2);
  expect(requests('createEntry')[1][0].fields.Title).toBe('Corrected draft');
  expect(requests('save')).toHaveLength(1);
});

test.each([undefined, null, {}, { ok: true }, { ok: true, entryId: '' }, { ok: true, entryId: 1 }, new Error('lost')])(
  'ambiguous create response %j requires review and never offers creation retry', async result => {
    mocks.send.mockImplementation(async (r: Request) => {
      if (r.type !== 'createEntry') return respond(r);
      if (result instanceof Error) throw result;
      return result;
    });
    const { onCreated } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
    await screen.findByText(/Could not confirm whether/);
    await waitFor(() => expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
      submission: { status: 'unknown', sessionKey: 'session-a' }, title: 'Private draft', password: 'generated',
    }), expect.any(Function)));
    expect(screen.getByPlaceholderText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Create &|Retry save/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review in side panel' }));
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 1 });
    expect(requests('createEntry')).toHaveLength(1);
    expect(requests('save')).toHaveLength(0);
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  },
);

test('a failed creating marker write prevents mutation until a recoverable snapshot is stored', async () => {
  mocks.write.mockImplementation(async (d: CreateDraft) => { if (d.submission) throw new Error('storage unavailable'); });
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Fill' }));
  await screen.findByText(/No entry was created/);
  expect(requests('createEntry')).toHaveLength(0);
  expect(requests('save')).toHaveLength(0);
  expect(mocks.clear).not.toHaveBeenCalled();
  mocks.write.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Create & Fill' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')).toHaveLength(1);
});

test.each(['created', 'saved'] as const)('a failed %s marker write retains its known entry for retry', async status => {
  mocks.write.mockImplementation(async (d: CreateDraft) => { if (d.submission?.status === status) throw new Error('storage unavailable'); });
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await screen.findByRole('alert');
  expect(screen.getByPlaceholderText('Title')).toBeDisabled();
  expect(requests('save')).toHaveLength(status === 'created' ? 0 : 1);
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
  mocks.write.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: status === 'created' ? 'Retry save' : 'Retry completion' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')).toHaveLength(1);
  expect(requests('save')).toHaveLength(1);
});

test.each(['Create & Save', 'Create & Fill'])('%s retries failed draft cleanup without repeating creation or save', async label => {
  mocks.clear.mockRejectedValueOnce(new Error('storage unavailable'));
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByText(/clearing its recovery draft failed/);
  expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
    submission: { status: 'saved', sessionKey: 'session-a', entryId: 'new' },
  }), expect.any(Function));
  expect(onCreated).not.toHaveBeenCalled();
  expect(requests('fillRequest')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Retry completion' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')).toHaveLength(1);
  expect(requests('save')).toHaveLength(1);
  expect(requests('fillRequest')).toHaveLength(label === 'Create & Fill' ? 1 : 0);
  expect(mocks.clear).toHaveBeenCalledTimes(2);
});

test.each([{ ok: false, error: 'denied' }, undefined, new Error('closed tab')])('fill failure %j retries only fill for the saved ID', async failure => {
  let fills = 0;
  mocks.send.mockImplementation(async (r: Request) => {
    if (r.type === 'fillRequest' && ++fills === 1) {
      if (failure instanceof Error) throw failure;
      return failure;
    }
    return respond(r);
  });
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Fill' }));
  await screen.findByText(/Entry saved, but autofill failed/);
  expect(onCreated).not.toHaveBeenCalled();
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  const writesBeforeRetry = mocks.write.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry fill' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')).toHaveLength(1);
  expect(requests('save')).toHaveLength(1);
  expect(requests('fillRequest').map(([r]) => r)).toEqual([
    { type: 'fillRequest', entryId: 'new', tabId: 1 }, { type: 'fillRequest', entryId: 'new', tabId: 1 },
  ]);
  expect(mocks.write).toHaveBeenCalledTimes(writesBeforeRetry);
  expect(mocks.clear).toHaveBeenCalledTimes(1);
});

test.each(['creating', 'unknown', 'created', 'saved'] as const)('restored %s marker from another opaque session permits review only', async status => {
  const marker = { status, sessionKey: 'session-a:other-connection', entryId: 'known' };
  const { onCreated } = await setup(recovery(marker));
  await screen.findByText(/different session/);
  expect(screen.getByPlaceholderText('Title')).toBeDisabled();
  expect(screen.queryByRole('button', { name: /Create &|Retry save|Retry completion|Discard/ })).not.toBeInTheDocument();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});

test.each(['creating', 'unknown'] as const)('restored %s marker in the matching session cannot blindly create again', async status => {
  await setup(recovery({ status, sessionKey: 'session-a' }));
  await screen.findByText(/Could not confirm whether/);
  expect(screen.queryByRole('button', { name: /Create &|Retry save|Discard/ })).not.toBeInTheDocument();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

test.each(['created', 'saved'] as const)('restored %s ID is validated in its matching session before completion', async status => {
  const { onCreated } = await setup(recovery({ status, sessionKey: 'session-a', entryId: 'known' }));
  await waitFor(() => expect((screen.getByLabelText('TOTP setup key or URI') as HTMLInputElement).value).toContain(config.secret));
  expect(screen.getByPlaceholderText('Title')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: status === 'created' ? 'Retry save' : 'Retry completion' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('getEntry')).toEqual([[{ type: 'getEntry', entryId: 'known' }]]);
  expect(requests('createEntry')).toHaveLength(0);
  expect(requests('save')).toHaveLength(status === 'created' ? 1 : 0);
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({ totp: config,
    submission: { status: 'saved', sessionKey: 'session-a', entryId: 'known' } }), expect.any(Function));
});

test.each([null, { id: 'another-entry' }, undefined])('a restored known marker with missing/mismatched entry %j requires review', async entry => {
  mocks.send.mockImplementation(async (r: Request) => r.type === 'getEntry' ? { ok: true, entry } : respond(r));
  const { onCreated } = await setup(recovery({ status: 'created', sessionKey: 'session-a', entryId: 'deleted' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await screen.findByText(/Could not find the submitted entry/);
  expect(requests('save')).toHaveLength(0);
  expect(requests('createEntry')).toHaveLength(0);
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});

test('a rejected restored ID lookup remains recoverable and is validated again before save', async () => {
  let lookups = 0;
  mocks.send.mockImplementation(async (r: Request) => {
    if (r.type === 'getEntry' && ++lookups === 1) throw new Error('disconnected');
    return respond(r);
  });
  const { onCreated } = await setup(recovery({ status: 'created', sessionKey: 'session-a', entryId: 'known' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await screen.findByText(/Could not finish saving/);
  expect(requests('save')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('getEntry')).toHaveLength(2);
  expect(requests('save')).toHaveLength(1);
  expect(requests('createEntry')).toHaveLength(0);
});

test('ordinary drafts restore TOTP and retain the exact submitted fields before mutation', async () => {
  const draft = recovery();
  const { onCreated } = await setup(draft);
  await waitFor(() => expect((screen.getByLabelText('TOTP setup key or URI') as HTMLInputElement).value).toContain(config.secret));
  mocks.send.mockImplementation(async (r: Request) => {
    if (r.type === 'createEntry') expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
      ...draft, savedAt: expect.any(Number), submission: { status: 'creating', sessionKey: 'session-a' },
    }), expect.any(Function));
    return respond(r);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('createEntry')[0][0]).toEqual({ type: 'createEntry', groupId: 'root', totp: config,
    fields: { Title: draft.title, UserName: draft.username, Password: draft.password, URL: draft.entryUrl } });
});

test('a delayed ordinary write finishes before markers and cannot recreate a cleared draft', async () => {
  const late = deferred<void>();
  mocks.write.mockReturnValueOnce(late.promise);
  const { onCreated } = await setup();
  fireEvent.change(screen.getByLabelText('TOTP setup key or URI'), { target: { value: config.secret } });
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await act(async () => { await Promise.resolve(); });
  expect(requests('createEntry')).toHaveLength(0);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  await act(async () => { late.resolve(); });
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  const markers = mocks.write.mock.calls.map(([d]) => d.submission?.status).filter(Boolean);
  expect(markers).toEqual(['creating', 'created', 'saved']);
  const snapshot = mocks.write.mock.calls.find(([d]) => d.submission?.status === 'creating')![0];
  expect(snapshot).toMatchObject({ password: 'generated', title: 'Private draft', totp: config });
  expect(mocks.clear.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.write.mock.invocationCallOrder.at(-1)!);
  const writesAfterCompletion = mocks.write.mock.calls.length;
  await act(async () => { await Promise.resolve(); });
  expect(mocks.write).toHaveBeenCalledTimes(writesAfterCompletion);
});

test('two synchronous submission clicks share one mutation and completion', async () => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (r: Request) => r.type === 'createEntry' ? late.promise : respond(r));
  const { onCreated } = await setup();
  const save = screen.getByRole('button', { name: 'Create & Save' });
  const fill = screen.getByRole('button', { name: 'Create & Fill' });
  act(() => { save.click(); fill.click(); save.click(); });
  await waitFor(() => expect(requests('createEntry')).toHaveLength(1));
  await act(async () => { late.resolve({ ok: true, entryId: 'new' }); });
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('save')).toHaveLength(1);
  expect(requests('fillRequest')).toHaveLength(0);
});

test('a late password generation cannot replace the submitted recovery snapshot', async () => {
  const late = deferred<unknown>();
  const { onCreated } = await setup();
  mocks.send.mockImplementation(async (r: Request) => r.type === 'generatePassword' ? late.promise : respond(r));
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  const before = mocks.write.mock.calls.length;
  await act(async () => { late.resolve({ ok: true, password: 'late-secret' }); });
  expect(screen.getByPlaceholderText('Password')).toHaveValue('generated');
  expect(mocks.write).toHaveBeenCalledTimes(before);
  expect(requests('createEntry')[0][0].fields.Password).toBe('generated');
});

test('a failed draft load prevents overwrite and creation until retry recovers it', async () => {
  mocks.load.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(recovery());
  const view = render(<CreateForm sessionKey="session-a" url="https://example.test" tabId={1} defaultGroupId="root"
    groups={[{ groupId: 'root', name: 'Root', depth: 0 }]} clearSecs={30} pwgen={DEFAULT_PWGEN}
    scanPage={{ disabled: false, scanning: false, description: 'Scan', onClick: vi.fn() }} onCreated={vi.fn()} />);
  await screen.findByText(/Could not load the recovery draft/);
  expect(screen.getByRole('button', { name: 'Create & Save' })).toBeDisabled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry draft load' }));
  await waitFor(() => expect(screen.getByPlaceholderText('Password')).toHaveValue('recovered'));
  expect(screen.getByRole('button', { name: 'Create & Save' })).toBeEnabled();
  view.unmount();
});

test('a late password-generation rejection cannot overwrite an unknown creation recovery message', async () => {
  let reject!: (error: Error) => void;
  const late = new Promise((_resolve, fail) => { reject = fail; });
  const { onCreated } = await setup();
  mocks.send.mockImplementation(async (r: Request) => {
    if (r.type === 'generatePassword') return late;
    if (r.type === 'createEntry') throw new Error('lost reply');
    return respond(r);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await screen.findByText(/Could not confirm whether/);
  await act(async () => { reject(new Error('generation failed')); });
  expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm whether');
  expect(onCreated).not.toHaveBeenCalled();
  expect(requests('createEntry')).toHaveLength(1);
});


test('a successful save acknowledgement completes even when cloud upload remains pending offline', async () => {
  mocks.send.mockImplementation(async (r: Request) => r.type === 'getSyncStatus'
    ? { ok: true, source: 'cloud', online: false, pendingUpload: true } : respond(r));
  const { onCreated } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Save' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(requests('save')).toHaveLength(1);
  expect(requests('getSyncStatus')).toHaveLength(0);
  expect(mocks.clear).toHaveBeenCalledTimes(1);
});
