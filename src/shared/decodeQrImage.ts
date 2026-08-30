const QR_RETRY_SCALES = [0.75, 0.5, 0.375, 1.5, 2, 3];
const MIN_RETRY_EDGE = 240;
const MAX_RETRY_EDGE = 3072;

async function decodeQrSource(source: string, description: string): Promise<string> {
  const { BrowserQRCodeReader } = await import('@zxing/browser');
  const image = new Image();
  image.src = source;
  try {
    const reader = new BrowserQRCodeReader();
    try {
      return (await reader.decodeFromImageElement(image)).getText();
    } catch {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (!width || !height) throw new Error(`Could not load image ${description}`);

      const longestEdge = Math.max(width, height);
      const attemptedEdges = new Set<number>();
      for (const scale of QR_RETRY_SCALES) {
        const targetEdge = Math.round(longestEdge * scale);
        if (targetEdge < MIN_RETRY_EDGE || targetEdge > MAX_RETRY_EDGE || attemptedEdges.has(targetEdge)) continue;
        attemptedEdges.add(targetEdge);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * targetEdge / longestEdge));
        canvas.height = Math.max(1, Math.round(height * targetEdge / longestEdge));
        try {
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) continue;
          context.imageSmoothingEnabled = false;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          try { return (await reader.decodeFromCanvas(canvas)).getText(); }
          catch { /* Try another resolution. */ }
        } finally {
          const context = canvas.getContext('2d');
          context?.clearRect(0, 0, canvas.width, canvas.height);
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      throw new Error(`No readable QR code found in ${description}`);
    }
  } finally {
    image.removeAttribute('src');
  }
}

export async function decodeQrImage(file: File): Promise<string> {
  const imageUrl = URL.createObjectURL(file);
  try {
    return await decodeQrSource(imageUrl, file.name);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function decodeQrDataUrl(dataUrl: string): Promise<string> {
  return decodeQrSource(dataUrl, 'captured page');
}
