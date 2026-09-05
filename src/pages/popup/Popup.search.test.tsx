import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Request } from '../../shared/messages';
import type { EntrySummary, EntryView, TreeNode } from '../../shared/entry';

const mocks = vi.hoisted(() => ({ send: vi.fn(), copy: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/UnlockScreen', () => ({ UnlockScreen: () => <button>Unlock</button> }));
vi.mock('../../shared/settings', () => ({ loadSettings: async () => ({ theme: 'system', clipboardClearSeconds: 30 }) }));
vi.mock('../../shared/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../../shared/createDraft', () => ({ loadDraft: async () => null }));
vi.mock('../../shared/useClipboardTimer', () => ({ useClipboardTimer: () => ({ copy: mocks.copy, state: null }) }));
import { Popup } from './Popup';

function event() {
  const listeners = new Set<(message?: unknown) => void>();
  return { addListener: (fn: (message?: unknown) => void) => listeners.add(fn),
    removeListener: (fn: (message?: unknown) => void) => listeners.delete(fn),
    fire: (message?: unknown) => [...listeners].forEach(fn => fn(message)) };
}
const summaries: EntrySummary[] = Array.from({ length: 200 }, (_, i) => ({
  id: `entry-${i}`, title: `Match ${String(i).padStart(3, '0')}`, username: `user-${i}`,
  url: `https://host${i}.test`, expired: false, isCard: false, hasTotp: false, totpPeriod: null, hasAttachments: false,
}));
function details(summary: EntrySummary, password = 'secret'): EntryView {
  return { ...summary, password, fields: [], created: null, expires: null, attachments: [] };
}
const normal: EntryView = { ...details(summaries[0]), id: 'normal', title: 'URL login' };
let tree: TreeNode;
let onMessage: ReturnType<typeof event>;
let onActivated: ReturnType<typeof event>;
function reads() { return mocks.send.mock.calls.filter(([request]) => request.type === 'getEntry'); }
function respond(request: Request) {
  if (request.type === 'getTree') return { ok: true, tree };
  if (request.type === 'getEntriesForUrl') return { ok: true, entries: [normal] };
  if (request.type === 'getEntry') {
    const summary = summaries.find(e => e.id === request.entryId);
    return { ok: true, entry: summary ? details(summary) : null };
  }
  return { ok: true };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function load() {
  const view = render(<Popup />);
  act(() => onMessage.fire({ type: 'snapshot', snapshot: {
    workerIdentity: 'worker', generation: 1, sequence: 1, locked: false, dirty: false,
  } }));
  await screen.findByText('URL login');
  await screen.findByRole('button', { name: 'Add entry' });
  return view;
}
function search(value: string) { fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value } }); }
beforeEach(() => {
  tree = { groupId: 'root', name: 'Search group', entries: [], children: [
    { groupId: 'child', name: 'Nested group', entries: summaries, children: [] },
  ] };
  onMessage = event(); onActivated = event();
  mocks.copy.mockReset();
  mocks.send.mockReset().mockImplementation(async (request: Request) => respond(request));
  vi.stubGlobal('chrome', { runtime: { id: 'own', getURL: (path: string) => path,
    connect: () => ({ onMessage, onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn() }) },
  tabs: { query: async () => [{ id: 1, url: normal.url }], onActivated, onUpdated: event() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('200 summaries, successive title/username/URL queries, clear and no match never request details', async () => {
  const { container } = await load();
  const rowButtons = () => [...container.querySelectorAll('button[aria-label="Copy password"]')];
  const baseline = reads().length;
  expect(mocks.send.mock.calls.filter(([r]) => r.type === 'getEntriesForUrl')).toHaveLength(1);
  for (const [query, expected] of [
    ['  MATCH  ', summaries], ['match 01', summaries.slice(10, 20)],
    ['USER-199', [summaries[199]]], ['host198.test', [summaries[198]]],
  ] as const) {
    search(query);
    await waitFor(() => expect(rowButtons()).toHaveLength(expected.length));
    // Check each rendered row in order without repeatedly scanning 200 cards' descendants.
    rowButtons().forEach((button, index) => {
      const row = button.closest('.card');
      expect(row).toHaveTextContent(expected[index].title);
      expect(row).toHaveTextContent(expected[index].username);
      expect(row).toHaveTextContent('Nested group');
    });
    expect(reads()).toHaveLength(baseline);
  }
  search('');
  await screen.findByText('URL login');
  expect(rowButtons()).toHaveLength(1);
  expect(reads()).toHaveLength(baseline);
  search('no-match');
  await screen.findByText('No entries match your search.');
  expect(screen.queryByRole('button', { name: 'Copy password' })).not.toBeInTheDocument();
  expect(reads()).toHaveLength(baseline);
});

test('successive queries retain one pending read only for the explicitly chosen row', async () => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (request: Request) => request.type === 'getEntry' ? late.promise : respond(request));
  await load();
  search('match 019');
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  for (const query of ['user-19', 'HOST19.TEST', 'match 019']) {
    search(query);
    expect(screen.getByText('Match 019')).toBeVisible();
    expect(reads()).toEqual([[{ type: 'getEntry', entryId: 'entry-19' }]]);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
  expect(reads()).toHaveLength(1);
  await act(async () => { late.resolve({ ok: true, entry: details(summaries[19], 'chosen-secret') }); });
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('chosen-secret', 'Password');
  expect(screen.getByText('No additional details.')).toBeVisible();
});

test.each(['', 'no-match', 'match 199'])('query %j removes the pending row; returning to the same ID loads fresh details', async query => {
  const late = deferred<unknown>();
  let requested = false;
  mocks.send.mockImplementation(async (request: Request) => {
    if (request.type !== 'getEntry') return respond(request);
    if (!requested) { requested = true; return late.promise; }
    return { ok: true, entry: details(summaries[0], 'fresh') };
  });
  await load(); search('match 000');
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  search(query);
  expect(screen.queryByText('Match 000')).not.toBeInTheDocument();
  search('match 000');
  await act(async () => { late.resolve({ ok: true, entry: details(summaries[0], 'obsolete') }); });
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(reads()).toHaveLength(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(reads()).toHaveLength(2);
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('fresh', 'Password');
});

test.each(['pending', 'cached'])('successful vault refresh invalidates %s details for the same ID', async state => {
  const late = deferred<unknown>();
  let requested = false;
  mocks.send.mockImplementation(async (request: Request) => {
    if (request.type !== 'getEntry') return respond(request);
    if (!requested) {
      requested = true;
      return state === 'pending' ? late.promise : { ok: true, entry: details(summaries[0], 'old') };
    }
    return { ok: true, entry: details(summaries[0], 'fresh') };
  });
  await load(); search('user-0');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  if (state === 'cached') expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('old', 'Password');
  mocks.copy.mockClear();
  tree = { ...tree, children: [{ ...tree.children[0], entries: [{ ...summaries[0], title: 'Refreshed entry' }] }] };
  await act(async () => { onActivated.fire(); });
  await screen.findByText('Refreshed entry');
  expect(screen.queryByText('Loading entry details…')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Toggle fields' })).toHaveAttribute('aria-expanded', 'false');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('fresh', 'Password');
  await act(async () => { late.resolve({ ok: true, entry: details(summaries[0], 'obsolete') }); });
  expect(mocks.copy).toHaveBeenCalledTimes(1);
  expect(reads()).toEqual([[{ type: 'getEntry', entryId: 'entry-0' }], [{ type: 'getEntry', entryId: 'entry-0' }]]);
});

test('an entry removed from a refreshed tree cannot finish its pending password copy', async () => {
  const late = deferred<unknown>();
  mocks.send.mockImplementation(async (request: Request) => request.type === 'getEntry' ? late.promise : respond(request));
  await load(); search('match 000');
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  tree = { ...tree, children: [] };
  await act(async () => { onActivated.fire(); });
  await screen.findByText('No entries match your search.');
  await act(async () => { late.resolve({ ok: true, entry: details(summaries[0]) }); });
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(reads()).toHaveLength(1);
});

test('the normal URL full view never lazy-loads, and switching the same ID into search starts a summary lifetime', async () => {
  const urlEntry = { ...normal, id: summaries[0].id };
  mocks.send.mockImplementation(async (request: Request) => request.type === 'getEntriesForUrl'
    ? { ok: true, entries: [urlEntry] } : respond(request));
  await load();
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(urlEntry.password, 'Password');
  expect(reads()).toHaveLength(0);
  search('match 000');
  expect(screen.getByRole('button', { name: 'Toggle fields' })).toBeVisible();
  expect(reads()).toHaveLength(0);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(reads()).toEqual([[{ type: 'getEntry', entryId: summaries[0].id }]]);
  search('');
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  expect(reads()).toHaveLength(1);
});

test.each(['getTree', 'getEntriesForUrl'])('accepted partial refresh invalidates pending details when %s fails', async failedRequest => {
  const late = deferred<unknown>();
  let refreshing = false;
  let requested = false;
  mocks.send.mockImplementation(async (request: Request) => {
    if (refreshing && request.type === failedRequest) return { ok: false, error: 'refresh failed' };
    if (request.type !== 'getEntry') return respond(request);
    if (!requested) { requested = true; return late.promise; }
    return { ok: true, entry: details(summaries[0], 'fresh') };
  });
  await load(); search('match 000');
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  refreshing = true;
  await act(async () => { onActivated.fire(); });
  expect(screen.getByText('Match 000')).toBeVisible();
  expect(screen.queryByText('Loading entry details…')).not.toBeInTheDocument();
  await act(async () => { late.resolve({ ok: true, entry: details(summaries[0], 'obsolete') }); });
  expect(mocks.copy).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('fresh', 'Password');
  expect(reads()).toHaveLength(2);
});
