import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { browser } from 'wxt/browser';
import { t } from '../../../../core/browser/i18n';
import { useAppStore } from '../../../../core/state/store';
import { appRepositories } from '../../../../core/storage/repository';
import { processWallpaperImage } from '../../../../core/wallpaper/image';
import { searchWallhaven, type WallhavenPage } from '../../../../core/wallpaper/wallhaven';
import { DEFAULT_SOLID_WALLPAPER_COLOR } from '../../../../core/domain/defaults';
import { errorMessage } from './error-message';
import { UnsplashPicker } from './UnsplashPicker';

export function WallpaperSettings() {
  const wallpaper = useAppStore((state) => state.config!.appearance.wallpaper.value);
  const setWallpaper = useAppStore((state) => state.setWallpaper);
  const refresh = useAppStore((state) => state.refresh);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [onlineSource, setOnlineSource] = useState<'wallhaven' | 'unsplash'>('wallhaven');

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const image = await processWallpaperImage(file);
      await appRepositories.assets.setUploadedWallpaper(image);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      event.target.value = '';
    }
  };

  return (
    <section>
      <h3>{t('wallpaper')}</h3>
      <div className="wallpaperChoices">
        <label className={`colorChoice ${wallpaper.type === 'solid' ? 'active' : ''}`}>{t('solid')}<input type="color" value={wallpaper.type === 'solid' ? wallpaper.color : DEFAULT_SOLID_WALLPAPER_COLOR} onChange={(event) => setWallpaper({ type: 'solid', color: event.target.value })} /></label>
        {['aurora', 'dusk', 'ocean'].map((assetId) => <button key={assetId} type="button" aria-pressed={wallpaper.type === 'builtin' && wallpaper.assetId === assetId} className={`builtinPreview ${assetId} ${wallpaper.type === 'builtin' && wallpaper.assetId === assetId ? 'active' : ''}`} onClick={() => setWallpaper({ type: 'builtin', assetId })}>{t(assetId)}</button>)}
        <button type="button" className={`secondary wallpaperUploadChoice ${wallpaper.type === 'upload' ? 'active' : ''}`} aria-pressed={wallpaper.type === 'upload'} onClick={() => fileInput.current?.click()}>{t('upload')}</button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={upload} />
      </div>
      <label>{t('onlineSource')}<select value={onlineSource} onChange={(event) => setOnlineSource(event.target.value as 'wallhaven' | 'unsplash')}><option value="wallhaven">Wallhaven</option><option value="unsplash">Unsplash</option></select></label>
      {onlineSource === 'wallhaven'
        ? <WallhavenPicker onSelect={async (item) => {
          await browser.runtime.sendMessage({ type: 'wallpaper:cache', url: item.path });
          await setWallpaper({ type: 'wallhaven', imageUrl: item.path, sourceUrl: item.url, wallpaperId: item.id });
        }} />
        : <UnsplashPicker onSelect={(item) => setWallpaper({
          type: 'unsplash',
          imageUrl: item.imageUrl,
          sourceUrl: item.sourceUrl,
          photoId: item.id,
          photographerName: item.photographerName,
          photographerUrl: item.photographerUrl,
        })} />}
      <WallpaperStatus />
      {error && <p className="errorText" role="alert">{error}</p>}
    </section>
  );
}

function WallhavenPicker({ onSelect }: { onSelect(item: WallhavenPage['items'][number]): Promise<void> }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<WallhavenPage>();
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [categories, setCategories] = useState([true, true, true]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      searchWallhaven(query, page, categories.map((item) => item ? '1' : '0').join(''), controller.signal).then(setResult).catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(errorMessage(reason));
      });
    }, 500);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [categories, enabled, page, query]);

  const select = async (item: WallhavenPage['items'][number]) => {
    try {
      setError('');
      await onSelect(item);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <div className="wallhavenPicker">
      <input value={query} placeholder={t('wallhavenSearch')} onFocus={() => setEnabled(true)} onChange={(event) => { setEnabled(true); setQuery(event.target.value); setPage(1); }} />
      <div className="categoryChoices">{(['general', 'anime', 'people'] as const).map((name, index) => <label key={name}><input type="checkbox" checked={categories[index]} onChange={(event) => setCategories((current) => {
        if (!event.target.checked && current.filter(Boolean).length === 1) return current;
        return current.map((value, itemIndex) => itemIndex === index ? event.target.checked : value);
      })} />{t(name)}</label>)}</div>
      {error && <small className="errorText">{error}</small>}
      {result && !result.items.length && <small>{t('noWallpapers')}</small>}
      {result && <><div className="wallhavenGrid">{result.items.map((item) => <button type="button" key={item.id} onClick={() => select(item)}><img src={item.thumbs.large} alt="" loading="lazy" /></button>)}</div><div className="pager"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t('previous')}</button><span>{page}/{result.lastPage}</span><button type="button" disabled={page >= result.lastPage} onClick={() => setPage((value) => value + 1)}>{t('next')}</button></div></>}
    </div>
  );
}

function WallpaperStatus() {
  const wallpaper = useAppStore((state) => state.config?.appearance.wallpaper.value);
  const [status, setStatus] = useState<{ state?: string; message?: string }>();
  useEffect(() => {
    browser.storage.local.get('wallpaperStatus').then((value) => setStatus(value.wallpaperStatus as typeof status));
    const listener = (changes: Record<string, Browser.storage.StorageChange>) => {
      if (changes.wallpaperStatus) setStatus(changes.wallpaperStatus.newValue as typeof status);
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => browser.storage.local.onChanged.removeListener(listener);
  }, []);
  if (status?.state !== 'error' || wallpaper?.type !== 'wallhaven') return null;
  return <div className="wallpaperStatus"><small className="errorText">{status.message}</small><button type="button" className="secondary" onClick={() => browser.runtime.sendMessage({ type: 'wallpaper:cache', url: wallpaper.imageUrl })}>{t('retry')}</button></div>;
}
