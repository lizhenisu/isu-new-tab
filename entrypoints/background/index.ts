import { browser } from 'wxt/browser';
import { appRepositories } from '../../core/storage/repository';
import { ChromeSyncAdapter } from '../../core/sync/chrome-adapter';
import { SyncCoordinator } from '../../core/sync/coordinator';
import { BrowserSyncStatusStore } from '../../core/sync/status-store';
import { cacheWallhavenImage } from '../../core/wallpaper/cache';
import type { AppConfig, AppLanguage } from '../../core/domain/types';
import { refreshDesktopContextMenus, registerDesktopContextMenus } from '../../core/browser/context-menu-controller';
import { getAppLanguagePreference } from '../../core/browser/language-preference';
import { setAppLanguage } from '../../core/browser/i18n';

const syncCoordinator = new SyncCoordinator({
  adapter: new ChromeSyncAdapter(),
  repository: appRepositories.sync,
  statusStore: new BrowserSyncStatusStore(),
  providerMode: 'chrome',
  refreshWallpaper: refreshWallhavenCache,
});

export default defineBackground(() => {
  registerDesktopContextMenus();
  void getAppLanguagePreference().then(async (language) => {
    setAppLanguage(language);
    await refreshDesktopContextMenus();
  });
  void appRepositories.config.initialize().then(() => syncCoordinator.run());

  browser.runtime.onMessage.addListener((message: unknown) => {
    const request = message as { type?: string; mode?: 'local' | 'chrome'; force?: boolean; choice?: 'local-overwrite' | 'remote-replace' | 'external-import'; url?: string; language?: AppLanguage };
    if (request.type === 'sync:schedule') syncCoordinator.schedule();
    if (request.type === 'sync:set-mode' && request.mode) {
      return syncCoordinator.setMode(request.mode, request.force);
    }
    if (request.type === 'sync:resolve' && request.choice) return syncCoordinator.resolveConflict(request.choice);
    if (request.type === 'wallpaper:cache' && request.url) return cacheWallpaperWithStatus(request.url);
    if (request.type === 'language:set' && request.language) {
      setAppLanguage(request.language);
      return refreshDesktopContextMenus();
    }
    return undefined;
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && Object.keys(changes).some((key) => key.startsWith('sync/'))) syncCoordinator.schedule(0);
  });
});

async function cacheWallpaperWithStatus(url: string): Promise<void> {
  try {
    await cacheWallhavenImage(url);
    await browser.storage.local.remove('wallpaperStatus');
  } catch (error) {
    await browser.storage.local.set({ wallpaperStatus: { state: 'error', message: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

async function refreshWallhavenCache(config: AppConfig): Promise<void> {
  const wallpaper = config.appearance.wallpaper.value;
  if (wallpaper.type !== 'wallhaven') return;
  try {
    await cacheWallpaperWithStatus(wallpaper.imageUrl);
  } catch {
    // The status is already persisted for the UI; sync must not fail on a cache miss.
  }
}
