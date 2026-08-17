import { z } from 'zod';
import { browser } from 'wxt/browser';

export type DailyQuoteLanguage = 'zh-CN' | 'en';

export type DailyQuote = {
  text: string;
  author?: string;
  source: 'hitokoto' | 'zenquotes';
  sourceLabel: string;
  sourceUrl: string;
};

type LoadOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const quoteSchema = z.object({
  text: z.string().trim().min(1).max(500),
  author: z.string().trim().min(1).max(160).optional(),
  source: z.enum(['hitokoto', 'zenquotes']),
  sourceLabel: z.string().trim().min(1).max(40),
  sourceUrl: z.string().url(),
});

const cacheSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quote: quoteSchema,
});

const hitokotoSchema = z.object({
  uuid: z.string().min(1).max(100),
  hitokoto: z.string().trim().min(1).max(500),
  from: z.string().trim().max(160).nullable().optional(),
  from_who: z.string().trim().max(160).nullable().optional(),
});

const zenQuotesSchema = z.array(z.object({
  q: z.string().trim().min(1).max(500),
  a: z.string().trim().min(1).max(160),
})).min(1);

const CACHE_PREFIX = 'isu:daily-quote:';

export async function getDailyQuote(language: DailyQuoteLanguage, now = new Date(), options: LoadOptions = {}): Promise<DailyQuote | undefined> {
  const cacheKey = `${CACHE_PREFIX}${language}`;
  const stored = await browser.storage.local.get(cacheKey);
  const cached = cacheSchema.safeParse(stored[cacheKey]);
  const date = localDateKey(now);
  if (cached.success && cached.data.date === date) return cached.data.quote;

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const quote = await fetchDailyQuote(language, options.fetcher ?? fetch, controller.signal);
    await browser.storage.local.set({ [cacheKey]: { date, quote } });
    return quote;
  } catch {
    return cached.success ? cached.data.quote : undefined;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function fetchDailyQuote(language: DailyQuoteLanguage, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<DailyQuote> {
  if (language === 'zh-CN') {
    const response = await fetcher('https://v1.hitokoto.cn/?encode=json&charset=utf-8&max_length=120', {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HITOKOTO_HTTP_${response.status}`);
    const value = hitokotoSchema.parse(await response.json());
    const author = uniqueText([value.from_who, value.from]).join(' · ') || undefined;
    return {
      text: value.hitokoto,
      ...(author ? { author } : {}),
      source: 'hitokoto',
      sourceLabel: '一言',
      sourceUrl: `https://hitokoto.cn/?uuid=${encodeURIComponent(value.uuid)}`,
    };
  }

  const response = await fetcher('https://zenquotes.io/api/today', {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`ZENQUOTES_HTTP_${response.status}`);
  const [value] = zenQuotesSchema.parse(await response.json());
  return {
    text: value!.q,
    author: value!.a,
    source: 'zenquotes',
    sourceLabel: 'ZenQuotes',
    sourceUrl: 'https://zenquotes.io/',
  };
}

function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
