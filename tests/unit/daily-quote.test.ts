import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fetchDailyQuote, getDailyQuote, type DailyQuote } from '../../core/quote/daily-quote';

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const mockLocalGet = (value: Record<string, unknown>) => {
  const get = browser.storage.local.get as unknown as { mockResolvedValueOnce(result: Record<string, unknown>): void };
  get.mockResolvedValueOnce(value);
};

afterEach(() => vi.clearAllMocks());

describe('daily quote providers', () => {
  it('maps the Chinese Hitokoto response and constructs its attribution link', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      uuid: 'quote-id',
      hitokoto: '生活明朗，万物可爱。',
      from: '一言句集',
      from_who: '作者',
    }));

    await expect(fetchDailyQuote('zh-CN', fetcher as typeof fetch)).resolves.toEqual({
      text: '生活明朗，万物可爱。',
      author: '作者 · 一言句集',
      source: 'hitokoto',
      sourceLabel: '一言',
      sourceUrl: 'https://hitokoto.cn/?uuid=quote-id',
    });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('https://v1.hitokoto.cn/'), expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  it('maps the English ZenQuotes response without rendering remote HTML', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([{ q: 'Stay curious.', a: 'Example Author', h: '<script>alert(1)</script>' }]));

    await expect(fetchDailyQuote('en', fetcher as typeof fetch)).resolves.toEqual({
      text: 'Stay curious.',
      author: 'Example Author',
      source: 'zenquotes',
      sourceLabel: 'ZenQuotes',
      sourceUrl: 'https://zenquotes.io/',
    });
  });

  it('uses the same-day local cache without making another API request', async () => {
    const quote: DailyQuote = {
      text: 'Cached quote',
      author: 'Author',
      source: 'zenquotes',
      sourceLabel: 'ZenQuotes',
      sourceUrl: 'https://zenquotes.io/',
    };
    mockLocalGet({
      'isu:daily-quote:en': { date: '2026-08-16', quote },
    });
    const fetcher = vi.fn();

    await expect(getDailyQuote('en', new Date(2026, 7, 16, 12), { fetcher: fetcher as typeof fetch })).resolves.toEqual(quote);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to the most recent valid cache when the provider fails', async () => {
    const quote: DailyQuote = {
      text: 'Previous quote',
      source: 'hitokoto',
      sourceLabel: '一言',
      sourceUrl: 'https://hitokoto.cn/?uuid=previous',
    };
    mockLocalGet({
      'isu:daily-quote:zh-CN': { date: '2026-08-15', quote },
    });
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(getDailyQuote('zh-CN', new Date(2026, 7, 16, 12), { fetcher: fetcher as typeof fetch })).resolves.toEqual(quote);
  });
});
