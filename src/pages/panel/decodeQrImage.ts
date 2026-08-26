const QR_RETRY_SCALES = [0.75, 0.5, 0.375, 1.5, 2, 3];
const MIN_RETRY_EDGE = 240;
const MAX_RETRY_EDGE = 3072;

export async function decodeQrImage(file: File): Promise<string> {
  const { BrowserQRCodeReader } = await import('@zxing/browser');
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = imageUrl;
  try {
    const reader = new BrowserQRCodeReader();
    try {
      return (await reader.decodeFromImageElement(image)).getText();
    } catch {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (!width || !height) throw new Error(`Could not load image ${file.name}`);

      const longestEdge = Math.max(width, height);
      const attemptedEdges = new Set<number>();
      for (const scale of QR_RETRY_SCALES) {
        const targetEdge = Math.round(longestEdge * scale);
        if (targetEdge < MIN_RETRY_EDGE || targetEdge > MAX_RETRY_EDGE || attemptedEdges.has(targetEdge)) continue;
        attemptedEdges.add(targetEdge);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * targetEdge / longestEdge));
        canvas.height = Math.max(1, Math.round(height * targetEdge / longestEdge));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) continue;
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        try { return (await reader.decodeFromCanvas(canvas)).getText(); }
        catch { /* Try another resolution. */ }
      }
      throw new Error(`No readable QR code found in ${file.name}`);
    }
  } finally {
    URL.revokeObjectURL(imageUrl);
    image.removeAttribute('src');
  }
}
