import { z } from 'zod';

const suggestionResponseSchema = z.array(z.unknown()).min(2);

export async function fetchSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('client', 'chrome');
  url.searchParams.set('q', normalized);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`SEARCH_SUGGESTIONS_HTTP_${response.status}`);
  const parsed = suggestionResponseSchema.parse(await response.json());
  return z.array(z.string()).parse(parsed[1]).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}
