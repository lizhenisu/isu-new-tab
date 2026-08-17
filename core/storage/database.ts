import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AppConfig,
  AppLanguage,
  AssetRecord,
  DeviceIdentity,
  OutboxEntry,
  ProviderCursor,
  SyncCheckpoint,
  SearchHistorySource,
  SyncMetadata,
  SyncMode,
} from '../domain/types';
import type { SearchHistoryEntry } from '../search/history';

interface NewTabDatabase extends DBSchema {
  config: { key: 'current'; value: AppConfig };
  metadata: { key: 'current'; value: SyncMetadata };
  outbox: { key: string; value: OutboxEntry };
  assets: { key: string; value: AssetRecord };
  cursors: { key: string; value: ProviderCursor };
  settings: {
    key: 'deviceIdentity' | 'syncMode' | 'searchHistory' | 'searchHistorySource' | 'appLanguage';
    value: DeviceIdentity | SyncMode | SearchHistoryEntry[] | SearchHistorySource | AppLanguage;
  };
  checkpoints: { key: string; value: SyncCheckpoint };
}

let databasePromise: Promise<IDBPDatabase<NewTabDatabase>> | undefined;
const DATABASE_NAME = 'isu-new-tab';
const LEGACY_DATABASE_NAME = ['i', 'z', 'i', 's', 'u', '-new-tab'].join('');
const STORE_NAMES = ['config', 'metadata', 'outbox', 'assets', 'cursors', 'settings', 'checkpoints'] as const;

export function getDatabase(): Promise<IDBPDatabase<NewTabDatabase>> {
  databasePromise ??= openDatabase();
  return databasePromise;
}

async function openDatabase(): Promise<IDBPDatabase<NewTabDatabase>> {
  const database = await openDB<NewTabDatabase>(DATABASE_NAME, 1, {
    upgrade(current) {
      current.createObjectStore('config');
      current.createObjectStore('metadata');
      current.createObjectStore('outbox', { keyPath: 'opId' });
      current.createObjectStore('assets', { keyPath: 'key' });
      current.createObjectStore('cursors', { keyPath: 'providerId' });
      current.createObjectStore('settings');
      current.createObjectStore('checkpoints', { keyPath: 'id' });
    },
  });
  await migrateLegacyDatabase(database);
  return database;
}

async function migrateLegacyDatabase(target: IDBPDatabase<NewTabDatabase>): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return;
  const databases = await indexedDB.databases();
  if (!databases.some((entry) => entry.name === LEGACY_DATABASE_NAME)) return;
  const legacy = await openDB<NewTabDatabase>(LEGACY_DATABASE_NAME, 1);
  try {
    if (await target.get('config', 'current')) return;
    const records = await Promise.all(STORE_NAMES.map(async (store) => ({ store, values: await legacy.getAll(store) })));
    const transaction = target.transaction(STORE_NAMES, 'readwrite');
    for (const { store, values } of records) {
      for (const value of values) await transaction.objectStore(store).put(value as never);
    }
    await transaction.done;
  } finally {
    legacy.close();
    indexedDB.deleteDatabase(LEGACY_DATABASE_NAME);
  }
}

export async function closeDatabase(): Promise<void> {
  const database = await databasePromise;
  database?.close();
  databasePromise = undefined;
}
