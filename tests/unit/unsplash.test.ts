import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchUnsplash, trackUnsplashDownload } from '../../core/wallpaper/unsplash';

afterEach(() => vi.unstubAllGlobals());

function photo(id = 'photo-a') {
  return {
    id,
    urls: {
      raw: `https://images.unsplash.com/${id}?ixid=existing`,
      small: `https://images.unsplash.com/${id}-small?ixid=existing`,
    },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `https://api.unsplash.com/photos/${id}/download?ixid=existing`,
    },
    user: { name: 'Photographer', links: { html: 'https://unsplash.com/@photographer' } },
  };
}

describe('Unsplash API', () => {
  it('searches landscape photos with Client-ID authentication and attribution data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [photo()], total_pages: 4 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchUnsplash('mountain-unique', 1, 'access-key');
    const [request, options] = fetchMock.mock.calls[0]!;
    const url = new URL(String(request));

    expect(url.pathname).toBe('/search/photos');
    expect(url.searchParams.get('content_filter')).toBe('high');
    expect(url.searchParams.get('orientation')).toBe('landscape');
    expect(options.headers.Authorization).toBe('Client-ID access-key');
    expect(result.items[0]).toEqual(expect.objectContaining({ photographerName: 'Photographer' }));
    expect(result.items[0]!.imageUrl).toContain('w=2560');
    expect(result.items[0]!.photographerUrl).toContain('utm_source=isu_new_tab');
  });

  it('uses the official editorial feed when no search term is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([photo('latest')]), {
      status: 200,
      headers: { link: '<https://api.unsplash.com/photos?page=7>; rel="last"' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchUnsplash('', 1, 'access-key');
    const url = new URL(String(fetchMock.mock.calls[0]![0]));

    expect(url.pathname).toBe('/photos');
    expect(url.searchParams.get('order_by')).toBe('latest');
    expect(result.lastPage).toBe(7);
  });

  it('tracks the download event before a photo is selected as wallpaper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await trackUnsplashDownload('https://api.unsplash.com/photos/photo-a/download?ixid=value', 'access-key');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'api.unsplash.com' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Client-ID access-key' }) }),
    );
  });

  it('rejects non-Unsplash download tracking URLs', async () => {
    await expect(trackUnsplashDownload('https://example.com/download', 'access-key')).rejects.toThrow('UNSPLASH_DOWNLOAD_URL_INVALID');
  });
});
