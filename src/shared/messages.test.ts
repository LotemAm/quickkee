import { sendToSW } from './messages';

test('sendToSW forwards to chrome.runtime.sendMessage', async () => {
  const calls: any[] = [];
  (globalThis as any).chrome = { runtime: { sendMessage: (m: any) => { calls.push(m); return Promise.resolve({ ok: true }); } } };
  const res = await sendToSW({ type: 'lock' });
  expect(calls[0]).toEqual({ type: 'lock' });
  expect(res).toEqual({ ok: true });
});
