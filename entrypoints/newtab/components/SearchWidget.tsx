import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { browser } from 'wxt/browser';
import { t } from '../../../core/browser/i18n';
import type { SearchHistorySource, SearchPreferences } from '../../../core/domain/types';
import type { SearchHistoryEntry } from '../../../core/search/history';
import { getHistoryForSource, recordSearchForSource } from '../../../core/search/history-provider';
import { fetchSearchSuggestions } from '../../../core/search/suggestions';
import { LensSearchPanel } from './LensSearchPanel';

type SuggestionItem = {
  value: string;
  source: 'history' | 'remote';
};

export function SearchWidget({ preferences, historySource }: { preferences: SearchPreferences; historySource: SearchHistorySource }) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const updateHistory = useCallback((entries: SearchHistoryEntry[]) => {
    // A history provider may resolve after a test/browser document has been
    // torn down. Avoid dispatching into React once its window is gone.
    if (mountedRef.current && typeof window !== 'undefined') setHistory(entries);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!preferences.historyEnabled) {
      setHistory([]);
      return () => { cancelled = true; };
    }
    void loadHistory(historySource, (entries) => {
      if (!cancelled) updateHistory(entries);
    });
    return () => { cancelled = true; };
  }, [historySource, preferences.historyEnabled, updateHistory]);

  useEffect(() => {
    setActiveIndex(-1);
    if (!open || !preferences.suggestionsEnabled || !query.trim()) {
      setRemoteSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchSearchSuggestions(query, controller.signal).then(setRemoteSuggestions).catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setRemoteSuggestions([]);
      });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, preferences.suggestionsEnabled, query]);

  const items = useMemo(() => buildSuggestionItems(query, preferences.historyEnabled ? history : [], remoteSuggestions), [history, preferences.historyEnabled, query, remoteSuggestions]);
  const suggestionsVisible = open && items.length > 0;
  const style = {
    '--search-width': `${Number((preferences.widthPercent * 0.8).toFixed(2))}vw`,
    '--search-background-alpha': String(preferences.backgroundOpacity / 100),
  } as React.CSSProperties;

  const search = async (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    if (preferences.historyEnabled) {
      const next = await recordSearchForSource(historySource, normalized);
      if (next) setHistory(next);
    }
    await browser.search.query({ text: normalized, disposition: 'CURRENT_TAB' });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search(items[activeIndex]?.value ?? query);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % items.length);
    } else if (event.key === 'ArrowUp' && items.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => index <= 0 ? items.length - 1 : index - 1);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className={`searchWidgetShell ${suggestionsVisible ? 'hasSuggestions' : ''} ${lensOpen ? 'lensOpen' : ''}`} style={style} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <form className="search" role="search" onSubmit={submit}>
        <button type="submit" className="searchSubmit" aria-label={t('submitSearch')} disabled={!query.trim()}>
          <SearchIcon />
        </button>
        <input
          ref={inputRef}
          className="searchInput"
          value={query}
          placeholder={t('searchGooglePrompt')}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); if (preferences.historyEnabled) void loadHistory(historySource, updateHistory); }}
          onKeyDown={onKeyDown}
          aria-label={t('searchPlaceholder')}
          aria-autocomplete="list"
          aria-expanded={open && items.length > 0}
          aria-controls="search-suggestions"
          aria-activedescendant={activeIndex >= 0 ? `search-suggestion-${activeIndex}` : undefined}
        />
        {query && <button type="button" className="searchClear" aria-label={t('clearSearchQuery')} onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(''); setActiveIndex(-1); inputRef.current?.focus(); }}>×</button>}
        <span className="googleSearchActions"><span aria-hidden="true"><VoiceIcon /></span><button type="button" className="lensOpenButton" aria-label={t('openLensSearch')} onClick={() => { setOpen(false); setLensOpen(true); }}><LensIcon /></button></span>
      </form>
      {suggestionsVisible && (
        <ul id="search-suggestions" className="searchSuggestions" role="listbox">
          {items.map((item, index) => (
            <li key={`${item.source}:${item.value}`} id={`search-suggestion-${index}`} role="option" aria-selected={index === activeIndex}>
              <button type="button" className={index === activeIndex ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => void search(item.value)}>
                <span className="suggestionIcon" aria-hidden="true">{item.source === 'history' ? <HistoryIcon /> : <SearchIcon />}</span><span>{item.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {lensOpen && <LensSearchPanel onClose={() => setLensOpen(false)} />}
    </div>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2" /><path d="m15.4 15.4 4.3 4.3" /></svg>;
}

function HistoryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v5h5" /><path d="M5.4 9.6a7.2 7.2 0 1 1-.2 4.9" /><path d="M12 8v4.3l3 1.8" /></svg>;
}

function VoiceIcon() {
  return <svg className="googleVoiceIcon" viewBox="0 0 24 24"><path fill="#4285f4" d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Z" /><path fill="#34a853" d="M6.5 11.5h2A3.5 3.5 0 0 0 12 15v2a5.5 5.5 0 0 1-5.5-5.5Z" /><path fill="#fbbc04" d="M17.5 11.5h-2A3.5 3.5 0 0 1 12 15v2a5.5 5.5 0 0 0 5.5-5.5Z" /><path fill="#ea4335" d="M11 17h2v4h-2z" /></svg>;
}

function LensIcon() {
  return <svg className="googleLensIcon" viewBox="0 0 24 24"><path fill="#4285f4" d="M7 3h3v2H7a2 2 0 0 0-2 2v3H3V7a4 4 0 0 1 4-4Zm7 0h3a4 4 0 0 1 4 4v3h-2V7a2 2 0 0 0-2-2h-3V3Z" /><path fill="#ea4335" d="M3 14h2v3a2 2 0 0 0 2 2h3v2H7a4 4 0 0 1-4-4v-3Z" /><path fill="#34a853" d="M19 14h2v3a4 4 0 0 1-4 4h-3v-2h3a2 2 0 0 0 2-2v-3Z" /><circle cx="12" cy="12" r="3.2" fill="#4285f4" /><circle cx="18.5" cy="15.5" r="1.5" fill="#fbbc04" /></svg>;
}

async function loadHistory(source: SearchHistorySource, update: (entries: SearchHistoryEntry[]) => void): Promise<void> {
  try {
    update(await getHistoryForSource(source));
  } catch {
    update([]);
  }
}

export function buildSuggestionItems(query: string, history: SearchHistoryEntry[], remote: string[]): SuggestionItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  const historyMatches = history.filter((entry) => !normalized || entry.query.toLocaleLowerCase().includes(normalized)).map((entry) => ({ value: entry.query, source: 'history' as const }));
  const candidates: SuggestionItem[] = [...historyMatches, ...remote.map((value) => ({ value, source: 'remote' as const }))];
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = item.value.toLocaleLowerCase();
    if (!item.value.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}
