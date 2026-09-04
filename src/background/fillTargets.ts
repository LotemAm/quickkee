import { urlMatches } from './matcher';

export interface FillTarget {
  readonly tabId: number;
  readonly frameId: number;
  readonly documentId: string;
  readonly url: string;
}

export interface PopupFillTargets {
  readonly top: FillTarget;
  readonly targets: readonly FillTarget[];
}

type DocumentMetadata = Pick<chrome.webNavigation.GetFrameResultDetails,
  'documentId' | 'documentLifecycle' | 'url' | 'errorOccurred'>;

function httpUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); }
  catch { return false; }
}

function targetFor(tabId: number, frameId: number, frame?: DocumentMetadata | null): FillTarget | null {
  if (!frame || !frame.documentId || frame.documentLifecycle !== 'active' ||
    frame.errorOccurred || !httpUrl(frame.url)) return null;
  return Object.freeze({ tabId, frameId, documentId: frame.documentId, url: frame.url });
}

function sameDocument(target: FillTarget, frame?: DocumentMetadata | null): boolean {
  const current = targetFor(target.tabId, target.frameId, frame);
  return current !== null && current.documentId === target.documentId && current.url === target.url;
}

export async function resolvePopupFillTargets(tabId: number, entryUrl: string): Promise<PopupFillTargets> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const top = targetFor(tabId, 0, frames?.find(frame => frame.frameId === 0));
  if (!top) throw new Error('noFillTargets');
  if (entryUrl && !urlMatches(entryUrl, top.url)) throw new Error('urlMismatch');
  const targets = entryUrl ? (frames ?? []).flatMap(frame => {
    if (!Number.isInteger(frame.frameId) || frame.frameId < 0) return [];
    const target = targetFor(tabId, frame.frameId, frame);
    return target && urlMatches(entryUrl, target.url) ? [target] : [];
  }) : [top];
  if (!targets.length) throw new Error('noFillTargets');
  return Object.freeze({ top, targets: Object.freeze(targets) });
}

export async function resolveInlineFillTarget(sender: chrome.runtime.MessageSender, entryUrl: string): Promise<FillTarget> {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (tabId == null || frameId == null || !Number.isInteger(frameId) || frameId < 0 ||
    !sender.documentId || !sender.url || !httpUrl(sender.url)) throw new Error('forbidden');
  if (entryUrl && !urlMatches(entryUrl, sender.url)) throw new Error('urlMismatch');
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId });
  const target = targetFor(tabId, frameId, frame);
  if (!target || target.documentId !== sender.documentId || target.url !== sender.url)
    throw new Error('noFillTargets');
  if (entryUrl && !urlMatches(entryUrl, target.url)) throw new Error('urlMismatch');
  return target;
}

/** Check the top-level authorization and recipient in the same browser snapshot. */
export async function revalidatePopupFillTarget(top: FillTarget, target: FillTarget): Promise<boolean> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: top.tabId });
  return target.tabId === top.tabId &&
    sameDocument(top, frames?.find(frame => frame.frameId === 0)) &&
    sameDocument(target, frames?.find(frame => frame.frameId === target.frameId));
}

export async function revalidateInlineFillTarget(target: FillTarget): Promise<boolean> {
  const frame = await chrome.webNavigation.getFrame({ tabId: target.tabId, frameId: target.frameId });
  return sameDocument(target, frame);
}
