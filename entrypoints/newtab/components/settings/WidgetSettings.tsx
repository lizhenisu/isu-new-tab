import { t } from '../../../../core/browser/i18n';
import { createDefaultWidgetLayout, resolveWidgetLayout, type SystemWidgetId, type WidgetId, type WidgetLayout } from '../../../../core/domain/widgets';
import { useAppStore } from '../../../../core/state/store';
import { useEffect, useState } from 'react';
import { WIDGET_REGISTRY } from '../../widgets/registry';

export function WidgetSettings() {
  const storedLayout = useAppStore((state) => state.config!.appearance.widgetLayout.value);
  const updateAppearance = useAppStore((state) => state.updateAppearance);
  const [layout, setLayout] = useState(() => resolveWidgetLayout(storedLayout));
  useEffect(() => setLayout(resolveWidgetLayout(storedLayout)), [storedLayout]);

  const save = (next: WidgetLayout) => {
    const addShortcut = next.find((item) => item.id === 'addShortcut')
      ?? storedLayout.find((item) => item.id === 'addShortcut');
    const persisted = [...next.filter((item) => item.id !== 'addShortcut'), ...(addShortcut ? [addShortcut] : [])];
    setLayout(resolveWidgetLayout(persisted));
    return updateAppearance('widgetLayout', persisted);
  };
  const toggle = (id: WidgetId) => save(layout.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item));

  return (
    <section>
      <div className="settingsSectionHeader">
        <div><h3>{t('components')}</h3><p>{t('componentsDescription')}</p></div>
        <button type="button" className="secondary" onClick={() => void save(createDefaultWidgetLayout())}>{t('restoreDefault')}</button>
      </div>
      <ol className="widgetSettingsList">
        {layout.map((item) => {
          const label = t(WIDGET_REGISTRY[item.id as SystemWidgetId].labelKey);
          return (
            <li key={item.id}>
              <label className="widgetVisibility"><input type="checkbox" checked={item.enabled} onChange={() => void toggle(item.id)} /><span>{label}</span></label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
