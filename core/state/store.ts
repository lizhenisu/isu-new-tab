import { create } from 'zustand';
import { browser } from 'wxt/browser';
import type { AppConfig, SearchPreferences, Shortcut, SyncMode, Wallpaper } from '../domain/types';
import type { DesktopPlacement } from '../domain/desktop';
import type { WidgetPosition } from '../domain/widgets';
import { appRepositories } from '../storage/repository';
import { t } from '../browser/i18n';

type AppState = {
  config: AppConfig | null;
  appearancePreview: { blur?: number; search?: SearchPreferences };
  syncMode: SyncMode;
  loading: boolean;
  error?: string;
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  addGroup(name: string, position?: WidgetPosition): Promise<void>;
  updateGroup(id: string, name: string, collapsed: boolean): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  addShortcut(input: Pick<Shortcut, 'name' | 'url' | 'groupId'> & { position?: WidgetPosition }): Promise<void>;
  updateShortcut(id: string, input: Pick<Shortcut, 'name' | 'url' | 'groupId'>): Promise<void>;
  deleteShortcut(id: string): Promise<void>;
  moveShortcut(id: string, groupId: string, beforeId?: string, afterId?: string, position?: WidgetPosition): Promise<void>;
  moveGroup(id: string, beforeId?: string, afterId?: string): Promise<void>;
  applyDesktopPlacements(placements: DesktopPlacement[]): Promise<void>;
  updateAppearance<K extends keyof AppConfig['appearance']>(key: K, value: AppConfig['appearance'][K]['value']): Promise<void>;
  previewAppearance<K extends 'blur' | 'search'>(key: K, value: K extends 'blur' ? number : SearchPreferences): void;
  clearAppearancePreview(key: 'blur' | 'search'): void;
  setWallpaper(wallpaper: Wallpaper): Promise<void>;
  setSyncMode(mode: SyncMode): Promise<void>;
};

async function reload(set: (state: Partial<AppState>) => void): Promise<void> {
  set({ config: await appRepositories.config.getConfig(), syncMode: await appRepositories.sync.getSyncMode(), error: undefined });
}

async function scheduleSync(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'sync:schedule' }).catch(() => undefined);
}

export const useAppStore = create<AppState>((set) => ({
  config: null,
  appearancePreview: {},
  syncMode: 'chrome',
  loading: true,
  async initialize() {
    try {
      await appRepositories.config.initialize();
      await reload(set);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },
  async refresh() { await reload(set); },
  async addGroup(name, position) { await mutate(set, () => appRepositories.config.addGroup(name, position)); },
  async updateGroup(id, name, collapsed) { await mutate(set, () => appRepositories.config.updateGroup(id, { name, collapsed })); },
  async deleteGroup(id) { await mutate(set, () => appRepositories.config.deleteGroup(id)); },
  async addShortcut(input) { await mutate(set, () => appRepositories.config.addShortcut(input)); },
  async updateShortcut(id, input) { await mutate(set, () => appRepositories.config.updateShortcut(id, input)); },
  async deleteShortcut(id) { await mutate(set, () => appRepositories.config.deleteShortcut(id)); },
  async moveShortcut(id, groupId, beforeId, afterId, position) { await mutate(set, () => appRepositories.config.moveShortcut(id, groupId, beforeId, afterId, position)); },
  async moveGroup(id, beforeId, afterId) { await mutate(set, () => appRepositories.config.moveGroup(id, beforeId, afterId)); },
  async applyDesktopPlacements(placements) { await mutate(set, () => appRepositories.config.applyDesktopPlacements(placements)); },
  async updateAppearance(key, value) { await mutate(set, () => appRepositories.config.updateAppearance(key, value)); },
  previewAppearance(key, value) { set((state) => ({ appearancePreview: { ...state.appearancePreview, [key]: value } })); },
  clearAppearancePreview(key) {
    set((state) => {
      const next = { ...state.appearancePreview };
      delete next[key];
      return { appearancePreview: next };
    });
  },
  async setWallpaper(wallpaper) { await mutate(set, () => appRepositories.config.setWallpaper(wallpaper)); },
  async setSyncMode(mode) {
    try {
      await browser.runtime.sendMessage({ type: 'sync:set-mode', mode });
    } catch (error) {
      if (mode !== 'local' || !window.confirm(t('forceLocal'))) throw error;
      await browser.runtime.sendMessage({ type: 'sync:set-mode', mode, force: true });
    }
    await reload(set);
  },
}));

async function mutate(set: (state: Partial<AppState>) => void, operation: () => Promise<unknown>): Promise<void> {
  await operation();
  await reload(set);
  await scheduleSync();
}
