import { browser } from 'wxt/browser';
import { MAX_SEARCH_HISTORY_ENTRIES, type SearchHistoryEntry } from './history';

const HISTORY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const HISTORY_CACHE_MS = 30_000;
const HISTORY_QUERY_LIMIT = 500;
let cache: { expiresAt: number; entries: SearchHistoryEntry[] } | undefined;
let pending: Promise<SearchHistoryEntry[]> | undefined;

export async function getChromeSearchHistory(): Promise<SearchHistoryEntry[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return structuredClone(cache.entries);
  if (pending) return structuredClone(await pending);
  const request = browser.history.search({
    text: '',
    startTime: now - HISTORY_WINDOW_MS,
    maxResults: HISTORY_QUERY_LIMIT,
  }).then((items) => {
    const entries = searchEntriesFromHistory(items);
    cache = { expiresAt: Date.now() + HISTORY_CACHE_MS, entries };
    return entries;
  });
  pending = request;
  try {
    return structuredClone(await request);
  } finally {
    if (pending === request) pending = undefined;
  }
}

export function searchEntriesFromHistory(items: Browser.history.HistoryItem[]): SearchHistoryEntry[] {
  const seen = new Set<string>();
  const entries: SearchHistoryEntry[] = [];
  const ordered = [...items].sort((left, right) => (right.lastVisitTime ?? 0) - (left.lastVisitTime ?? 0));
  for (const item of ordered) {
    const query = extractSearchQuery(item.url);
    if (!query) continue;
    const key = query.toLocaleLowerCase();
    if (seen.has(key)) continue;
    const visitedAt = new Date(item.lastVisitTime ?? 0);
    if (Number.isNaN(visitedAt.getTime())) continue;
    seen.add(key);
    entries.push({ query, searchedAt: visitedAt.toISOString() });
    if (entries.length === MAX_SEARCH_HISTORY_ENTRIES) break;
  }
  return entries;
}

export function extractSearchQuery(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const hostname = url.hostname.toLocaleLowerCase();
    let parameter: string | null = null;
    if (isGoogleHost(hostname) && url.pathname === '/search') parameter = url.searchParams.get('q');
    else if (isDomain(hostname, 'bing.com') && url.pathname === '/search') parameter = url.searchParams.get('q');
    else if (isDomain(hostname, 'duckduckgo.com') && (url.pathname === '/' || url.pathname === '/html/')) parameter = url.searchParams.get('q');
    else if (isDomain(hostname, 'baidu.com') && url.pathname === '/s') parameter = url.searchParams.get('wd') ?? url.searchParams.get('word');
    else if (isYahooSearchHost(hostname) && url.pathname === '/search') parameter = url.searchParams.get('p');
    const normalized = parameter?.trim().slice(0, 500);
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

export function clearChromeSearchHistoryCache(): void {
  cache = undefined;
  pending = undefined;
}

function isDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isGoogleHost(hostname: string): boolean {
  return /(^|\.)google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(hostname);
}

function isYahooSearchHost(hostname: string): boolean {
  return /^(?:[a-z]{2}\.)?search\.yahoo\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(hostname);
}
