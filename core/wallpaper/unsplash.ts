import { z } from 'zod';
import { browser } from 'wxt/browser';

const ACCESS_KEY_STORAGE_KEY = 'unsplashAccessKey';

const photoSchema = z.object({
  id: z.string().min(1),
  urls: z.object({
    raw: z.string().url().refine((url) => url.startsWith('https://images.unsplash.com/')),
    small: z.string().url().refine((url) => url.startsWith('https://images.unsplash.com/')),
  }),
  links: z.object({
    html: z.string().url().refine((url) => url.startsWith('https://unsplash.com/')),
    download_location: z.string().url().refine((url) => url.startsWith('https://api.unsplash.com/')),
  }),
  user: z.object({
    name: z.string().min(1),
    links: z.object({ html: z.string().url().refine((url) => url.startsWith('https://unsplash.com/')) }),
  }),
});

const searchResponseSchema = z.object({
  results: z.array(photoSchema),
  total_pages: z.number().int().nonnegative(),
});

export type UnsplashPhoto = {
  id: string;
  thumbnailUrl: string;
  imageUrl: string;
  sourceUrl: string;
  photographerName: string;
  photographerUrl: string;
  downloadLocation: string;
};

export type UnsplashPage = { items: UnsplashPhoto[]; page: number; lastPage: number };

const cache = new Map<string, { expiresAt: number; value: UnsplashPage }>();

/** Searches the official Unsplash API using public Client-ID authentication. */
export async function searchUnsplash(query: string, page: number, accessKey: string, signal?: AbortSignal): Promise<UnsplashPage> {
  const key = accessKey.trim();
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY_REQUIRED');
  const normalizedQuery = query.trim();
  const cacheKey = `${normalizedQuery}::${page}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const params = new URLSearchParams({ page: String(page), per_page: '24' });
  const endpoint = normalizedQuery ? 'search/photos' : 'photos';
  if (normalizedQuery) {
    params.set('query', normalizedQuery);
    params.set('content_filter', 'high');
    params.set('orientation', 'landscape');
  } else {
    params.set('order_by', 'latest');
  }
  const response = await fetch(`https://api.unsplash.com/${endpoint}?${params}`, {
    signal,
    headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
  });
  if (response.status === 401 || response.status === 403) throw new Error('UNSPLASH_ACCESS_KEY_INVALID');
  if (response.status === 429) throw new Error('UNSPLASH_RATE_LIMITED');
  if (!response.ok) throw new Error(`UNSPLASH_HTTP_${response.status}`);
  const value = normalizedQuery
    ? pageFromSearch(await response.json(), page)
    : pageFromListing(await response.json(), page, response.headers.get('link'));
  cache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, value });
  return value;
}

/** Reports the user action required when an Unsplash photo becomes a wallpaper. */
export async function trackUnsplashDownload(downloadLocation: string, accessKey: string): Promise<void> {
  const url = new URL(downloadLocation);
  if (url.origin !== 'https://api.unsplash.com') throw new Error('UNSPLASH_DOWNLOAD_URL_INVALID');
  const response = await fetch(url, {
    headers: { Authorization: `Client-ID ${accessKey.trim()}`, 'Accept-Version': 'v1' },
  });
  if (!response.ok) throw new Error(`UNSPLASH_DOWNLOAD_TRACKING_${response.status}`);
}

export async function getUnsplashAccessKey(): Promise<string> {
  const value = await browser.storage.local.get(ACCESS_KEY_STORAGE_KEY);
  return typeof value[ACCESS_KEY_STORAGE_KEY] === 'string' ? value[ACCESS_KEY_STORAGE_KEY] : '';
}

export async function setUnsplashAccessKey(accessKey: string): Promise<void> {
  const value = accessKey.trim();
  if (value) await browser.storage.local.set({ [ACCESS_KEY_STORAGE_KEY]: value });
  else await browser.storage.local.remove(ACCESS_KEY_STORAGE_KEY);
  cache.clear();
}

function pageFromSearch(input: unknown, page: number): UnsplashPage {
  const parsed = searchResponseSchema.parse(input);
  return { items: parsed.results.map(toPhoto), page, lastPage: parsed.total_pages };
}

function pageFromListing(input: unknown, page: number, linkHeader: string | null): UnsplashPage {
  const parsed = z.array(photoSchema).parse(input);
  return { items: parsed.map(toPhoto), page, lastPage: lastPageFromLink(linkHeader) ?? page + (parsed.length === 24 ? 1 : 0) };
}

function toPhoto(photo: z.infer<typeof photoSchema>): UnsplashPhoto {
  return {
    id: photo.id,
    thumbnailUrl: photo.urls.small,
    imageUrl: resizedImageUrl(photo.urls.raw),
    sourceUrl: attributionUrl(photo.links.html),
    photographerName: photo.user.name,
    photographerUrl: attributionUrl(photo.user.links.html),
    downloadLocation: photo.links.download_location,
  };
}

function resizedImageUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'crop');
  url.searchParams.set('w', '2560');
  url.searchParams.set('q', '85');
  return url.toString();
}

function attributionUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.set('utm_source', 'isu_new_tab');
  url.searchParams.set('utm_medium', 'referral');
  return url.toString();
}

function lastPageFromLink(value: string | null): number | undefined {
  const last = value?.split(',').find((part) => part.includes('rel="last"'))?.match(/[?&]page=(\d+)/)?.[1];
  return last ? Number(last) : undefined;
}
