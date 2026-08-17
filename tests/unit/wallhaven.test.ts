import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchWallhaven } from '../../core/wallpaper/wallhaven';

afterEach(() => vi.unstubAllGlobals());

describe('Wallhaven search', () => {
  it('requests SFW results and reuses the ten-minute cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'abc', url: 'https://wallhaven.cc/w/abc', thumbs: { large: 'https://th.wallhaven.cc/lg/abc.jpg' }, path: 'https://w.wallhaven.cc/full/ab/wallhaven-abc.jpg' }],
      meta: { current_page: 1, last_page: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await searchWallhaven('mountain-unique', 1, '101');
    const second = await searchWallhaven('mountain-unique', 1, '101');
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('purity=100');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('categories=101');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('sorting=relevance');
  });

  it('uses the latest listing instead of relevance sorting for an empty first page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'latest', url: 'https://wallhaven.cc/w/latest', thumbs: { large: 'https://th.wallhaven.cc/lg/la/latest.jpg' }, path: 'https://w.wallhaven.cc/full/la/wallhaven-latest.jpg' }],
      meta: { current_page: 1, last_page: 100 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchWallhaven('', 1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]![0]));

    expect(result.items).toHaveLength(1);
    expect(requestUrl.searchParams.get('sorting')).toBe('date_added');
    expect(requestUrl.searchParams.has('q')).toBe(false);
  });

  it('reports rate limiting without discarding caller state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(searchWallhaven('rate-limit-unique', 1)).rejects.toThrow('WALLHAVEN_RATE_LIMITED');
  });
});
