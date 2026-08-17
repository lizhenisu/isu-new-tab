import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase } from '../../core/storage/database';
import { AppRepository } from '../../core/storage/repository';

async function resetDatabase() {
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('isu-new-tab');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

describe('repository', () => {
  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  it('deletes a shortcut from business data and records a separate tombstone atomically', async () => {
    const repository = new AppRepository();
    const initial = await repository.initialize();
    const shortcut = await repository.addShortcut({ name: 'Example', url: 'example.com', groupId: initial.groups[0]!.id });
    await repository.deleteShortcut(shortcut.id);
    expect((await repository.getConfig()).shortcuts).toHaveLength(0);
    expect((await repository.getMetadata()).tombstones).toEqual([
      expect.objectContaining({ entityType: 'shortcut', entityId: shortcut.id }),
    ]);
    expect((await repository.getOutbox()).some((entry) => entry.entityId === shortcut.id && entry.changeType === 'delete')).toBe(true);
  });

  it('moves children to the default group when deleting a non-empty group', async () => {
    const repository = new AppRepository();
    await repository.initialize();
    const group = await repository.addGroup('Temporary');
    const shortcut = await repository.addShortcut({ name: 'Example', url: 'https://example.com', groupId: group.id });
    await repository.deleteGroup(group.id);
    const config = await repository.getConfig();
    expect(config.shortcuts.find((item) => item.id === shortcut.id)?.groupId).toBe('default');
    expect((await repository.getMetadata()).tombstones).toEqual([
      expect.objectContaining({ entityType: 'group', entityId: group.id }),
    ]);
  });

  it('does not create a remote outbox operation for a local uploaded wallpaper', async () => {
    const repository = new AppRepository();
    await repository.initialize();
    await repository.setWallpaper({ type: 'upload', assetKey: 'wallpaper/upload' });
    expect((await repository.getOutbox()).filter((entry) => entry.entityId === 'wallpaper')).toHaveLength(0);
  });

  it('restores business data, tombstones, outbox, and cursor from a safety checkpoint', async () => {
    const repository = new AppRepository();
    const initial = await repository.initialize();
    await repository.createCheckpoint();
    await repository.addShortcut({ name: 'Later', url: 'https://example.com', groupId: initial.groups[0]!.id });
    expect((await repository.getConfig()).shortcuts).toHaveLength(1);
    expect(await repository.restoreLatestCheckpoint()).toBe(true);
    expect((await repository.getConfig()).shortcuts).toHaveLength(0);
  });

  it('rolls back entity deletion, tombstone, and outbox when the IndexedDB transaction aborts', async () => {
    const setup = new AppRepository();
    const initial = await setup.initialize();
    const shortcut = await setup.addShortcut({ name: 'Keep me', url: 'https://example.com', groupId: initial.groups[0]!.id });
    const repository = new AppRepository((operation, transaction) => {
      if (operation === 'deleteShortcut') transaction.abort();
    });
    await expect(repository.deleteShortcut(shortcut.id)).rejects.toThrow();
    expect((await repository.getConfig()).shortcuts.some((item) => item.id === shortcut.id)).toBe(true);
    expect((await repository.getMetadata()).tombstones).toHaveLength(0);
    expect((await repository.getOutbox()).some((entry) => entry.entityId === shortcut.id && entry.changeType === 'delete')).toBe(false);
  });

  it('recovers pending outbox operations after the database connection restarts', async () => {
    const repository = new AppRepository();
    const initial = await repository.initialize();
    const shortcut = await repository.addShortcut({ name: 'Pending', url: 'https://example.com', groupId: initial.groups[0]!.id });
    await closeDatabase();
    const restarted = new AppRepository();
    await restarted.initialize();
    expect((await restarted.getOutbox()).some((entry) => entry.entityId === shortcut.id)).toBe(true);
  });

  it('commits displaced entities and the system layout in one desktop transaction', async () => {
    const repository = new AppRepository();
    const initial = await repository.initialize();
    const shortcut = await repository.addShortcut({ name: 'Desktop', url: 'https://example.com', groupId: initial.groups[0]!.id });
    await repository.applyDesktopPlacements([
      { kind: 'shortcut', id: shortcut.id, position: { column: 4, row: 30, width: 4, height: 3, gridVersion: 3 } },
      { kind: 'system-widget', id: 'greeting', position: { column: 12, row: 28, width: 16, height: 3, gridVersion: 3 }, sizePreset: 'large' },
    ]);
    const config = await repository.getConfig();
    expect(config.shortcuts.find((item) => item.id === shortcut.id)?.position?.column).toBe(4);
    expect(config.appearance.widgetLayout.value.find((item) => item.id === 'greeting')).toMatchObject({ sizePreset: 'large', position: { column: 12, row: 28, width: 16, height: 3 } });
    const outbox = await repository.getOutbox();
    expect(outbox.some((entry) => entry.entityType === 'shortcut' && entry.entityId === shortcut.id)).toBe(true);
    expect(outbox.some((entry) => entry.entityType === 'appearance' && entry.entityId === 'widgetLayout')).toBe(true);
  });

  it('rolls back every displaced desktop item when the transaction aborts', async () => {
    const setup = new AppRepository();
    const initial = await setup.initialize();
    const shortcut = await setup.addShortcut({ name: 'Stable', url: 'https://example.com', groupId: initial.groups[0]!.id });
    const before = await setup.getConfig();
    const repository = new AppRepository((operation, transaction) => {
      if (operation === 'applyDesktopPlacements') transaction.abort();
    });
    await expect(repository.applyDesktopPlacements([
      { kind: 'shortcut', id: shortcut.id, position: { column: 8, row: 34, width: 4, height: 3, gridVersion: 3 } },
      { kind: 'system-widget', id: 'clock', position: { column: 0, row: 34, width: 10, height: 3, gridVersion: 3 }, sizePreset: 'small' },
    ])).rejects.toThrow();
    const after = await repository.getConfig();
    expect(after.shortcuts.find((item) => item.id === shortcut.id)?.position).toEqual(before.shortcuts.find((item) => item.id === shortcut.id)?.position);
    expect(after.appearance.widgetLayout).toEqual(before.appearance.widgetLayout);
  });

  it('keeps the movable add tile in place when creating a shortcut', async () => {
    const repository = new AppRepository();
    const initial = await repository.initialize();
    await repository.applyDesktopPlacements([
      { kind: 'add-shortcut', id: 'addShortcut', position: { column: 0, row: 30, width: 4, height: 3, gridVersion: 3 } },
    ]);
    await repository.addShortcut({ name: 'Elsewhere', url: 'https://example.com', groupId: initial.groups[0]!.id });
    const config = await repository.getConfig();
    expect(config.appearance.widgetLayout.value.find((item) => item.id === 'addShortcut')?.position).toEqual({ column: 0, row: 30, width: 4, height: 3, gridVersion: 3 });
    expect(config.shortcuts[0]?.position).not.toEqual({ column: 0, row: 30, width: 4, height: 3, gridVersion: 3 });
  });
});
