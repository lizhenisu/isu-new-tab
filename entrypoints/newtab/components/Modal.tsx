import type { PropsWithChildren } from 'react';
import { t } from '../../../core/browser/i18n';

type ModalProps = PropsWithChildren<{
  title: string;
  onClose(): void;
  variant?: 'center' | 'drawer' | 'editor';
}>;

export function Modal({ title, onClose, children, variant = 'center' }: ModalProps) {
  return (
    <div className={`modalBackdrop modalBackdrop--${variant}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal modal--${variant}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modalHeader">
          <h2>{title}</h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
