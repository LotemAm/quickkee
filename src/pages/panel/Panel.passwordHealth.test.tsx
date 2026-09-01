import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TreeNode } from '../../shared/entry';

const mocks = vi.hoisted(() => ({
  sendToSW: vi.fn(),
  refresh: vi.fn(),
  dirty: false,
}));

vi.mock('../../shared/useStatus', () => ({
  useStatus: () => ({ locked: false, dirty: mocks.dirty, refresh: mocks.refresh }),
}));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.sendToSW }));
vi.mock('../../shared/settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({
    clipboardClearSeconds: 30,
    pwgen: { length: 20, lower: true, upper: true, digits: true, symbols: true },
    theme: 'system',
  }),
}));
vi.mock('../../shared/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../../shared/openEntry', () => ({
  consumeOpenEntry: vi.fn().mockResolvedValue(null),
  watchOpenEntry: vi.fn().mockReturnValue(() => {}),
}));
vi.mock('./PasswordHealthCenter', () => ({
  PasswordHealthCenter: ({ onOpenEntry }: { onOpenEntry: (id: string) => Promise<boolean> }) => (
    <button onClick={() => void onOpenEntry('entry-1')}>Open health fixture</button>
  ),
}));
vi.mock('./EntryEditor', () => ({
  EntryEditor: ({ entryId, groupId }: { entryId: string | null; groupId?: string }) => (
    <div>Editor {entryId} in {groupId}</div>
  ),
}));
vi.mock('./PanelActionsMenu', () => ({ PanelActionsMenu: () => null }));
vi.mock('./TotpImportDialog', () => ({ TotpImportDialog: () => null }));

import { Panel } from './Panel';

const tree: TreeNode = {
  groupId: 'root', name: 'Root', entries: [],
  children: [{
    groupId: 'sites', name: 'Sites', children: [], entries: [{
      id: 'entry-1', title: 'Fixture login', username: 'alice', url: 'https://example.test',
      expired: false, isCard: false, hasTotp: false, totpPeriod: null, hasAttachments: false,
    }],
  }],
};

beforeEach(() => {
  mocks.dirty = false;
  mocks.sendToSW.mockReset();
  mocks.sendToSW.mockImplementation((request: { type: string }) => {
    if (request.type === 'getTree') return Promise.resolve({ ok: true, tree });
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => path } });
});

afterEach(() => vi.unstubAllGlobals());

test('opens a health finding in the existing Vault editor and containing group', async () => {
  render(<Panel />);
  await screen.findByRole('button', { name: 'Sites' });

  fireEvent.click(screen.getByRole('button', { name: 'Health view' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open health fixture' }));

  await waitFor(() => expect(screen.getByText('Editor entry-1 in sites')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Vault view' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.sendToSW.mock.calls.filter(([request]) => request.type === 'getTree')).toHaveLength(2);
});

test('shows the last successful save time in the Saved button tooltip', async () => {
  mocks.dirty = true;
  const toLocaleString = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('local date and time');
  render(<Panel />);

  const saveButton = await screen.findByRole('button', { name: 'Save *' });
  expect(saveButton.getAttribute('title')).toBeNull();
  fireEvent.click(saveButton);

  await waitFor(() => expect(saveButton.getAttribute('title')).toBe('Last saved: local date and time'));
  toLocaleString.mockRestore();
});
