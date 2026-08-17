import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase } from '../../core/storage/database';
import { AppRepository } from '../../core/storage/repository';
import { SyncCoordinator } from '../../core/sync/coordinator';
import type { SyncStatusRecord, SyncStatusStore } from '../../core/sync/status-store';
import { MemorySyncAdapter } from '../support/memory-sync-adapter';

class MemoryStatusStore implements SyncStatusStore {
  status?: SyncStatusRecord;
  conflict?: unknown;

  async get() { return this.status; }
  async set(status: Omit<SyncStatusRecord, 'updatedAt'>) { this.status = { ...status, updatedAt: new Date().toISOString() }; }
  async setConflict(conflict: unknown) { this.conflict = conflict; }
  async clearConflict() { this.conflict = undefined; }
}

async function resetDatabase() {
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('isu-new-tab');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

describe('SyncCoordinator', () => {
  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  it('coordinates an injected provider without depending on Chrome storage', async () => {
    const repository = new AppRepository();
    const adapter = new MemorySyncAdapter('provider-test');
    const statusStore = new MemoryStatusStore();
    await adapter.enable();
    const coordinator = new SyncCoordinator({
      adapter,
      repository,
      statusStore,
      providerMode: 'chrome',
      refreshWallpaper: vi.fn(),
    });

    await coordinator.run();

    expect(await adapter.pull()).not.toBeNull();
    expect(await repository.getCursor('provider-test')).toBeDefined();
    expect(statusStore.status?.state).toBe('idle');
  });
});
