import { GDriveProvider } from './gdrive';
import { afterEach, vi } from 'vitest';

const token = () => Promise.resolve('TOKEN');
type H = (url: string, init: RequestInit) => Response;
function mockSequence(...handlers: H[]) {
  let i = 0;
  globalThis.fetch = vi.fn((url: any, init: any) =>
    Promise.resolve(handlers[Math.min(i++, handlers.length - 1)](String(url), init ?? {}))) as any;
}
afterEach(() => { vi.restoreAllMocks(); });

test('listKdbxFiles maps Drive files', async () => {
  mockSequence(() => new Response(JSON.stringify({
    files: [{ id: 'd1', name: 'vault.kdbx', headRevisionId: 'h1' }],
  }), { status: 200 }));
  const files = await new GDriveProvider(token).listKdbxFiles();
  expect(files).toEqual([{ fileId: 'd1', name: 'vault.kdbx', rev: 'h1' }]);
});

test('getRevision reads headRevisionId', async () => {
  mockSequence(() => new Response(JSON.stringify({ headRevisionId: 'h7' }), { status: 200 }));
  expect(await new GDriveProvider(token).getRevision('d1')).toBe('h7');
});

test('download fetches media then rev', async () => {
  mockSequence(
    () => new Response(new Uint8Array([4, 5]), { status: 200 }),               // media
    () => new Response(JSON.stringify({ headRevisionId: 'h2' }), { status: 200 }), // rev
  );
  const { bytes, rev } = await new GDriveProvider(token).download('d1');
  expect(rev).toBe('h2');
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([4, 5]));
});

test('upload conflicts when remote rev moved past basedOnRev', async () => {
  mockSequence(() => new Response(JSON.stringify({ headRevisionId: 'h9' }), { status: 200 })); // rev re-check
  const res = await new GDriveProvider(token).upload('d1', new Uint8Array([1]).buffer, 'h2');
  expect(res).toEqual({ ok: false, conflict: true });
});

test('upload succeeds when rev still matches', async () => {
  mockSequence(
    () => new Response(JSON.stringify({ headRevisionId: 'h2' }), { status: 200 }), // rev re-check matches
    () => new Response(JSON.stringify({ headRevisionId: 'h3' }), { status: 200 }), // PATCH result
  );
  const res = await new GDriveProvider(token).upload('d1', new Uint8Array([1]).buffer, 'h2');
  expect(res).toEqual({ ok: true, rev: 'h3' });
});
