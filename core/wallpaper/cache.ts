import { appRepositories } from '../storage/repository';
import type { AssetRepository } from '../storage/ports';

export async function cacheWallhavenImage(url: string, repository: AssetRepository = appRepositories.assets): Promise<void> {
  if (!url.startsWith('https://w.wallhaven.cc/')) throw new Error('WALLPAPER_URL_NOT_ALLOWED');
  const key = 'wallpaper/wallhaven-current';
  if ((await repository.getAssetRecord(key))?.sourceUrl === url) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`WALLPAPER_HTTP_${response.status}`);
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (declaredSize > 30 * 1024 * 1024) throw new Error('WALLPAPER_TOO_LARGE');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('WALLPAPER_RESPONSE_INVALID');
  if (blob.size > 30 * 1024 * 1024) throw new Error('WALLPAPER_TOO_LARGE');
  await repository.putAsset(key, blob, url);
}
