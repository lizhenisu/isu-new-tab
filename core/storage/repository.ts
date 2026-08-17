import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { createDeviceIdentity, createInitialConfig } from '../domain/defaults';
import { nextRevision } from '../domain/revision';
import { normalizeShortcutUrl } from '../domain/url';
import {
  DEFAULT_GROUP_ID,
  type AppConfig,
  type AssetRecord,
  type DeviceIdentity,
  type OutboxEntry,
  type ProviderCursor,
  type Shortcut,
  type ShortcutGroup,
  type SyncCheckpoint,
  type SyncMetadata,
  type SyncMode,
  type Wallpaper,
} from '../domain/types';
import { getDatabase } from './database';
import { migrateAppConfig } from '../domain/migration';
import { compareBySortKey } from '../domain/sort';
import { firstFreePosition, migrateDesktopPositions, repairDesktopEntityPositions, resolveDesktopItems, type DesktopPlacement } from '../domain/desktop';
import type { WidgetPosition } from '../domain/widgets';
import type { AppUnitOfWork, AssetRepository, BackupRepository, ConfigRepository, SyncRepository } from './ports';

type Listener = () => void;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function outboxEntry(
  entityType: OutboxEntry['entityType'],
  entityId: string,
  revision: OutboxEntry['revision'],
  changeType: OutboxEntry['changeType'],
): OutboxEntry {
  return {
    opId: crypto.randomUUID(),
    entityType,
    entityId,
    revision,
    changeType,
    createdAt: new Date().toISOString(),
  };
}

/**
 * IndexedDB unit of work for mutations that must atomically update business data,
 * tombstones, outbox entries, device revisions, and safety checkpoints.
 */
export class IndexedDbUnitOfWork implements AppUnitOfWork {
  private readonly listeners = new Set<Listener>();
  private readonly channel?: BroadcastChannel;

  constructor(private readonly faultInjector?: (operation: string, transaction: { abort(): void }) => void) {
    if (typeof BroadcastChannel !== 'undefined' && globalThis.location?.protocol === 'chrome-extension:') {
      this.channel = new BroadcastChannel('isu-new-tab:repository');
      this.channel.onmessage = () => this.notifyListeners();
    }
  }

