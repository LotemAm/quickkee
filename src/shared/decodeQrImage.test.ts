import { decodeQrDataUrl, decodeQrImage } from './decodeQrImage';

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

let images: HTMLImageElement[];

function stubImageSize(width: number, height: number) {
  vi.stubGlobal('Image', function Image() {
    const image = document.createElement('img');
    Object.defineProperties(image, {
      naturalWidth: { value: width },
      naturalHeight: { value: height },
    });
    images.push(image);
    return image;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  images = [];
  stubImageSize(800, 800);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:qr-image'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => vi.restoreAllMocks());

test('decodes a file at original resolution and releases its object URL', async () => {
  reader.decodeFromImageElement.mockResolvedValue({ getText: () => 'decoded' });

  await expect(decodeQrImage(new File([], 'auth.png', { type: 'image/png' }))).resolves.toBe('decoded');

  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr-image');
  expect(images[0].hasAttribute('src')).toBe(false);
  expect(reader.decodeFromCanvas).not.toHaveBeenCalled();
});

test('decodes a capture data URL through resize retries and clears temporary image resources', async () => {
  const attemptedWidths: number[] = [];
  reader.decodeFromImageElement.mockRejectedValue(new Error('No QR code found'));
  reader.decodeFromCanvas.mockImplementation(async (canvas: HTMLCanvasElement) => {
    attemptedWidths.push(canvas.width);
    if (canvas.width === 1200) return { getText: () => 'otpauth://totp/Example' };
    throw new Error('No QR code found');
  });

  await expect(decodeQrDataUrl('data:image/png;base64,capture')).resolves.toBe('otpauth://totp/Example');

  expect(attemptedWidths).toEqual([600, 400, 300, 1200]);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(images[0].hasAttribute('src')).toBe(false);
  for (const [canvas] of reader.decodeFromCanvas.mock.calls) {
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  }
});

test('cleans up and reports an unreadable captured page without exposing its data URL', async () => {
  reader.decodeFromImageElement.mockRejectedValue(new Error('No QR code found'));
  reader.decodeFromCanvas.mockRejectedValue(new Error('No QR code found'));

  await expect(decodeQrDataUrl('data:image/png;base64,private-capture'))
    .rejects.toThrow('No readable QR code found in captured page');

  expect(images[0].hasAttribute('src')).toBe(false);
  for (const [canvas] of reader.decodeFromCanvas.mock.calls) {
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  }
});

test('distinguishes an unsupported file from an unreadable QR code', async () => {
  stubImageSize(0, 0);
  reader.decodeFromImageElement.mockRejectedValue(new Error('Image load timed out'));

  await expect(decodeQrImage(new File([], 'google-authenticator.heic', { type: 'image/heic' })))
    .rejects.toThrow('Could not load image google-authenticator.heic');
  expect(reader.decodeFromCanvas).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr-image');
});
