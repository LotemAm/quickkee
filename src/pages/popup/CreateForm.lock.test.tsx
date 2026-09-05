import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Request } from '../../shared/messages';
import { DEFAULT_PWGEN } from '../../shared/pwgen';
import { CreateForm } from './CreateForm';

const mocks = vi.hoisted(() => ({ send: vi.fn(), clearDraft: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/createDraft', () => ({ loadDraft: async () => null, saveDraft: vi.fn(), clearDraft: mocks.clearDraft }));

test.each(['Create & Save', 'Create & Fill'])('%s cancels save/fill and parent callbacks after the create reply outlives its session', async label => {
  let resolve!: (value: unknown) => void;
  const reply = new Promise(done => { resolve = done; });
  mocks.send.mockReset().mockImplementation(async (request: Request) => request.type === 'createEntry' ? reply : { ok: true, password: 'generated' });
  mocks.clearDraft.mockClear();
  const onCreated = vi.fn();
  const view = render(<CreateForm url="https://example.test" tabId={1} defaultGroupId="root"
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
