// @vitest-environment node
import { beforeEach, vi } from 'vitest';
import { resolvePopupFillTargets, resolveInlineFillTarget, revalidatePopupFillTarget, revalidateInlineFillTarget } from './fillTargets';

const pageUrl = 'https://github.com/login';
const top = { frameId: 0, documentId: 'top', url: pageUrl, documentLifecycle: 'active', errorOccurred: false };
const child = { ...top, frameId: 3, documentId: 'child', url: 'https://github.com/session' };
const foreign = { ...child, frameId: 4, documentId: 'foreign', url: 'https://evil.example/login' };
const sender = { tab: { id: 7 }, frameId: 3, documentId: 'child', url: child.url } as chrome.runtime.MessageSender;
let getAllFrames: ReturnType<typeof vi.fn>;
let getFrame: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getAllFrames = vi.fn().mockResolvedValue([top]);
  getFrame = vi.fn().mockResolvedValue(child);
  vi.stubGlobal('chrome', { webNavigation: { getAllFrames, getFrame } });
});

test('top-only documents are copied into immutable targets', async () => {
  const result = await resolvePopupFillTargets(7, pageUrl);
  expect(result.targets).toEqual([{ tabId: 7, frameId: 0, documentId: 'top', url: pageUrl }]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.targets)).toBe(true);
  expect(Object.isFrozen(result.top)).toBe(true);
  expect(result.top).not.toBe(top);
});

test('matching children are eligible and unrelated origins are excluded', async () => {
  getAllFrames.mockResolvedValue([top, child, foreign]);
  const result = await resolvePopupFillTargets(7, pageUrl);
  expect(result.targets.map(target => target.documentId)).toEqual(['top', 'child']);
  expect(result.targets.every(Object.isFrozen)).toBe(true);
});

test('URLless entries authorize only the top document', async () => {
  getAllFrames.mockResolvedValue([top, child, foreign]);
  expect((await resolvePopupFillTargets(7, '')).targets.map(target => target.documentId)).toEqual(['top']);
});

test('a matching child cannot authorize a nonmatching top', async () => {
  getAllFrames.mockResolvedValue([{ ...top, url: foreign.url }, child]);
  await expect(resolvePopupFillTargets(7, pageUrl)).rejects.toThrow('urlMismatch');
});

test.each([null, [], [child], [{ ...top, documentId: '' }], [{ ...top, documentLifecycle: undefined }],
  [{ ...top, documentLifecycle: 'cached' }], [{ ...top, errorOccurred: true }],
  [{ ...top, url: 'about:blank' }], [{ ...top, url: 'chrome://settings' }], [{ ...top, url: 'invalid' }],
])('missing or ineligible top metadata fails closed: %j', async frames => {
  getAllFrames.mockResolvedValue(frames);
  await expect(resolvePopupFillTargets(7, '')).rejects.toThrow('noFillTargets');
});

test.each([
  { documentId: '' }, { documentLifecycle: 'prerender' }, { documentLifecycle: 'pending_deletion' },
  { errorOccurred: true }, { url: 'data:text/html,hello' }, { frameId: -1 },
])('ineligible children are excluded: %j', async change => {
  getAllFrames.mockResolvedValue([top, { ...child, ...change }]);
  expect((await resolvePopupFillTargets(7, pageUrl)).targets).toHaveLength(1);
});

test('inline uses only browser-derived sender metadata, including URLless entries', async () => {
  expect(await resolveInlineFillTarget(sender, '')).toEqual({ tabId: 7, frameId: 3, documentId: 'child', url: child.url });
  expect(getFrame).toHaveBeenCalledWith({ tabId: 7, frameId: 3 });
});

test.each([
  {}, { ...sender, tab: undefined }, { ...sender, frameId: undefined }, { ...sender, frameId: -1 },
  { ...sender, documentId: undefined }, { ...sender, url: undefined }, { ...sender, url: 'about:blank' },
])('invalid inline sender fails closed: %j', async invalid => {
  await expect(resolveInlineFillTarget(invalid as chrome.runtime.MessageSender, '')).rejects.toThrow('forbidden');
  expect(getFrame).not.toHaveBeenCalled();
});

test('inline rejects a nonmatching sender URL', async () => {
  await expect(resolveInlineFillTarget({ ...sender, url: foreign.url }, pageUrl)).rejects.toThrow('urlMismatch');
});

test.each([null, { ...child, documentId: 'replacement' }, { ...child, url: foreign.url },
  { ...child, documentLifecycle: 'cached' }, { ...child, documentId: undefined },
])('inline rejects missing or changed browser metadata: %j', async frame => {
  getFrame.mockResolvedValue(frame);
  await expect(resolveInlineFillTarget(sender, pageUrl)).rejects.toThrow('noFillTargets');
});

test.each(['top', 'child'])('popup revalidation rejects a replaced %s document, even at the same URL', async replaced => {
  getAllFrames.mockResolvedValue([top, child]);
  const selected = await resolvePopupFillTargets(7, pageUrl);
  getAllFrames.mockResolvedValue([top, child].map(frame => frame.documentId === replaced ? { ...frame, documentId: 'replacement' } : frame));
  expect(await revalidatePopupFillTarget(selected.top, selected.targets[1])).toBe(false);
});

test('popup revalidation checks both document URLs and lifecycle', async () => {
  getAllFrames.mockResolvedValue([top, child]);
  const selected = await resolvePopupFillTargets(7, pageUrl);
  expect(await revalidatePopupFillTarget(selected.top, selected.targets[1])).toBe(true);
  getAllFrames.mockResolvedValue([{ ...top, url: foreign.url }, child]);
  expect(await revalidatePopupFillTarget(selected.top, selected.targets[1])).toBe(false);
  getAllFrames.mockResolvedValue([top, { ...child, documentLifecycle: 'cached' }]);
  expect(await revalidatePopupFillTarget(selected.top, selected.targets[1])).toBe(false);
});

test('inline revalidation never substitutes a replacement document', async () => {
  const selected = await resolveInlineFillTarget(sender, pageUrl);
  expect(await revalidateInlineFillTarget(selected)).toBe(true);
  getFrame.mockResolvedValue({ ...child, documentId: 'replacement' });
  expect(await revalidateInlineFillTarget(selected)).toBe(false);
});
