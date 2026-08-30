import { isScannablePageUrl, scanVisibleTabForTotp } from './scanVisibleTabForTotp';

const SECRET = 'JBSWY3DPEHPK3PXP';

function deps(decoded: string) {
  return {
    queryActiveTab: vi.fn(async (): Promise<{ id?: number; windowId?: number; url?: string }> => (
      { id: 12, windowId: 7, url: 'https://example.com/login' }
    )),
    captureVisibleTab: vi.fn(async () => 'data:image/png;base64,capture'),
    decodeQrDataUrl: vi.fn(async () => decoded),
  };
}

test.each([
  ['http://example.com', true],
  ['https://example.com/path', true],
  ['chrome://settings', false],
  ['chrome-extension://abc/page.html', false],
  ['file:///tmp/code.png', false],
  ['', false],
])('classifies scannable page URL %s', (url, expected) => {
  expect(isScannablePageUrl(url)).toBe(expected);
});

test.each(['SHA1', 'SHA256', 'SHA512'] as const)('re-queries and captures exactly once for %s TOTP', async algorithm => {
  const adapter = deps(`otpauth://totp/Acme:alice?secret=${SECRET}&algorithm=${algorithm}&digits=8&period=45&issuer=Acme`);

  await expect(scanVisibleTabForTotp(adapter)).resolves.toEqual({
    tabId: 12,
    pageUrl: 'https://example.com/login',
    config: { secret: SECRET, algorithm, digits: 8, period: 45, issuer: 'Acme', account: 'alice' },
  });

  expect(adapter.queryActiveTab).toHaveBeenCalledOnce();
  expect(adapter.captureVisibleTab).toHaveBeenCalledOnce();
  expect(adapter.captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
  expect(adapter.decodeQrDataUrl).toHaveBeenCalledWith('data:image/png;base64,capture');
});

test.each([
  ['https://example.com', { id: undefined, windowId: 7, url: 'https://example.com' }],
  ['https://example.com', { id: 12, windowId: undefined, url: 'https://example.com' }],
  ['chrome://settings', { id: 12, windowId: 7, url: 'chrome://settings' }],
])('rejects an unsupported active tab without capturing: %s', async (_label, tab) => {
  const adapter = deps('unused');
  adapter.queryActiveTab.mockResolvedValue(tab);

  await expect(scanVisibleTabForTotp(adapter)).rejects.toThrow('Scan page QR is available only on HTTP(S) pages.');
  expect(adapter.captureVisibleTab).not.toHaveBeenCalled();
});

test('reports capture and decode failures safely', async () => {
  const captureFailure = deps('unused');
  captureFailure.captureVisibleTab.mockRejectedValue(new Error('secret browser detail'));
  await expect(scanVisibleTabForTotp(captureFailure)).rejects.toThrow('Could not capture the visible page. Try again.');

  const decodeFailure = deps('unused');
  decodeFailure.decodeQrDataUrl.mockRejectedValue(new Error('data:image/png;base64,private'));
  await expect(scanVisibleTabForTotp(decodeFailure)).rejects.toThrow(
    'No readable QR code found. Make sure the code is visible, then try again.',
  );
});

test.each([
  ['https://example.com', 'This QR code is not an authenticator setup code.'],
  [`otpauth://hotp/Acme:alice?secret=${SECRET}&counter=1`, 'Counter-based HOTP codes are not supported.'],
  ['otpauth-migration://offline?data=private', 'Use Import from Google Authenticator in the side panel for migration QR codes.'],
  [`otpauth://totp/Acme:alice?secret=${SECRET}&algorithm=MD5`, 'Unsupported TOTP algorithm'],
])('classifies decoded QR content without echoing it', async (decoded, message) => {
  const adapter = deps(decoded);
  const promise = scanVisibleTabForTotp(adapter);
  await expect(promise).rejects.toThrow(message);
  await expect(promise).rejects.not.toThrow(decoded);
});
