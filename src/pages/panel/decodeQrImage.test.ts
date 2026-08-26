import { decodeQrImage } from './decodeQrImage';

const reader = vi.hoisted(() => ({
  decodeFromImageElement: vi.fn(),
  decodeFromCanvas: vi.fn(),
}));

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromImageElement(image: HTMLImageElement) { return reader.decodeFromImageElement(image); }
    decodeFromCanvas(canvas: HTMLCanvasElement) { return reader.decodeFromCanvas(canvas); }
  },
}));

function stubImageSize(width: number, height: number) {
  vi.stubGlobal('Image', function Image() {
    const image = document.createElement('img');
    Object.defineProperties(image, {
      naturalWidth: { value: width },
      naturalHeight: { value: height },
    });
    return image;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubImageSize(800, 800);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:qr-image'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => vi.restoreAllMocks());

test('retries a dense QR code at multiple resolutions', async () => {
  reader.decodeFromImageElement.mockRejectedValue(new Error('Dimensions could not be found'));
  reader.decodeFromCanvas.mockImplementation(async (canvas: HTMLCanvasElement) => {
    if (canvas.width === 2400) return { getText: () => 'otpauth-migration://offline?data=dummy' };
    throw new Error('No QR code found');
  });

  await expect(decodeQrImage(new File([], 'google-authenticator.png', { type: 'image/png' })))
    .resolves.toBe('otpauth-migration://offline?data=dummy');
  expect(reader.decodeFromCanvas.mock.calls.map(([canvas]) => canvas.width))
    .toEqual([600, 400, 300, 1200, 1600, 2400]);
});

test('distinguishes an unsupported or corrupt image from an unreadable QR code', async () => {
  stubImageSize(0, 0);
  reader.decodeFromImageElement.mockRejectedValue(new Error('Image load timed out'));

  await expect(decodeQrImage(new File([], 'google-authenticator.heic', { type: 'image/heic' })))
    .rejects.toThrow('Could not load image google-authenticator.heic');
  expect(reader.decodeFromCanvas).not.toHaveBeenCalled();
});
