import { useEffect, useRef, type FormEvent } from 'react';
import { t } from '../../../core/browser/i18n';

export function LensSearchPanel({ onClose }: { onClose(): void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const submit = (event: FormEvent) => event.preventDefault();

  return (
    <section className="lensSearchPanel" role="dialog" aria-labelledby="lens-search-title">
      <h2 id="lens-search-title">{t('lensSearchTitle')}</h2>
      <button type="button" className="lensClose" aria-label={t('close')} onClick={onClose}>×</button>
      <div className="lensDropZone" onDragOver={(event) => event.preventDefault()}>
        <div className="lensUploadPrompt">
          <LensUploadIcon />
          <span>{t('lensDropPrompt')}</span>
          <button type="button" onClick={() => fileInputRef.current?.click()}>{t('lensUploadFile')}</button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden />
        </div>
        <div className="lensDivider"><span>{t('lensOr')}</span></div>
        <form className="lensUrlForm" onSubmit={submit}>
          <input type="url" aria-label={t('lensPasteImageLink')} placeholder={t('lensPasteImageLink')} />
          <button type="submit">{t('lensSearchAction')}</button>
        </form>
      </div>
    </section>
  );
}

function LensUploadIcon() {
  return <svg className="lensUploadIcon" viewBox="0 0 72 56" aria-hidden="true">
    <path fill="#c5cbd3" d="M5 15h8v4H9v8H5V15Zm0 26V29h4v8h4v4H5Zm54-26h8v12h-4v-8h-4v-4Zm4 14h4v12h-8v-4h4v-8Z" />
    <path fill="#a8c7fa" d="M25 3h35v33H25z" />
    <circle cx="34" cy="13" r="4" fill="#fff" />
    <path fill="#669df6" d="m25 29 8-8 6 6 5-5 16 14H25z" />
  </svg>;
}
