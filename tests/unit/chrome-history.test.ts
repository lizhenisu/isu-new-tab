import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import {
  clearChromeSearchHistoryCache,
  extractSearchQuery,
  getChromeSearchHistory,
  searchEntriesFromHistory,
} from '../../core/search/chrome-history';

type HistorySearch = (query: { text: string; startTime?: number; maxResults?: number }) => Promise<Browser.history.HistoryItem[]>;
const historySearch = vi.mocked(browser.history.search as unknown as HistorySearch);

beforeEach(() => {
  clearChromeSearchHistoryCache();
  historySearch.mockReset().mockResolvedValue([]);
});

describe('Chrome search history', () => {
  it('extracts queries from supported search engines', () => {
    expect(extractSearchQuery('https://www.google.com/search?q=chrome+extensions')).toBe('chrome extensions');
    expect(extractSearchQuery('https://www.google.co.uk/search?q=regional%20google')).toBe('regional google');
    expect(extractSearchQuery('https://www.bing.com/search?q=bing+query')).toBe('bing query');
    expect(extractSearchQuery('https://duckduckgo.com/?q=private+query')).toBe('private query');
    expect(extractSearchQuery('https://www.baidu.com/s?wd=%E6%90%9C%E7%B4%A2')).toBe('搜索');
    expect(extractSearchQuery('https://search.yahoo.com/search?p=yahoo+query')).toBe('yahoo query');
  });

  it('rejects unsupported, deceptive, malformed, and non-search URLs', () => {
    expect(extractSearchQuery('https://google.example/search?q=wrong')).toBeUndefined();
    expect(extractSearchQuery('https://example.com/?q=wrong')).toBeUndefined();
    expect(extractSearchQuery('https://search.yahoo.example/search?p=wrong')).toBeUndefined();
    expect(extractSearchQuery('https://www.google.com/maps?q=wrong')).toBeUndefined();
    expect(extractSearchQuery('javascript:alert(1)')).toBeUndefined();
    expect(extractSearchQuery('not a url')).toBeUndefined();
    expect(extractSearchQuery('https://www.google.com/search?q=')).toBeUndefined();
  });

  it('sorts, deduplicates, truncates, and limits parsed search entries', () => {
    const items = Array.from({ length: 24 }, (_, index) => ({
      id: String(index),
      url: `https://www.google.com/search?q=query-${index}`,
      lastVisitTime: index,
    }));
    items.push({ id: 'newest-duplicate', url: 'https://www.google.com/search?q=QUERY-23', lastVisitTime: 100 });
    items.push({ id: 'long', url: `https://www.bing.com/search?q=${'a'.repeat(600)}`, lastVisitTime: 99 });

    const entries = searchEntriesFromHistory(items);

    expect(entries).toHaveLength(20);
    expect(entries[0]).toMatchObject({ query: 'QUERY-23', searchedAt: new Date(100).toISOString() });
    expect(entries[1]?.query).toHaveLength(500);
    expect(entries.filter((entry) => entry.query.toLowerCase() === 'query-23')).toHaveLength(1);
  });

  it('queries 90 days of Chrome history and caches results for 30 seconds', async () => {
    historySearch.mockResolvedValue([{
      id: 'a', url: 'https://www.google.com/search?q=cached', lastVisitTime: Date.now(),
    }]);

    await expect(getChromeSearchHistory()).resolves.toMatchObject([{ query: 'cached' }]);
    await getChromeSearchHistory();

    expect(browser.history.search).toHaveBeenCalledTimes(1);
    expect(browser.history.search).toHaveBeenCalledWith(expect.objectContaining({ text: '', maxResults: 500 }));
  });
});
