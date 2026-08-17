const MAX_EDGE = 2560;

export async function processWallpaperImage(source: Blob): Promise<Blob> {
  if (!source.type.startsWith('image/')) throw new Error('IMAGE_TYPE_NOT_ALLOWED');
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_UNAVAILABLE');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob) throw new Error('IMAGE_CONVERSION_FAILED');
    return blob;
  } finally {
    bitmap.close();
  }
}

export function hasWebpSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}
