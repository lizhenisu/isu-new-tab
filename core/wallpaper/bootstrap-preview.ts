const STORAGE_KEY = 'isu:wallpaper-bootstrap-preview';
const MAX_BACKGROUND_LENGTH = 64 * 1024;

export type WallpaperBootstrapPreview = { identity: string; background: string };

export function getWallpaperBootstrapPreview(): WallpaperBootstrapPreview | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<WallpaperBootstrapPreview> | null;
    return value && typeof value.identity === 'string' && typeof value.background === 'string' && isSafeBackground(value.background)
      ? { identity: value.identity, background: value.background }
      : undefined;
  } catch {
    return undefined;
  }
}

export function setWallpaperBootstrapPreview(preview: WallpaperBootstrapPreview): void {
  if (!preview.identity || !isSafeBackground(preview.background)) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preview));
}

export async function createWallpaperBootstrapThumbnail(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob, { resizeWidth: 48, resizeHeight: 30, resizeQuality: 'low' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 30;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, 48, 30);
    return canvas.toDataURL('image/webp', .65);
  } finally {
    bitmap.close();
  }
}

function isSafeBackground(value: string): boolean {
  if (!value || value.length > MAX_BACKGROUND_LENGTH) return false;
  if (/^#[0-9a-f]{6}$/i.test(value) || /^data:image\/(?:webp|png|jpeg);base64,[a-z0-9+/=]+$/i.test(value)) return true;
  if (/^(?=(?:linear|radial)-gradient\()[#a-z0-9%(),.\s-]+$/i.test(value)) return true;
  const remote = /^url\("(https:\/\/[^"\\]+)"\)$/.exec(value)?.[1];
  if (!remote) return false;
  try {
    return new URL(remote).hostname === 'images.unsplash.com';
  } catch {
    return false;
  }
}
