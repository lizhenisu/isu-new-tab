import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { DEFAULT_SEARCH_PREFERENCES, createDeviceIdentity, createInitialConfig } from '../../core/domain/defaults';
import { appConfigSchema, syncEnvelopeSchema } from '../../core/domain/schema';
import { clearSearchHistory, getSearchHistory, recordSearch } from '../../core/search/history';
import { clearChromeSearchHistoryCache } from '../../core/search/chrome-history';
import { fetchSearchSuggestions } from '../../core/search/suggestions';
import { createEnvelope } from '../../core/sync/engine';
import { SearchWidget, buildSuggestionItems } from '../../entrypoints/newtab/components/SearchWidget';

type HistorySearch = (query: { text: string; startTime?: number; maxResults?: number }) => Promise<Browser.history.HistoryItem[]>;
const historySearch = vi.mocked(browser.history.search as unknown as HistorySearch);

afterEach(async () => {
  cleanup();
  await clearSearchHistory();
  clearChromeSearchHistoryCache();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('search experience', () => {
  it('adds search preferences to older local and remote data', () => {
    const config = createInitialConfig(createDeviceIdentity());
    const oldConfig = structuredClone(config) as Record<string, unknown> & { appearance: Record<string, unknown> };
    delete oldConfig.appearance.search;
    expect(appConfigSchema.parse(oldConfig).appearance.search.value).toEqual(DEFAULT_SEARCH_PREFERENCES);

    const envelope = createEnvelope(config, { tombstones: [] }, { counter: 2, deviceId: 'remote' }, 0);
    const oldEnvelope = structuredClone(envelope) as unknown as { config: { appearance: Record<string, unknown> } };
    delete oldEnvelope.config.appearance.search;
    expect(syncEnvelopeSchema.parse(oldEnvelope).config.appearance.search.value).toEqual(DEFAULT_SEARCH_PREFERENCES);
  });

  it('stores only the 20 newest unique local history entries', async () => {
    for (let index = 0; index < 22; index += 1) await recordSearch(`query ${index}`);
    await recordSearch('QUERY 21');
    const history = await getSearchHistory();
    expect(history).toHaveLength(20);
    expect(history[0]?.query).toBe('QUERY 21');
    expect(history.filter((entry) => entry.query.toLowerCase() === 'query 21')).toHaveLength(1);
    expect(history.some((entry) => entry.query === 'query 0')).toBe(false);
  });

  it('deduplicates local history and remote suggestions with history first', () => {
    expect(buildSuggestionItems('co', [
      { query: 'Codex', searchedAt: new Date().toISOString() },
      { query: 'Chrome', searchedAt: new Date().toISOString() },
    ], ['codex', 'coding'])).toEqual([
      { value: 'Codex', source: 'history' },
      { value: 'coding', source: 'remote' },
    ]);
  });

  it('requests and validates Google suggestions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(['cod', ['codex', 'coding']]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSearchSuggestions(' cod ')).resolves.toEqual(['codex', 'coding']);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('q')).toBe('cod');
  });

  it('applies visual preferences and records a submitted query before searching', async () => {
    render(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, widthPercent: 70, backgroundOpacity: 40, suggestionsEnabled: false }} historySource="local" />);
    const shell = screen.getByRole('search').parentElement!;
    expect(screen.getByLabelText('searchPlaceholder')).toHaveAttribute('placeholder', 'searchGooglePrompt');
    expect(screen.getByRole('search').firstElementChild).toHaveClass('searchSubmit');
    expect(screen.getByRole('search').querySelectorAll('.googleSearchActions svg')).toHaveLength(2);
    expect(shell.style.getPropertyValue('--search-width')).toBe('56vw');
    expect(shell.style.getPropertyValue('--search-background-alpha')).toBe('0.4');
    fireEvent.change(screen.getByLabelText('searchPlaceholder'), { target: { value: 'Chrome extensions' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(browser.search.query).toHaveBeenCalledWith({ text: 'Chrome extensions', disposition: 'CURRENT_TAB' }));
    expect((await getSearchHistory())[0]?.query).toBe('Chrome extensions');
  });

  it('maps the new 25%–100% range to a 20vw–80vw visual width', () => {
    const { rerender } = render(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, widthPercent: 25, suggestionsEnabled: false }} historySource="local" />);
    const shell = screen.getByRole('search').parentElement!;
    expect(shell.style.getPropertyValue('--search-width')).toBe('20vw');

    rerender(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, widthPercent: 50, suggestionsEnabled: false }} historySource="local" />);
    expect(shell.style.getPropertyValue('--search-width')).toBe('40vw');
    rerender(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, widthPercent: 100, suggestionsEnabled: false }} historySource="local" />);
    expect(shell.style.getPropertyValue('--search-width')).toBe('80vw');
  });

  it('opens and closes the Lens search panel without changing the search query', () => {
    render(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, suggestionsEnabled: false }} historySource="local" />);
    const input = screen.getByLabelText('searchPlaceholder');
    fireEvent.change(input, { target: { value: 'keep this query' } });

    fireEvent.click(screen.getByLabelText('openLensSearch'));
    expect(screen.getByRole('dialog', { name: 'lensSearchTitle' })).toBeInTheDocument();
    expect(screen.getByLabelText('lensPasteImageLink')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('close'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input).toHaveValue('keep this query');
  });

  it('does not retain a submitted query when history is disabled', async () => {
    render(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, historyEnabled: false, suggestionsEnabled: false }} historySource="local" />);
    fireEvent.change(screen.getByLabelText('searchPlaceholder'), { target: { value: 'private search' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(browser.search.query).toHaveBeenCalled());
    expect(await getSearchHistory()).toEqual([]);
  });

  it('reads Chrome history without writing or falling back to local history', async () => {
    await recordSearch('local-only phrase');
    historySearch.mockResolvedValueOnce([{
      id: 'remote', url: 'https://www.google.com/search?q=synced+phrase', lastVisitTime: Date.now(),
    }]);
    render(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, suggestionsEnabled: false }} historySource="chrome" />);
    const input = screen.getByLabelText('searchPlaceholder');
    fireEvent.focus(input);
    await waitFor(() => expect(historySearch).toHaveBeenCalled());
    await screen.findByRole('option', { name: /synced phrase/ });
    fireEvent.change(input, { target: { value: 'new Chrome search' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(browser.search.query).toHaveBeenCalledWith({ text: 'new Chrome search', disposition: 'CURRENT_TAB' }));
    expect(await getSearchHistory()).toMatchObject([{ query: 'local-only phrase' }]);
    expect(screen.queryByRole('option', { name: /local-only phrase/ })).toBeNull();
  });

  it('shows no history when Chrome history fails instead of using local records', async () => {
    await recordSearch('must stay local');
    historySearch.mockRejectedValueOnce(new Error('HISTORY_UNAVAILABLE'));
    render(<SearchWidget preferences={{ ...DEFAULT_SEARCH_PREFERENCES, suggestionsEnabled: false }} historySource="chrome" />);
    const input = screen.getByLabelText('searchPlaceholder');
    fireEvent.focus(input);
    await waitFor(() => expect(historySearch).toHaveBeenCalled());
    fireEvent.change(input, { target: { value: 'must stay local' } });
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
  });
});
