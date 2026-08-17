import { browser } from 'wxt/browser';
import type { SearchHistorySource } from '../domain/types';
import { getDatabase } from '../storage/database';

const HISTORY_PERMISSION: Browser.permissions.Permissions = { permissions: ['history'] };

export async function getSearchHistorySource(): Promise<SearchHistorySource> {
  const value = await (await getDatabase()).get('settings', 'searchHistorySource');
  return value === 'chrome' ? 'chrome' : 'local';
}

export async function resolveSearchHistorySource(): Promise<SearchHistorySource> {
  const source = await getSearchHistorySource();
  if (source !== 'chrome' || await browser.permissions.contains(HISTORY_PERMISSION)) return source;
  await persistSearchHistorySource('local');
  return 'local';
}

export async function selectSearchHistorySource(source: SearchHistorySource): Promise<boolean> {
  if (source === 'chrome') {
    const granted = await browser.permissions.request(HISTORY_PERMISSION);
    if (!granted) return false;
  } else {
    await browser.permissions.remove(HISTORY_PERMISSION);
  }
  await persistSearchHistorySource(source);
  return true;
}

export function subscribeToHistoryPermissionRemoval(onRemoved: () => void): () => void {
  const listener = (permissions: Browser.permissions.Permissions) => {
    if (!permissions.permissions?.includes('history')) return;
    void persistSearchHistorySource('local').then(onRemoved).catch(() => onRemoved());
  };
  browser.permissions.onRemoved.addListener(listener);
  return () => browser.permissions.onRemoved.removeListener(listener);
}

async function persistSearchHistorySource(source: SearchHistorySource): Promise<void> {
  await (await getDatabase()).put('settings', source, 'searchHistorySource');
}
