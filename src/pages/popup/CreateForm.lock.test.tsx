import { StrictMode } from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Request } from '../../shared/messages';
import { DEFAULT_PWGEN } from '../../shared/pwgen';
import { CreateForm } from './CreateForm';

const mocks = vi.hoisted(() => ({ send: vi.fn(), clearDraft: vi.fn(), loadDraft: vi.fn(), saveDraft: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/createDraft', () => ({ loadDraft: mocks.loadDraft, saveDraft: mocks.saveDraft, clearDraft: mocks.clearDraft }));

test.each(['Create & Save', 'Create & Fill'])('%s cancels save/fill and parent callbacks after the create reply outlives its session', async label => {
  let resolve!: (value: unknown) => void;
  const reply = new Promise(done => { resolve = done; });
  mocks.send.mockReset().mockImplementation(async (request: Request) => request.type === 'createEntry' ? reply : { ok: true, password: 'generated' });
  mocks.clearDraft.mockClear();
  const onCreated = vi.fn();
  const view = render(<CreateForm sessionKey="session-a" url="https://example.test" tabId={1} defaultGroupId="root"
    groups={[{ groupId: 'root', name: 'Root', depth: 0 }]} clearSecs={30} pwgen={DEFAULT_PWGEN}
    scanPage={{ disabled: false, scanning: false, description: 'Scan', onClick: vi.fn() }} onCreated={onCreated} />);
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ type: 'generatePassword', opts: DEFAULT_PWGEN }));
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Private draft' } });
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(mocks.send.mock.calls.some(([request]) => request.type === 'createEntry')).toBe(true));
  view.unmount();
  await act(async () => { resolve({ ok: true, entryId: 'new' }); });
  expect(mocks.send.mock.calls.some(([request]) => ['save', 'fillRequest'].includes(request.type))).toBe(false);
  expect(mocks.clearDraft).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});



beforeEach(() => {
  mocks.loadDraft.mockReset().mockResolvedValue(null);
  mocks.saveDraft.mockReset().mockResolvedValue(undefined);
  mocks.clearDraft.mockReset().mockResolvedValue(undefined);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test.each(['ordinary-write', 'creating-marker', 'createEntry', 'created-marker', 'save', 'saved-marker', 'clear', 'fillRequest', 'getEntry'])(
  'unmount during %s prevents every subsequent message, draft write, clear and callback', async boundary => {
    const late = deferred<unknown>();
    const draft = { url: 'https://example.test', title: 'Private draft', username: 'alice', password: 'generated',
      entryUrl: 'https://example.test', opts: DEFAULT_PWGEN, savedAt: Date.now(), groupId: 'root',
      ...(boundary === 'getEntry' ? { submission: { status: 'created', sessionKey: 'session-a', entryId: 'known' } } : {}),
    };
    if (boundary === 'getEntry') mocks.loadDraft.mockResolvedValue(draft);
    mocks.send.mockReset().mockImplementation(async (r: Request) => {
      if (r.type === boundary) return late.promise;
      if (r.type === 'generatePassword') return { ok: true, password: 'generated' };
      if (r.type === 'createEntry') return { ok: true, entryId: 'new' };
      return { ok: true };
    });
    mocks.saveDraft.mockImplementation(async (d: { submission?: { status: string } }) => {
      if ((!d.submission && boundary === 'ordinary-write') || `${d.submission?.status}-marker` === boundary) return late.promise;
    });
    if (boundary === 'clear') mocks.clearDraft.mockReturnValue(late.promise);
    const onCreated = vi.fn();
    const view = render(<CreateForm sessionKey="session-a" url="https://example.test" tabId={1} defaultGroupId="root"
      groups={[{ groupId: 'root', name: 'Root', depth: 0 }]} clearSecs={30} pwgen={DEFAULT_PWGEN}
      scanPage={{ disabled: false, scanning: false, description: 'Scan', onClick: vi.fn() }} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByPlaceholderText('Password')).toHaveValue('generated'));
    if (boundary !== 'getEntry') fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Private draft' } });
    fireEvent.click(screen.getByRole('button', { name: boundary === 'getEntry' ? 'Retry save' : 'Create & Fill' }));
    await waitFor(() => {
      if (boundary === 'ordinary-write') expect(mocks.saveDraft).toHaveBeenCalled();
      else if (boundary.endsWith('-marker')) expect(mocks.saveDraft.mock.calls.some(([d]) => `${d.submission?.status}-marker` === boundary)).toBe(true);
      else if (boundary === 'clear') expect(mocks.clearDraft).toHaveBeenCalled();
      else expect(mocks.send.mock.calls.some(([r]) => r.type === boundary)).toBe(true);
    });
    const before = [mocks.send.mock.calls.length, mocks.saveDraft.mock.calls.length, mocks.clearDraft.mock.calls.length];
    view.unmount();
    await act(async () => { late.resolve({ ok: true, entryId: 'new', entry: { id: 'known' } }); });
    expect([mocks.send.mock.calls.length, mocks.saveDraft.mock.calls.length, mocks.clearDraft.mock.calls.length]).toEqual(before);
    expect(onCreated).not.toHaveBeenCalled();
  },
);

test('unmount during draft hydration never generates a password or starts an ordinary draft write', async () => {
  const late = deferred<null>();
  mocks.loadDraft.mockReturnValue(late.promise);
  mocks.send.mockReset();
  const view = render(<CreateForm sessionKey="session-a" url="https://example.test" tabId={1} defaultGroupId="root"
    groups={[{ groupId: 'root', name: 'Root', depth: 0 }]} clearSecs={30} pwgen={DEFAULT_PWGEN}
    scanPage={{ disabled: false, scanning: false, description: 'Scan', onClick: vi.fn() }} onCreated={vi.fn()} />);
  view.unmount();
  await act(async () => { late.resolve(null); });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.saveDraft).not.toHaveBeenCalled();
});


test('StrictMode cannot revive an obsolete draft load and overwrite recovered fields', async () => {
  const late = deferred<null>();
  mocks.loadDraft.mockReturnValueOnce(late.promise).mockResolvedValue({ url: 'https://example.test', title: 'Recovered draft',
    username: 'alice', password: 'recovered', groupId: 'root', entryUrl: 'https://example.test', opts: DEFAULT_PWGEN, savedAt: Date.now(),
    submission: { status: 'unknown', sessionKey: 'session-a' } });
  mocks.send.mockReset();
  render(<StrictMode><CreateForm sessionKey="session-a" url="https://example.test" tabId={1} defaultGroupId="root"
    groups={[{ groupId: 'root', name: 'Root', depth: 0 }]} clearSecs={30} pwgen={DEFAULT_PWGEN}
    scanPage={{ disabled: false, scanning: false, description: 'Scan', onClick: vi.fn() }} onCreated={vi.fn()} /></StrictMode>);
  await screen.findByText(/Could not confirm whether/);
  await act(async () => { late.resolve(null); });
  expect(screen.getByPlaceholderText('Title')).toHaveValue('Recovered draft');
  expect(screen.getByPlaceholderText('Password')).toHaveValue('recovered');
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.saveDraft).not.toHaveBeenCalled();
});