  async initialize(): Promise<AppConfig> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'metadata', 'outbox', 'settings'], 'readwrite');
    let identity = await transaction.objectStore('settings').get('deviceIdentity') as DeviceIdentity | undefined;
    let config = await transaction.objectStore('config').get('current');
    if (!identity) {
      identity = createDeviceIdentity();
      await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    }
    if (!config) {
      config = createInitialConfig(identity);
      await transaction.objectStore('config').put(config, 'current');
      await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    } else {
      config = migrateAppConfig(config);
      const migration = migrateDesktopPositions(config);
      config = migration.config;
      for (const id of migration.changedShortcuts) {
        const shortcut = config.shortcuts.find((item) => item.id === id)!;
        shortcut.revision = nextRevision(identity, shortcut.revision);
        await transaction.objectStore('outbox').put(outboxEntry('shortcut', id, shortcut.revision, 'upsert'));
      }
      for (const id of migration.changedGroups) {
        const group = config.groups.find((item) => item.id === id)!;
        group.revision = nextRevision(identity, group.revision);
        await transaction.objectStore('outbox').put(outboxEntry('group', id, group.revision, 'upsert'));
      }
      if (migration.widgetLayoutChanged) {
        config.appearance.widgetLayout.revision = nextRevision(identity, config.appearance.widgetLayout.revision);
        await transaction.objectStore('outbox').put(outboxEntry('appearance', 'widgetLayout', config.appearance.widgetLayout.revision, 'upsert'));
      }
      await transaction.objectStore('config').put(config, 'current');
    }
    let metadata = await transaction.objectStore('metadata').get('current');
    if (!metadata) {
      metadata = { tombstones: [] };
      await transaction.objectStore('metadata').put(metadata, 'current');
    }
    const observedCounters = [
      ...config.groups.map((item) => item.revision.counter),
      ...config.shortcuts.map((item) => item.revision.counter),
      ...Object.values(config.appearance).map((item) => item.revision.counter),
      ...metadata.tombstones.map((item) => item.revision.counter),
    ];
    identity.counter = Math.max(identity.counter, ...observedCounters);
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    if (!await transaction.objectStore('settings').get('syncMode')) {
      await transaction.objectStore('settings').put('chrome', 'syncMode');
    }
    await transaction.done;
    return clone(config);
  }

  async getConfig(): Promise<AppConfig> {
    const config = await (await getDatabase()).get('config', 'current');
    return config ? clone(config) : this.initialize();
  }

  async getMetadata(): Promise<SyncMetadata> {
    return clone(await (await getDatabase()).get('metadata', 'current') ?? { tombstones: [] });
  }

  async getOutbox(): Promise<OutboxEntry[]> {
    return clone(await (await getDatabase()).getAll('outbox'));
  }

  async addGroup(name: string, position?: WidgetPosition): Promise<ShortcutGroup> {
    const normalizedName = validateName(name, 80);
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const revision = nextRevision(identity);
    const last = [...config.groups].sort(compareBySortKey).at(-1);
    const desktopPosition = position ?? firstFreePosition(resolveDesktopItems(config).map((item) => item.position));
    const group: ShortcutGroup = {
      id: crypto.randomUUID(),
      name: normalizedName,
      collapsed: false,
      sortKey: generateKeyBetween(last?.sortKey ?? null, null),
      position: desktopPosition,
      revision,
    };
    config.groups.push(group);
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('group', group.id, revision, 'upsert'));
    await transaction.done;
    this.emit();
    return clone(group);
  }

  async updateGroup(id: string, patch: Pick<ShortcutGroup, 'name' | 'collapsed'>): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const group = config.groups.find((item) => item.id === id);
    if (!group) throw new Error('GROUP_NOT_FOUND');
    group.name = validateName(patch.name, 80);
    group.collapsed = patch.collapsed;
    group.revision = nextRevision(identity, group.revision);
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('group', id, group.revision, 'upsert'));
    await transaction.done;
    this.emit();
  }

  async deleteGroup(id: string): Promise<void> {
    if (id === DEFAULT_GROUP_ID) throw new Error('DEFAULT_GROUP_CANNOT_BE_DELETED');
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'metadata', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const metadata = await transaction.objectStore('metadata').get('current') ?? { tombstones: [] };
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const group = config.groups.find((item) => item.id === id);
    if (!group) throw new Error('GROUP_NOT_FOUND');
    const deletionRevision = nextRevision(identity, group.revision);
    const children = config.shortcuts.filter((item) => item.groupId === id).sort(compareBySortKey);
    const remainingConfig = {
      ...config,
      groups: config.groups.filter((item) => item.id !== id),
      shortcuts: config.shortcuts.filter((item) => item.groupId !== id),
    };
    const occupied = resolveDesktopItems(remainingConfig).filter((item) => item.kind !== 'add-shortcut').map((item) => item.position);
    let nextPosition = group.position ?? firstFreePosition(occupied);
    config.groups = remainingConfig.groups;
    for (const shortcut of children) {
      shortcut.groupId = DEFAULT_GROUP_ID;
      shortcut.position = nextPosition;
      occupied.push(nextPosition);
      nextPosition = firstFreePosition(occupied, undefined, { column: nextPosition.column + nextPosition.width, row: nextPosition.row });
      shortcut.revision = nextRevision(identity, shortcut.revision);
      await transaction.objectStore('outbox').put(outboxEntry('shortcut', shortcut.id, shortcut.revision, 'upsert'));
    }
    metadata.tombstones = metadata.tombstones.filter((item) => !(item.entityType === 'group' && item.entityId === id));
    metadata.tombstones.push({ entityType: 'group', entityId: id, revision: deletionRevision });
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('metadata').put(metadata, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('group', id, deletionRevision, 'delete'));
    this.faultInjector?.('deleteGroup', transaction);
    await transaction.done;
    this.emit();
  }

  async addShortcut(input: Pick<Shortcut, 'name' | 'url' | 'groupId'> & { position?: WidgetPosition }): Promise<Shortcut> {
    const normalizedName = validateName(input.name, 120);
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    if (!config.groups.some((group) => group.id === input.groupId)) throw new Error('GROUP_NOT_FOUND');
    const siblings = config.shortcuts.filter((item) => item.groupId === input.groupId).sort(compareBySortKey);
    const revision = nextRevision(identity);
    const desktopPosition = input.groupId === DEFAULT_GROUP_ID
      ? input.position ?? firstFreePosition(resolveDesktopItems(config).map((item) => item.position))
      : undefined;
    const shortcut: Shortcut = {
      id: crypto.randomUUID(),
      name: normalizedName,
      url: normalizeShortcutUrl(input.url),
      groupId: input.groupId,
      sortKey: generateKeyBetween(siblings.at(-1)?.sortKey ?? null, null),
      ...(desktopPosition ? { position: desktopPosition } : {}),
      revision,
    };
    config.shortcuts.push(shortcut);
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('shortcut', shortcut.id, revision, 'upsert'));
    await transaction.done;
    this.emit();
    return clone(shortcut);
  }

  async updateShortcut(id: string, input: Pick<Shortcut, 'name' | 'url' | 'groupId'>): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const shortcut = config.shortcuts.find((item) => item.id === id);
    if (!shortcut) throw new Error('SHORTCUT_NOT_FOUND');
    if (!config.groups.some((group) => group.id === input.groupId)) throw new Error('GROUP_NOT_FOUND');
    shortcut.name = validateName(input.name, 120);
    shortcut.url = normalizeShortcutUrl(input.url);
    if (shortcut.groupId !== input.groupId && input.groupId === DEFAULT_GROUP_ID) {
      shortcut.position = firstFreePosition(resolveDesktopItems(config).map((item) => item.position));
    }
    shortcut.groupId = input.groupId;
    shortcut.revision = nextRevision(identity, shortcut.revision);
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('shortcut', id, shortcut.revision, 'upsert'));
    await transaction.done;
    this.emit();
  }

  async moveShortcut(id: string, groupId: string, beforeId?: string, afterId?: string, position?: WidgetPosition): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const shortcut = config.shortcuts.find((item) => item.id === id);
    if (!shortcut) throw new Error('SHORTCUT_NOT_FOUND');
    if (!config.groups.some((group) => group.id === groupId)) throw new Error('GROUP_NOT_FOUND');
    const before = beforeId ? config.shortcuts.find((item) => item.id === beforeId)?.sortKey ?? null : null;
    const after = afterId ? config.shortcuts.find((item) => item.id === afterId)?.sortKey ?? null : null;
    if (shortcut.groupId !== groupId && groupId === DEFAULT_GROUP_ID) {
      shortcut.position = position ?? firstFreePosition(resolveDesktopItems(config).map((item) => item.position));
    }
    shortcut.groupId = groupId;
    shortcut.sortKey = generateKeyBetween(before, after);
    shortcut.revision = nextRevision(identity, shortcut.revision);
    if (shortcut.sortKey.length > 32) {
      const siblings = config.shortcuts.filter((item) => item.groupId === groupId).sort(compareBySortKey);
      const keys = generateNKeysBetween(null, null, siblings.length);
      for (const [index, sibling] of siblings.entries()) {
        sibling.sortKey = keys[index]!;
        sibling.revision = nextRevision(identity, sibling.revision);
        await transaction.objectStore('outbox').put(outboxEntry('shortcut', sibling.id, sibling.revision, 'upsert'));
      }
    }
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('shortcut', id, shortcut.revision, 'upsert'));
    await transaction.done;
    this.emit();
  }

  async moveGroup(id: string, beforeId?: string, afterId?: string): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const group = config.groups.find((item) => item.id === id);
    if (!group) throw new Error('GROUP_NOT_FOUND');
    const before = beforeId ? config.groups.find((item) => item.id === beforeId)?.sortKey ?? null : null;
    const after = afterId ? config.groups.find((item) => item.id === afterId)?.sortKey ?? null : null;
    group.sortKey = generateKeyBetween(before, after);
    group.revision = nextRevision(identity, group.revision);
    if (group.sortKey.length > 32) {
      const groups = config.groups.sort(compareBySortKey);
      const keys = generateNKeysBetween(null, null, groups.length);
      for (const [index, item] of groups.entries()) {
        item.sortKey = keys[index]!;
        item.revision = nextRevision(identity, item.revision);
        await transaction.objectStore('outbox').put(outboxEntry('group', item.id, item.revision, 'upsert'));
      }
    }
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('group', id, group.revision, 'upsert'));
    await transaction.done;
    this.emit();
  }

  async deleteShortcut(id: string): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'metadata', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const metadata = await transaction.objectStore('metadata').get('current') ?? { tombstones: [] };
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const shortcut = config.shortcuts.find((item) => item.id === id);
    if (!shortcut) throw new Error('SHORTCUT_NOT_FOUND');
    const revision = nextRevision(identity, shortcut.revision);
    config.shortcuts = config.shortcuts.filter((item) => item.id !== id);
    metadata.tombstones = metadata.tombstones.filter((item) => !(item.entityType === 'shortcut' && item.entityId === id));
    metadata.tombstones.push({ entityType: 'shortcut', entityId: id, revision });
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('metadata').put(metadata, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('outbox').put(outboxEntry('shortcut', id, revision, 'delete'));
    this.faultInjector?.('deleteShortcut', transaction);
    await transaction.done;
    this.emit();
  }

  async applyDesktopPlacements(placements: DesktopPlacement[]): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    let widgetChanged = false;
    for (const placement of placements) {
      if (placement.kind === 'shortcut') {
        const shortcut = config.shortcuts.find((item) => item.id === placement.id);
        if (!shortcut || samePosition(shortcut.position, placement.position)) continue;
        shortcut.position = placement.position;
        shortcut.revision = nextRevision(identity, shortcut.revision);
        await transaction.objectStore('outbox').put(outboxEntry('shortcut', shortcut.id, shortcut.revision, 'upsert'));
      } else if (placement.kind === 'folder') {
        const group = config.groups.find((item) => item.id === placement.id && item.id !== DEFAULT_GROUP_ID);
        if (!group || samePosition(group.position, placement.position)) continue;
        group.position = placement.position;
        group.revision = nextRevision(identity, group.revision);
        await transaction.objectStore('outbox').put(outboxEntry('group', group.id, group.revision, 'upsert'));
      } else {
        const widget = config.appearance.widgetLayout.value.find((item) => item.id === placement.id);
        if (!widget) continue;
        if (!samePosition(widget.position, placement.position) || widget.sizePreset !== placement.sizePreset) {
          widget.position = placement.position;
          widget.sizePreset = placement.sizePreset;
          widgetChanged = true;
        }
      }
    }
    if (widgetChanged) {
      const current = config.appearance.widgetLayout;
      current.revision = nextRevision(identity, current.revision);
      await transaction.objectStore('outbox').put(outboxEntry('appearance', 'widgetLayout', current.revision, 'upsert'));
    }
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    this.faultInjector?.('applyDesktopPlacements', transaction);
    await transaction.done;
    this.emit();
  }

  async updateAppearance<K extends keyof AppConfig['appearance']>(key: K, value: AppConfig['appearance'][K]['value']): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const current = config.appearance[key];
    const revision = nextRevision(identity, current.revision);
    config.appearance[key] = { value, revision } as AppConfig['appearance'][K];
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    if (!(key === 'wallpaper' && (value as Wallpaper).type === 'upload')) {
      await transaction.objectStore('outbox').put(outboxEntry('appearance', key, revision, 'upsert'));
    }
    await transaction.done;
    this.emit();
  }

  async setWallpaper(wallpaper: Wallpaper): Promise<void> {
    return this.updateAppearance('wallpaper', wallpaper);
  }

  async setUploadedWallpaper(blob: Blob): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'assets', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const revision = nextRevision(identity, config.appearance.wallpaper.revision);
    const assetKey = 'wallpaper/upload';
    config.appearance.wallpaper = { value: { type: 'upload', assetKey }, revision };
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('assets').put({ key: assetKey, blob, updatedAt: new Date().toISOString() });
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.done;
    this.emit();
  }

  async replaceFromImport(config: AppConfig, wallpaper?: Blob): Promise<void> {
    const database = await getDatabase();
    const stores = wallpaper ? ['config', 'metadata', 'outbox', 'assets', 'settings'] as const : ['config', 'metadata', 'outbox', 'settings'] as const;
    const transaction = database.transaction(stores, 'readwrite');
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('metadata').put({ tombstones: [] }, 'current');
    await transaction.objectStore('outbox').clear();
    for (const group of config.groups) await transaction.objectStore('outbox').put(outboxEntry('group', group.id, group.revision, 'upsert'));
    for (const shortcut of config.shortcuts) await transaction.objectStore('outbox').put(outboxEntry('shortcut', shortcut.id, shortcut.revision, 'upsert'));
    for (const [key, value] of Object.entries(config.appearance)) {
      if (key === 'wallpaper' && (value.value as Wallpaper).type === 'upload') continue;
      await transaction.objectStore('outbox').put(outboxEntry('appearance', key, value.revision, 'upsert'));
    }
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const revisions = [
      ...config.groups.map((item) => item.revision),
      ...config.shortcuts.map((item) => item.revision),
      ...Object.values(config.appearance).map((item) => item.revision),
    ].filter((revision) => revision.deviceId === identity.deviceId);
    identity.counter = Math.max(identity.counter, ...revisions.map((revision) => revision.counter));
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    if (wallpaper) {
      const asset: AssetRecord = { key: 'wallpaper/upload', blob: wallpaper, updatedAt: new Date().toISOString() };
      await transaction.objectStore('assets').put(asset);
    }
    await transaction.done;
    this.emit();
  }

  async replaceFromSync(
    config: AppConfig,
    metadata: SyncMetadata,
    identity: DeviceIdentity,
    cursor: ProviderCursor,
    options?: { pendingRevision?: OutboxEntry['revision']; discardOutbox?: boolean },
  ): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'metadata', 'settings', 'cursors', 'outbox'], 'readwrite');
    const migration = migrateDesktopPositions(config);
    const normalized = migration.config;
    for (const id of migration.changedShortcuts) {
      const shortcut = normalized.shortcuts.find((item) => item.id === id)!;
      shortcut.revision = nextRevision(identity, shortcut.revision);
    }
    for (const id of migration.changedGroups) {
      const group = normalized.groups.find((item) => item.id === id)!;
      group.revision = nextRevision(identity, group.revision);
    }
    if (migration.widgetLayoutChanged) {
      normalized.appearance.widgetLayout.revision = nextRevision(identity, normalized.appearance.widgetLayout.revision);
    }
    normalized.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(normalized, 'current');
    await transaction.objectStore('metadata').put(metadata, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('cursors').put(cursor);
    if (options?.discardOutbox) await transaction.objectStore('outbox').clear();
    for (const id of migration.changedShortcuts) {
      const shortcut = normalized.shortcuts.find((item) => item.id === id)!;
      await transaction.objectStore('outbox').put(outboxEntry('shortcut', id, shortcut.revision, 'upsert'));
    }
    for (const id of migration.changedGroups) {
      const group = normalized.groups.find((item) => item.id === id)!;
      await transaction.objectStore('outbox').put(outboxEntry('group', id, group.revision, 'upsert'));
    }
    if (migration.widgetLayoutChanged) {
      await transaction.objectStore('outbox').put(outboxEntry('appearance', 'widgetLayout', normalized.appearance.widgetLayout.revision, 'upsert'));
    }
    if (options?.pendingRevision) await transaction.objectStore('outbox').put(outboxEntry('envelope', 'current', options.pendingRevision, 'upsert'));
    await transaction.done;
    this.emit();
  }

  async updateSyncControl(metadata: SyncMetadata, identity: DeviceIdentity, cursor: ProviderCursor): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['metadata', 'settings', 'cursors'], 'readwrite');
    await transaction.objectStore('metadata').put(metadata, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.objectStore('cursors').put(cursor);
    await transaction.done;
    this.emit();
  }

  async importExternalSync(remote: AppConfig): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'outbox', 'settings'], 'readwrite');
    const config = await this.requireConfig(transaction.objectStore('config'));
    const identity = await this.requireIdentity(transaction.objectStore('settings'));
    const groupIds = new Map<string, string>([[DEFAULT_GROUP_ID, DEFAULT_GROUP_ID]]);
    for (const source of remote.groups.filter((group) => group.id !== DEFAULT_GROUP_ID).sort(compareBySortKey)) {
      const revision = nextRevision(identity);
      const group: ShortcutGroup = { ...source, id: crypto.randomUUID(), revision };
      groupIds.set(source.id, group.id);
      config.groups.push(group);
      await transaction.objectStore('outbox').put(outboxEntry('group', group.id, revision, 'upsert'));
    }
    for (const source of remote.shortcuts.sort(compareBySortKey)) {
      const revision = nextRevision(identity);
      const shortcut: Shortcut = {
        ...source,
        id: crypto.randomUUID(),
        groupId: groupIds.get(source.groupId) ?? DEFAULT_GROUP_ID,
        revision,
      };
      config.shortcuts.push(shortcut);
      await transaction.objectStore('outbox').put(outboxEntry('shortcut', shortcut.id, revision, 'upsert'));
    }
    const repair = repairDesktopEntityPositions(config.groups, config.shortcuts, config.appearance.widgetLayout.value);
    config.groups = repair.groups;
    config.shortcuts = repair.shortcuts;
    for (const id of repair.changedGroups) {
      const group = config.groups.find((item) => item.id === id)!;
      group.revision = nextRevision(identity, group.revision);
      await transaction.objectStore('outbox').put(outboxEntry('group', id, group.revision, 'upsert'));
    }
    for (const id of repair.changedShortcuts) {
      const shortcut = config.shortcuts.find((item) => item.id === id)!;
      shortcut.revision = nextRevision(identity, shortcut.revision);
      await transaction.objectStore('outbox').put(outboxEntry('shortcut', id, shortcut.revision, 'upsert'));
    }
    config.updatedAt = new Date().toISOString();
    await transaction.objectStore('config').put(config, 'current');
    await transaction.objectStore('settings').put(identity, 'deviceIdentity');
    await transaction.done;
    this.emit();
  }

  async putAsset(key: string, blob: Blob, sourceUrl?: string): Promise<void> {
    await (await getDatabase()).put('assets', { key, blob, updatedAt: new Date().toISOString(), ...(sourceUrl ? { sourceUrl } : {}) });
    this.emit();
  }

  async getAsset(key: string): Promise<Blob | undefined> {
    return (await (await getDatabase()).get('assets', key))?.blob;
  }

  async getAssetRecord(key: string): Promise<AssetRecord | undefined> {
    return (await getDatabase()).get('assets', key);
  }

  async getSyncMode(): Promise<SyncMode> {
    return await (await getDatabase()).get('settings', 'syncMode') as SyncMode ?? 'chrome';
  }

  async setSyncMode(mode: SyncMode): Promise<void> {
    await (await getDatabase()).put('settings', mode, 'syncMode');
    this.emit();
  }

  async getDeviceIdentity(): Promise<DeviceIdentity> {
    const value = await (await getDatabase()).get('settings', 'deviceIdentity') as DeviceIdentity | undefined;
    if (value) return value;
    await this.initialize();
    return (await (await getDatabase()).get('settings', 'deviceIdentity')) as DeviceIdentity;
  }

  async putCursor(cursor: ProviderCursor): Promise<void> {
    await (await getDatabase()).put('cursors', cursor);
  }

  async getCursor(providerId: string): Promise<ProviderCursor | undefined> {
    return (await getDatabase()).get('cursors', providerId);
  }

  async removeOutbox(opIds: string[]): Promise<void> {
    const transaction = (await getDatabase()).transaction('outbox', 'readwrite');
    await Promise.all(opIds.map((id) => transaction.store.delete(id)));
    await transaction.done;
  }

  async createCheckpoint(): Promise<SyncCheckpoint> {
    const checkpoint: SyncCheckpoint = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      config: await this.getConfig(),
      metadata: await this.getMetadata(),
      outbox: await this.getOutbox(),
      cursor: await this.getCursor('chrome'),
    };
    await (await getDatabase()).put('checkpoints', checkpoint);
    const checkpoints = (await (await getDatabase()).getAll('checkpoints')).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    for (const stale of checkpoints.slice(5)) await (await getDatabase()).delete('checkpoints', stale.id);
    return checkpoint;
  }

  async getLatestCheckpoint(): Promise<SyncCheckpoint | undefined> {
    return (await (await getDatabase()).getAll('checkpoints')).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  async restoreLatestCheckpoint(): Promise<boolean> {
    const checkpoint = await this.getLatestCheckpoint();
    if (!checkpoint) return false;
    const database = await getDatabase();
    const transaction = database.transaction(['config', 'metadata', 'outbox', 'cursors'], 'readwrite');
    await transaction.objectStore('config').put(checkpoint.config, 'current');
    await transaction.objectStore('metadata').put(checkpoint.metadata, 'current');
    await transaction.objectStore('outbox').clear();
    for (const entry of checkpoint.outbox) await transaction.objectStore('outbox').put(entry);
    if (checkpoint.cursor) await transaction.objectStore('cursors').put(checkpoint.cursor);
    else await transaction.objectStore('cursors').delete('chrome');
    await transaction.done;
    this.emit();
    return true;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.notifyListeners();
    this.channel?.postMessage('changed');
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) listener();
  }

  private async requireConfig(store: { get(key: 'current'): Promise<AppConfig | undefined> }): Promise<AppConfig> {
    const config = await store.get('current');
    if (!config) throw new Error('REPOSITORY_NOT_INITIALIZED');
    return config;
  }

  private async requireIdentity(store: { get(key: 'deviceIdentity'): Promise<unknown> }): Promise<DeviceIdentity> {
    const identity = await store.get('deviceIdentity');
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || !('deviceId' in identity) || typeof identity.deviceId !== 'string'
      || !('counter' in identity) || typeof identity.counter !== 'number'
      || !('epoch' in identity) || typeof identity.epoch !== 'number') {
      throw new Error('REPOSITORY_NOT_INITIALIZED');
    }
    return identity as DeviceIdentity;
  }
}

function validateName(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('NAME_REQUIRED');
  if (normalized.length > maxLength) throw new Error('NAME_TOO_LONG');
  return normalized;
}

function samePosition(left: WidgetPosition | undefined, right: WidgetPosition): boolean {
  return Boolean(left && left.column === right.column && left.row === right.row
    && left.width === right.width && left.height === right.height && left.gridVersion === right.gridVersion);
}

export { IndexedDbUnitOfWork as AppRepository };

const appUnitOfWork = new IndexedDbUnitOfWork();

export const appRepositories = {
  config: appUnitOfWork as ConfigRepository,
  sync: appUnitOfWork as SyncRepository,
  assets: appUnitOfWork as AssetRepository,
  backup: appUnitOfWork as BackupRepository,
};
