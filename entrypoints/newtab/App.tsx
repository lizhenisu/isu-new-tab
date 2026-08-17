import { useEffect, useMemo, useState } from 'react';
import { t } from '../../core/browser/i18n';
import { DEFAULT_GROUP_ID, type Shortcut, type ShortcutGroup } from '../../core/domain/types';
import { DEFAULT_SOLID_WALLPAPER_COLOR } from '../../core/domain/defaults';
import { wallpaperTone } from '../../core/domain/wallpaper-tone';
import type { WidgetPosition } from '../../core/domain/widgets';
import { appRepositories } from '../../core/storage/repository';
import { useAppStore } from '../../core/state/store';
import { SettingsPanel } from './components/SettingsPanel';
import { ShortcutEditor } from './components/ShortcutEditor';
import { useSearchHistorySource } from './hooks/useSearchHistorySource';
import { useAppLanguage } from './hooks/useAppLanguage';
import type { DashboardWidgetContext } from './widgets/registry';
import { DashboardBoard } from './widgets/DashboardBoard';

export function App() {
  const config = useAppStore((state) => state.config);
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);
  const initialize = useAppStore((state) => state.initialize);
  const refresh = useAppStore((state) => state.refresh);
  const appearancePreview = useAppStore((state) => state.appearancePreview);
  const actions = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<Shortcut | { kind: 'new'; position?: WidgetPosition }>();
  const [clock, setClock] = useState(() => new Date());
  const searchHistory = useSearchHistorySource();
  const appLanguage = useAppLanguage();

  useEffect(() => { void initialize(); return appRepositories.config.subscribe(() => void refresh()); }, [initialize, refresh]);
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  const background = useWallpaperBackground(config?.appearance.wallpaper.value);

  if (loading || !config || !searchHistory.source || !appLanguage.language) return <div className="loading">{error ?? '…'}</div>;
  const theme = config.appearance.theme.value;
  const backgroundTone = wallpaperTone(config.appearance.wallpaper.value);

  const addGroup = async (position?: WidgetPosition) => {
    const name = window.prompt(t('name'))?.trim();
    if (name) await actions.addGroup(name, position);
  };
  const renameGroup = async (group: ShortcutGroup) => {
    const name = window.prompt(t('name'), group.name)?.trim();
    if (name) await actions.updateGroup(group.id, name, group.collapsed);
  };
  const widgetContext: DashboardWidgetContext = {
    now: clock,
    config,
    searchPreferences: appearancePreview.search ?? config.appearance.search.value,
    searchHistorySource: searchHistory.source,
    onAddShortcut: (position) => setEditing({ kind: 'new', position }),
    onAddGroup: (position) => { void addGroup(position); },
    onEditShortcut: setEditing,
    onDeleteShortcut: actions.deleteShortcut,
    onRenameGroup: (group) => { void renameGroup(group); },
    onDeleteGroup: async (group) => { if (window.confirm(t('confirmDeleteGroup'))) await actions.deleteGroup(group.id); },
    onMoveShortcut: actions.moveShortcut,
    onMoveGroup: actions.moveGroup,
  };

  return (
    <div className="app" data-theme={theme} data-wallpaper-tone={backgroundTone} data-size={config.appearance.cardSize.value} style={{ '--wallpaper': background, '--blur': `${appearancePreview.blur ?? config.appearance.blur.value}px` } as React.CSSProperties}>
      <div className="backdrop" />
      <button className="settingsButton" type="button" onClick={() => setSettingsOpen(true)} aria-label={t('settings')}>⚙</button>
      <div className="content">
        <DashboardBoard layout={config.appearance.widgetLayout.value} context={widgetContext}
          onPlacementsChange={actions.applyDesktopPlacements}
          onLayoutChange={(layout) => actions.updateAppearance('widgetLayout', layout)} />
        {config.appearance.wallpaper.value.type === 'unsplash' && <UnsplashAttribution wallpaper={config.appearance.wallpaper.value} />}
      </div>
      {editing && <ShortcutEditor shortcut={'kind' in editing ? undefined : editing} groups={config.groups} defaultGroupId={DEFAULT_GROUP_ID}
        onSave={(input) => 'kind' in editing ? actions.addShortcut({ ...input, ...(input.groupId === DEFAULT_GROUP_ID ? { position: editing.position } : {}) }) : actions.updateShortcut(editing.id, input)}
        onClose={() => setEditing(undefined)} />}
      {settingsOpen && <SettingsPanel language={appLanguage.language} onLanguageChange={appLanguage.selectLanguage} searchHistorySource={searchHistory.source} onSearchHistorySourceChange={searchHistory.selectSource} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function useWallpaperBackground(wallpaper?: NonNullable<ReturnType<typeof useAppStore.getState>['config']>['appearance']['wallpaper']['value']): string {
  const [localUrl, setLocalUrl] = useState<string>();
  const localAsset = wallpaper?.type === 'upload'
    ? { key: wallpaper.assetKey, identity: `upload:${wallpaper.assetKey}` }
    : wallpaper?.type === 'wallhaven'
      ? { key: 'wallpaper/wallhaven-current', identity: `wallhaven:${wallpaper.imageUrl}` }
      : undefined;
  useEffect(() => {
    let currentUrl: string | undefined;
    if (localAsset) appRepositories.assets.getAsset(localAsset.key).then((blob) => {
      if (!blob) return;
      currentUrl = URL.createObjectURL(blob);
      setLocalUrl(`url("${currentUrl}")`);
    });
    else setLocalUrl(undefined);
    return () => { if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [localAsset?.identity]);
  return useMemo(() => {
    if (!wallpaper) return DEFAULT_SOLID_WALLPAPER_COLOR;
    if (wallpaper.type === 'solid') return wallpaper.color;
    if (wallpaper.type === 'upload' || wallpaper.type === 'wallhaven') return localUrl ?? DEFAULT_SOLID_WALLPAPER_COLOR;
    if (wallpaper.type === 'unsplash') return `url("${wallpaper.imageUrl}")`;
    const gradients = {
      aurora: 'radial-gradient(circle at 15% 20%, #48d7a9 0, transparent 35%), radial-gradient(circle at 80% 30%, #605be9 0, transparent 38%), #111a34',
      dusk: 'linear-gradient(135deg, #4c1d4f, #c8555b 48%, #f5b56b)',
      ocean: 'linear-gradient(145deg, #061d33, #0c7690 55%, #61c0bf)',
    };
    return gradients[wallpaper.assetId as keyof typeof gradients] ?? gradients.aurora;
  }, [localUrl, wallpaper]);
}

function UnsplashAttribution({ wallpaper }: { wallpaper: Extract<NonNullable<ReturnType<typeof useAppStore.getState>['config']>['appearance']['wallpaper']['value'], { type: 'unsplash' }> }) {
  return <footer className="photoAttribution">{t('photoBy')} <a href={wallpaper.photographerUrl} target="_blank" rel="noreferrer">{wallpaper.photographerName}</a> / <a href={wallpaper.sourceUrl} target="_blank" rel="noreferrer">Unsplash</a></footer>;
}
