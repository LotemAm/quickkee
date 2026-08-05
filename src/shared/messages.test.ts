import { expectTypeOf } from 'vitest';
import { sendToSW, type ResponseFor, type Request } from './messages';

test('sendToSW forwards to chrome.runtime.sendMessage', async () => {
  const calls: Request[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage: (m: Request) => { calls.push(m); return Promise.resolve({ ok: true }); } } };
  const res = await sendToSW({ type: 'lock' });
  expect(calls[0]).toEqual({ type: 'lock' });
  expect(res).toEqual({ ok: true });
});

test('sendToSW is typed per-request (type-level only, no runtime assertions)', () => {
  expectTypeOf(sendToSW({ type: 'getTree' })).resolves.toEqualTypeOf<ResponseFor<'getTree'>>();
  expectTypeOf(sendToSW({ type: 'getEntriesForUrl', url: 'x' })).resolves.toEqualTypeOf<ResponseFor<'getEntriesForUrl'>>();

  const r = {} as ResponseFor<'getTree'>;
  if (r.ok) {
    // @ts-expect-error — password does not exist on a getTree response
    void r.password;
  }
});
