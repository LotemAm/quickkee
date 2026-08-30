import type { TotpConfig } from '../../background/totp';
import { sendToSW, type Request } from '../../shared/messages';

export type ScannedTotpDestination =
  | { type: 'existing'; entryId: string }
  | { type: 'new'; groupId: string; fields: Record<string, string> };

type SendResponse = { ok: boolean; error?: string; entryId?: string };
type SendRequest = (request: Request) => Promise<SendResponse>;

export type SaveScannedTotpResult =
  | { status: 'saved'; entryId: string }
  | { status: 'unsaved'; entryId: string; error: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown'; error: string };

const defaultSend: SendRequest = request => sendToSW(request) as Promise<SendResponse>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'runtimeError';
}

export async function saveScannedTotp(
  config: TotpConfig,
  destination: ScannedTotpDestination,
  send: SendRequest = defaultSend,
): Promise<SaveScannedTotpResult> {
  let mutation: SendResponse;
  try {
    mutation = destination.type === 'existing'
      ? await send({ type: 'updateEntry', entryId: destination.entryId, fields: {}, totp: config })
      : await send({ type: 'createEntry', groupId: destination.groupId, fields: destination.fields, totp: config });
  } catch (error) {
    return { status: 'unknown', error: errorMessage(error) };
  }
  if (!mutation.ok) return { status: 'failed', error: mutation.error ?? 'updateFailed' };

  const entryId = destination.type === 'existing' ? destination.entryId : mutation.entryId;
  if (!entryId) return { status: 'unknown', error: 'missingEntryId' };
  try {
    const saved = await send({ type: 'save' });
    if (!saved.ok) return { status: 'unsaved', entryId, error: saved.error ?? 'saveFailed' };
  } catch (error) {
    return { status: 'unsaved', entryId, error: errorMessage(error) };
  }
  return { status: 'saved', entryId };
}
