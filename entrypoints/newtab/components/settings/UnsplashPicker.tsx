import { useEffect, useState } from 'react';
import { t } from '../../../../core/browser/i18n';
import {
  getUnsplashAccessKey,
  searchUnsplash,
  setUnsplashAccessKey,
  trackUnsplashDownload,
  type UnsplashPage,
  type UnsplashPhoto,
} from '../../../../core/wallpaper/unsplash';
import { errorMessage } from './error-message';

export function UnsplashPicker({ onSelect }: { onSelect(item: UnsplashPhoto): Promise<void> }) {
  const [accessKey, setAccessKey] = useState('');
  const [draftKey, setDraftKey] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<UnsplashPage>();
  const [error, setError] = useState('');

  useEffect(() => {
    getUnsplashAccessKey().then((value) => {
      setAccessKey(value);
      setDraftKey(value);
    });
  }, []);

  useEffect(() => {
    if (!accessKey) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setError('');
      searchUnsplash(query, page, accessKey, controller.signal).then(setResult).catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(errorMessage(reason));
      });
    }, 500);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [accessKey, page, query]);

  const saveKey = async () => {
    await setUnsplashAccessKey(draftKey);
    setAccessKey(draftKey.trim());
    setPage(1);
    setResult(undefined);
    setError('');
  };

  const select = async (item: UnsplashPhoto) => {
    try {
      setError('');
      await trackUnsplashDownload(item.downloadLocation, accessKey);
      await onSelect(item);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <div className="wallhavenPicker">
      <div className="unsplashCredential">
        <input type="password" autoComplete="off" value={draftKey} placeholder={t('unsplashAccessKey')} onChange={(event) => setDraftKey(event.target.value)} />
        <button type="button" className="secondary" onClick={saveKey}>{accessKey ? t('updateKey') : t('saveKey')}</button>
      </div>
      <small>{t('unsplashKeyLocalOnly')} <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noreferrer">{t('getUnsplashKey')}</a></small>
      {accessKey && <input value={query} placeholder={t('unsplashSearch')} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />}
      {error && <small className="errorText">{error}</small>}
      {result && !result.items.length && <small>{t('noWallpapers')}</small>}
      {result && <>
        <div className="wallhavenGrid unsplashGrid">{result.items.map((item) => <figure key={item.id}>
          <button type="button" onClick={() => select(item)}><img src={item.thumbnailUrl} alt="" loading="lazy" /></button>
          <figcaption>{t('photoBy')} <a href={item.photographerUrl} target="_blank" rel="noreferrer">{item.photographerName}</a> / <a href={item.sourceUrl} target="_blank" rel="noreferrer">Unsplash</a></figcaption>
        </figure>)}</div>
        <div className="pager"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t('previous')}</button><span>{page}/{result.lastPage}</span><button type="button" disabled={page >= result.lastPage} onClick={() => setPage((value) => value + 1)}>{t('next')}</button></div>
      </>}
    </div>
  );
}
