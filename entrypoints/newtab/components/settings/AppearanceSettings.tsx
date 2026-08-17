import { t } from '../../../../core/browser/i18n';
import { useAppStore } from '../../../../core/state/store';
import { useAppearancePreview } from './useAppearancePreview';
import { RangeInput } from './RangeInput';

export function AppearanceSettings() {
  const appearance = useAppStore((state) => state.config!.appearance);
  const updateAppearance = useAppStore((state) => state.updateAppearance);
  const [blur, setBlur] = useAppearancePreview('blur', appearance.blur.value);

  return (
    <section>
      <h3>{t('appearance')}</h3>
      <label>{t('theme')}<select value={appearance.theme.value} onChange={(event) => updateAppearance('theme', event.target.value as 'light' | 'dark' | 'system')}><option value="system">{t('system')}</option><option value="light">{t('light')}</option><option value="dark">{t('dark')}</option></select></label>
      <label>{t('blur')}<RangeInput min={0} max={40} value={blur} onChange={(event) => setBlur(Number(event.target.value))} /><output>{blur}px</output></label>
      <label>{t('cardSize')}<select value={appearance.cardSize.value} onChange={(event) => updateAppearance('cardSize', event.target.value as 'small' | 'medium' | 'large')}><option value="small">{t('small')}</option><option value="medium">{t('medium')}</option><option value="large">{t('large')}</option></select></label>
    </section>
  );
}
