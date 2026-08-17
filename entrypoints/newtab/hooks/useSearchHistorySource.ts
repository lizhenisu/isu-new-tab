import { useCallback, useEffect, useState } from 'react';
import type { SearchHistorySource } from '../../../core/domain/types';
import {
  resolveSearchHistorySource,
  selectSearchHistorySource,
  subscribeToHistoryPermissionRemoval,
} from '../../../core/search/history-source';

export function useSearchHistorySource() {
  const [source, setSource] = useState<SearchHistorySource>();

  useEffect(() => {
    let disposed = false;
    void resolveSearchHistorySource().then(
      (value) => { if (!disposed) setSource(value); },
      () => { if (!disposed) setSource('local'); },
    );
    const unsubscribe = subscribeToHistoryPermissionRemoval(() => { if (!disposed) setSource('local'); });
    return () => { disposed = true; unsubscribe(); };
  }, []);

  const selectSource = useCallback(async (value: SearchHistorySource) => {
    try {
      const accepted = await selectSearchHistorySource(value);
      if (accepted) setSource(value);
      return accepted;
    } catch (error) {
      console.error('Unable to update Chrome history permission', error);
      return false;
    }
  }, []);

  return { source, selectSource };
}
