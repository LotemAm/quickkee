import type { Request } from '../../shared/messages';
import { saveScannedTotp } from './saveScannedTotp';

const config = {
  secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1' as const, digits: 6, period: 30,
};

function sender(responses: Array<object | Error>) {
  return vi.fn(async (_request: Request) => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error('missing test response');
    return response as { ok: boolean; error?: string; entryId?: string };
  });
}

test('attaches TOTP without changing any other entry fields, then saves', async () => {
  const send = sender([{ ok: true }, { ok: true }]);

  await expect(saveScannedTotp(config, { type: 'existing', entryId: 'entry-1' }, send))
    .resolves.toEqual({ status: 'saved', entryId: 'entry-1' });
  expect(send).toHaveBeenNthCalledWith(1, {
    type: 'updateEntry', entryId: 'entry-1', fields: {}, totp: config,
  });
  expect(send).toHaveBeenNthCalledWith(2, { type: 'save' });
});

test('creates with canonical fields and reports a known dirty vault when save fails', async () => {
  const send = sender([{ ok: true, entryId: 'new-entry' }, { ok: false, error: 'saveFailed' }]);
  const destination = {
    type: 'new' as const, groupId: 'root',
    fields: { Title: 'Acme', UserName: 'alice', Password: '', URL: 'https://example.com/' },
  };

  await expect(saveScannedTotp(config, destination, send)).resolves.toEqual({
    status: 'unsaved', entryId: 'new-entry', error: 'saveFailed',
  });
  expect(send).toHaveBeenNthCalledWith(1, { type: 'createEntry', groupId: 'root', fields: destination.fields, totp: config });
  expect(send).toHaveBeenNthCalledWith(2, { type: 'save' });
});

test('does not save after a rejected mutation and distinguishes an uncertain runtime failure', async () => {
  const rejected = sender([{ ok: false, error: 'locked' }]);
  await expect(saveScannedTotp(config, { type: 'existing', entryId: 'entry-1' }, rejected))
    .resolves.toEqual({ status: 'failed', error: 'locked' });
  expect(rejected).toHaveBeenCalledOnce();

  const uncertain = sender([new Error('message port closed')]);
  await expect(saveScannedTotp(config, { type: 'existing', entryId: 'entry-1' }, uncertain))
    .resolves.toEqual({ status: 'unknown', error: 'message port closed' });
});
