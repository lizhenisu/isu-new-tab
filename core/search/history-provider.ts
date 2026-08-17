import type { SearchHistorySource } from '../domain/types';
import { getChromeSearchHistory } from './chrome-history';
import { getSearchHistory, recordSearch, type SearchHistoryEntry } from './history';

export async function getHistoryForSource(source: SearchHistorySource): Promise<SearchHistoryEntry[]> {
  return source === 'chrome' ? getChromeSearchHistory() : getSearchHistory();
}

export async function recordSearchForSource(source: SearchHistorySource, query: string): Promise<SearchHistoryEntry[] | undefined> {
  if (source !== 'local') return undefined;
  return recordSearch(query);
}
