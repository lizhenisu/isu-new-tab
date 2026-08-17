import { getDatabase } from '../storage/database';

export type SearchHistoryEntry = {
  query: string;
  searchedAt: string;
};

export const MAX_SEARCH_HISTORY_ENTRIES = 20;

export async function getSearchHistory(): Promise<SearchHistoryEntry[]> {
  const value = await (await getDatabase()).get('settings', 'searchHistory');
  return Array.isArray(value) ? value.slice(0, MAX_SEARCH_HISTORY_ENTRIES) as SearchHistoryEntry[] : [];
}

export async function recordSearch(query: string): Promise<SearchHistoryEntry[]> {
  const normalized = query.trim().slice(0, 500);
  if (!normalized) return getSearchHistory();
  const history = await getSearchHistory();
  const next = [
    { query: normalized, searchedAt: new Date().toISOString() },
    ...history.filter((entry) => entry.query.toLocaleLowerCase() !== normalized.toLocaleLowerCase()),
  ].slice(0, MAX_SEARCH_HISTORY_ENTRIES);
  await (await getDatabase()).put('settings', next, 'searchHistory');
  return next;
}

export async function clearSearchHistory(): Promise<void> {
  await (await getDatabase()).delete('settings', 'searchHistory');
}
