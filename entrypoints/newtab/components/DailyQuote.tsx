import { useEffect, useMemo, useState } from 'react';
import { currentLanguageTag, t } from '../../../core/browser/i18n';
import { getDailyQuote, type DailyQuote as DailyQuoteValue, type DailyQuoteLanguage } from '../../../core/quote/daily-quote';

export function DailyQuote({ now }: { now: Date }) {
  const language: DailyQuoteLanguage = currentLanguageTag() === 'zh-CN' ? 'zh-CN' : 'en';
  const date = useMemo(() => `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`, [now]);
  const [quote, setQuote] = useState<DailyQuoteValue>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setQuote(undefined);
    setLoading(true);
    void getDailyQuote(language, now).then((value) => {
      if (!active) return;
      setQuote(value);
      setLoading(false);
    });
    return () => { active = false; };
  }, [date, language]);

  return (
    <figure className="dailyQuote">
      <blockquote>{quote?.text ?? t(loading ? 'dailyQuoteLoading' : 'dailyQuoteUnavailable')}</blockquote>
      {quote && <figcaption>
        {quote.author && <span>— {quote.author} · </span>}
        <a href={quote.sourceUrl} target="_blank" rel="noreferrer">{quote.sourceLabel}</a>
      </figcaption>}
    </figure>
  );
}
