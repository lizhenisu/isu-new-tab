import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { createInitialConfig } from '../../core/domain/defaults';
import {
  getSearchHistorySource,
  resolveSearchHistorySource,
  selectSearchHistorySource,
  subscribeToHistoryPermissionRemoval,
} from '../../core/search/history-source';
import { getDatabase } from '../../core/storage/database';
import { appRepositories } from '../../core/storage/repository';
import { useAppStore } from '../../core/state/store';
import { SearchSettings } from '../../entrypoints/newtab/components/settings/SearchSettings';

const originalState = useAppStore.getState();
type PermissionMethod = (permissions: Browser.permissions.Permissions) => Promise<boolean>;
const containsPermission = vi.mocked(browser.permissions.contains as unknown as PermissionMethod);
const requestPermission = vi.mocked(browser.permissions.request as unknown as PermissionMethod);
const removePermission = vi.mocked(browser.permissions.remove as unknown as PermissionMethod);

beforeEach(async () => {
  await (await getDatabase()).delete('settings', 'searchHistorySource');
  containsPermission.mockReset().mockResolvedValue(false);
  requestPermission.mockReset().mockResolvedValue(true);
  removePermission.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  useAppStore.setState(originalState, true);
  vi.clearAllMocks();
});

describe('search history source', () => {
  it('requests optional permission before persisting Chrome history mode', async () => {
    await expect(selectSearchHistorySource('chrome')).resolves.toBe(true);
    expect(browser.permissions.request).toHaveBeenCalledWith({ permissions: ['history'] });
    await expect(getSearchHistorySource()).resolves.toBe('chrome');
  });

  it('keeps local mode when Chrome history permission is denied', async () => {
    requestPermission.mockResolvedValueOnce(false);
    await expect(selectSearchHistorySource('chrome')).resolves.toBe(false);
    await expect(getSearchHistorySource()).resolves.toBe('local');
  });

  it('revokes permission when returning to local mode', async () => {
    await selectSearchHistorySource('chrome');
    await expect(selectSearchHistorySource('local')).resolves.toBe(true);
    expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['history'] });
    await expect(getSearchHistorySource()).resolves.toBe('local');
  });

  it('repairs a persisted Chrome source after permission is revoked', async () => {
    await selectSearchHistorySource('chrome');
    containsPermission.mockResolvedValueOnce(false);
    await expect(resolveSearchHistorySource()).resolves.toBe('local');
    await expect(getSearchHistorySource()).resolves.toBe('local');
  });

  it('reacts to permission removal while the page is running', async () => {
    await selectSearchHistorySource('chrome');
    const onRemoved = vi.fn();
    const unsubscribe = subscribeToHistoryPermissionRemoval(onRemoved);
    const listener = vi.mocked(browser.permissions.onRemoved.addListener).mock.calls.at(-1)![0];
    listener({ permissions: ['history'] });
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    await expect(getSearchHistorySource()).resolves.toBe('local');
    unsubscribe();
  });

  it('does not create sync outbox work when the device-local source changes', async () => {
    await appRepositories.config.initialize();
    const before = await appRepositories.sync.getOutbox();
    await selectSearchHistorySource('chrome');
    const after = await appRepositories.sync.getOutbox();
    expect(after).toEqual(before);
    expect(JSON.stringify(await appRepositories.config.getConfig())).not.toContain('searchHistorySource');
  });

  it('shows source controls, denial feedback, and hides clear in Chrome mode', async () => {
    useAppStore.setState({ ...originalState, config: createInitialConfig({ deviceId: 'test', counter: 0, epoch: 0 }) }, true);
    const deny = vi.fn().mockResolvedValue(false);
    const { rerender } = render(<SearchSettings historySource="local" onHistorySourceChange={deny} />);
    fireEvent.click(screen.getByRole('button', { name: 'enableChromeSearchHistory' }));
    await screen.findByText('chromeHistoryPermissionDenied');
    expect(screen.getByRole('button', { name: 'clearSearchHistory' })).toBeVisible();

    rerender(<SearchSettings historySource="chrome" onHistorySourceChange={vi.fn().mockResolvedValue(true)} />);
    expect(screen.getByText('chromeSearchHistoryPrivacy')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'clearSearchHistory' })).toBeNull();
  });
});
