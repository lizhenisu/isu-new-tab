import type { Revision, SyncEnvelope } from '../domain/types';
import { syncEnvelopeSchema } from '../domain/schema';
import { base64ToBytes, bytesToBase64, canonicalStringify, gunzipJson, gzipJson, sha256 } from './codec';
import type { AdapterStatus, DeviceAck, RemoteMetadata, SyncAdapter } from './adapter';
import { compareBySortKey } from '../domain/sort';

export const CHROME_ITEM_TARGET_BYTES = 7_400;
export const CHROME_WARNING_BYTES = 80 * 1024;
export const CHROME_STOP_BYTES = 95 * 1024;

const ACTIVE_HEAD_KEY = 'sync/activeHead';

type StorageValues = Record<string, unknown>;

export interface SyncStorageArea {
  get(keys?: string | string[] | null): Promise<StorageValues>;
  set(items: StorageValues): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

type BucketPayload = {
  kind: 'settings' | 'groups' | 'shortcuts' | 'pieces' | 'tombstones';
  items: unknown[];
};

type BucketRecord = {
  schemaVersion: 1;
  hash: string;
  data: string;
};

type Manifest = {
  schemaVersion: 1;
  datasetId: string;
  epoch: number;
  revision: Revision;
  configUpdatedAt: string;
  previousManifestKey?: string;
  envelopeHash: string;
  envelopeHashMode?: 'sorted-entities-v1';
  buckets: Array<{ key: string; hash: string }>;
  totalBytes: number;
  createdAt: string;
};

type ActiveHead = {
  manifestKey: string;
  version: string;
  datasetId: string;
  epoch: number;
  envelopeHash: string;
};

/** Chrome storage.sync transport with immutable buckets and an atomic head switch. */
export class ChromeSyncAdapter implements SyncAdapter {
  readonly providerId = 'chrome';
  readonly capabilities = {
    maxPayloadBytes: CHROME_STOP_BYTES,
    maxItemBytes: CHROME_ITEM_TARGET_BYTES,
    conditionalWrite: false,
    incremental: true,
  };

  private enabled = true;
  private status: AdapterStatus = { state: 'idle' };
  private lastGarbageCollection = 0;

  constructor(private readonly storage: SyncStorageArea = chrome.storage.sync) {}

  async enable(): Promise<void> {
    this.enabled = true;
    this.status = { state: 'idle' };
  }

  async disable(): Promise<void> {
    this.enabled = false;
    this.status = { state: 'disabled' };
  }

  async getRemoteMetadata(): Promise<RemoteMetadata | null> {
    const { head, manifest } = await this.readHeadAndManifest();
    if (!head || !manifest) return null;
    return metadataFrom(head, manifest);
  }

  async pull(): Promise<SyncEnvelope | null> {
    const { manifest } = await this.readHeadAndManifest();
    if (!manifest) return null;
    const values = await this.storage.get(manifest.buckets.map((bucket) => bucket.key));
    const payloads: BucketPayload[] = [];
    for (const pointer of manifest.buckets) {
      const record = values[pointer.key] as BucketRecord | undefined;
      if (!record || record.hash !== pointer.hash) throw new Error('REMOTE_BUCKET_MISSING');
      const payload = gunzipJson<BucketPayload>(base64ToBytes(record.data));
      if (await sha256(canonicalStringify(payload)) !== pointer.hash) throw new Error('REMOTE_BUCKET_CORRUPT');
      payloads.push(payload);
    }
    const transported = normalizeEnvelope(assembleEnvelope(payloads, manifest));
    if (manifest.envelopeHashMode && await sha256(canonicalStringify(transported)) !== manifest.envelopeHash) {
      throw new Error('REMOTE_ENVELOPE_CORRUPT');
    }
    return normalizeEnvelope(syncEnvelopeSchema.parse(transported) as SyncEnvelope);
  }

  async push(envelope: SyncEnvelope): Promise<RemoteMetadata> {
    if (!this.enabled) throw new Error('SYNC_DISABLED');
    this.status = { state: 'syncing' };
    try {
      await this.collectGarbage();
      const start = await this.readHeadAndManifest();
      const transportEnvelope = normalizeEnvelope(envelope);
      const bucketWrites = await buildBucketWrites(transportEnvelope);
      const envelopeHash = await sha256(canonicalStringify(transportEnvelope));
      const manifest: Manifest = {
        schemaVersion: 1,
        datasetId: envelope.datasetId,
        epoch: envelope.epoch,
        revision: envelope.revision,
        configUpdatedAt: transportEnvelope.config.updatedAt,
        ...(start.head ? { previousManifestKey: start.head.manifestKey } : {}),
        envelopeHash,
        envelopeHashMode: 'sorted-entities-v1',
        buckets: bucketWrites.pointers,
        totalBytes: 0,
        createdAt: new Date().toISOString(),
      };
      const placeholderKey = `sync/manifest/${'0'.repeat(64)}`;
      manifest.totalBytes = encodedItemBytes(placeholderKey, manifest) + bucketWrites.totalBytes;
      if (manifest.totalBytes >= CHROME_STOP_BYTES) throw new Error('CHROME_SYNC_CAPACITY_EXCEEDED');
      const manifestHash = await sha256(canonicalStringify(manifest));
      const manifestKey = `sync/manifest/${manifestHash}`;
      if (encodedItemBytes(manifestKey, manifest) > CHROME_ITEM_TARGET_BYTES) throw new Error('CHROME_SYNC_MANIFEST_TOO_LARGE');
      const activeHead: ActiveHead = {
        manifestKey,
        version: revisionVersion(envelope.revision),
        datasetId: envelope.datasetId,
        epoch: envelope.epoch,
        envelopeHash,
      };
      const writes = { ...bucketWrites.values, [manifestKey]: manifest, [ACTIVE_HEAD_KEY]: activeHead };
      let predicted = await this.predictBytes(writes);
      if (predicted >= CHROME_STOP_BYTES) {
        await this.collectGarbage(true);
        predicted = await this.predictBytes(writes);
      }
      if (predicted >= CHROME_STOP_BYTES) {
        this.status = { state: 'error', message: 'QUOTA_SAFETY_LIMIT', usedBytes: predicted };
        throw new Error('CHROME_SYNC_CAPACITY_EXCEEDED');
      }
      const existingBuckets = await this.storage.get(Object.keys(bucketWrites.values));
      const changedBuckets = Object.fromEntries(Object.entries(bucketWrites.values).filter(([key, value]) =>
        canonicalStringify(existingBuckets[key]) !== canonicalStringify(value),
      ));
      if (Object.keys(changedBuckets).length) {
        await this.storage.set(changedBuckets);
        await this.verifyValues(changedBuckets);
      }
      await this.storage.set({ [manifestKey]: manifest });
      await this.verifyValues({ [manifestKey]: manifest });
      const beforeSwitch = await this.readActiveHead();
      if ((beforeSwitch?.manifestKey ?? null) !== (start.head?.manifestKey ?? null)) throw new Error('ACTIVE_HEAD_CHANGED');
      await this.storage.set({ [ACTIVE_HEAD_KEY]: activeHead });
      const confirmed = await this.readActiveHead();
      if (confirmed?.manifestKey !== manifestKey) throw new Error('ACTIVE_HEAD_NOT_CONFIRMED');
      this.status = predicted >= CHROME_WARNING_BYTES
        ? { state: 'warning', message: 'QUOTA_WARNING', usedBytes: predicted }
        : { state: 'idle', usedBytes: predicted };
      return metadataFrom(activeHead, manifest);
    } catch (error) {
      if (this.status.state !== 'error') this.status = { state: 'error', message: errorMessage(error) };
      throw error;
    }
  }

  async writeAck(deviceId: string, revision: Revision, epoch: number): Promise<void> {
    const key = `ack/${deviceId}`;
    const current = (await this.storage.get(key))[key] as DeviceAck | undefined;
    const now = Date.now();
    const lastSeen = current ? Date.parse(current.lastSeen) : 0;
    const advanced = !current || compareRevision(revision, current.revision) > 0 || current.epoch !== epoch;
    if (!advanced && now - lastSeen < 24 * 60 * 60 * 1000) return;
    await this.storage.set({ [key]: { revision: advanced ? revision : current.revision, epoch, lastSeen: new Date(now).toISOString() } });
  }

  async getAcks(): Promise<Record<string, DeviceAck>> {
    const values = await this.storage.get(null);
    return Object.fromEntries(
      Object.entries(values)
        .filter(([key]) => key.startsWith('ack/'))
        .map(([key, value]) => [key.slice(4), value as DeviceAck]),
    );
  }

  async removeExpiredAcks(now = Date.now()): Promise<string[]> {
    const acks = await this.getAcks();
    const expired = Object.entries(acks)
      .filter(([, ack]) => now - Date.parse(ack.lastSeen) > 90 * 24 * 60 * 60 * 1000)
      .map(([deviceId]) => `ack/${deviceId}`);
    if (expired.length) await this.storage.remove(expired);
    return expired;
  }

  async remove(): Promise<void> {
    const values = await this.storage.get(null);
    const keys = Object.keys(values).filter((key) => key.startsWith('sync/') || key.startsWith('ack/'));
    if (keys.length) await this.storage.remove(keys);
  }

  getStatus(): AdapterStatus {
    return { ...this.status };
  }

  async collectGarbage(force = false): Promise<void> {
    if (!force && Date.now() - this.lastGarbageCollection < 5 * 60 * 1000) return;
    this.lastGarbageCollection = Date.now();
    const values = await this.storage.get(null);
    const head = values[ACTIVE_HEAD_KEY] as ActiveHead | undefined;
    if (!head) return;
    const keep = new Set<string>([ACTIVE_HEAD_KEY, head.manifestKey]);
    const current = values[head.manifestKey] as Manifest | undefined;
    for (const pointer of current?.buckets ?? []) keep.add(pointer.key);
    if (current?.previousManifestKey) {
      keep.add(current.previousManifestKey);
      const previous = values[current.previousManifestKey] as Manifest | undefined;
      for (const pointer of previous?.buckets ?? []) keep.add(pointer.key);
    }
    for (const [key, value] of Object.entries(values).filter(([item]) => item.startsWith('ack/'))) {
      keep.add(key);
      const ack = value as DeviceAck;
      for (const [manifestKey, candidate] of Object.entries(values).filter(([item]) => item.startsWith('sync/manifest/'))) {
        const manifest = candidate as Manifest;
        if (manifest.epoch !== ack.epoch || compareRevision(manifest.revision, ack.revision) !== 0) continue;
        keep.add(manifestKey);
        for (const pointer of manifest.buckets) keep.add(pointer.key);
      }
    }
    const stale = Object.keys(values).filter((key) => key.startsWith('sync/') && !keep.has(key));
    if (stale.length) await this.storage.remove(stale);
  }

  private async readHeadAndManifest(): Promise<{ head?: ActiveHead; manifest?: Manifest }> {
    const head = await this.readActiveHead();
    if (!head) return {};
    const manifest = (await this.storage.get(head.manifestKey))[head.manifestKey] as Manifest | undefined;
    if (!manifest) throw new Error('REMOTE_MANIFEST_MISSING');
    const expectedHash = head.manifestKey.split('/').at(-1);
    if (!expectedHash || await sha256(canonicalStringify(manifest)) !== expectedHash) throw new Error('REMOTE_MANIFEST_CORRUPT');
    if (head.datasetId !== manifest.datasetId || head.epoch !== manifest.epoch || head.envelopeHash !== manifest.envelopeHash) {
      throw new Error('REMOTE_HEAD_CORRUPT');
    }
    return { head, manifest };
  }

  private async readActiveHead(): Promise<ActiveHead | undefined> {
    return (await this.storage.get(ACTIVE_HEAD_KEY))[ACTIVE_HEAD_KEY] as ActiveHead | undefined;
  }

  private async verifyValues(expected: StorageValues): Promise<void> {
    const actual = await this.storage.get(Object.keys(expected));
    for (const [key, value] of Object.entries(expected)) {
      if (canonicalStringify(actual[key]) !== canonicalStringify(value)) throw new Error('REMOTE_WRITE_VERIFICATION_FAILED');
    }
  }

  private async predictBytes(writes: StorageValues): Promise<number> {
    const current = await this.storage.get(null);
    return Object.entries({ ...current, ...writes }).reduce((total, [key, value]) => total + encodedItemBytes(key, value), 0);
  }
}

async function buildBucketWrites(envelope: SyncEnvelope): Promise<{
  values: StorageValues;
  pointers: Manifest['buckets'];
  totalBytes: number;
}> {
  const settings: BucketPayload = {
    kind: 'settings',
    items: [{
      config: {
        schemaVersion: envelope.config.schemaVersion,
        datasetId: envelope.config.datasetId,
        appearance: envelope.config.appearance,
      },
    }],
  };
  const payloads = [
    settings,
    ...await partition('groups', envelope.config.groups),
    ...await partition('shortcuts', envelope.config.shortcuts),
    ...await partition('pieces', envelope.pieces ?? [], (item) => `${(item as { id: string }).id}`),
    ...await partition('tombstones', envelope.metadata.tombstones, (item) => `${item.entityType}/${item.entityId}`),
  ];
  const values: StorageValues = {};
  const pointers: Manifest['buckets'] = [];
  let totalBytes = 0;
  for (const payload of payloads) {
    const hash = await sha256(canonicalStringify(payload));
    const record: BucketRecord = { schemaVersion: 1, hash, data: bytesToBase64(gzipJson(payload)) };
    const key = `sync/bucket/${payload.kind}/${hash}`;
    const bytes = encodedItemBytes(key, record);
    if (bytes > CHROME_ITEM_TARGET_BYTES) throw new Error('CHROME_SYNC_ITEM_TOO_LARGE');
    values[key] = record;
    pointers.push({ key, hash });
    totalBytes += bytes;
  }
  return { values, pointers, totalBytes };
}

async function partition<T>(
  kind: BucketPayload['kind'],
  items: T[],
  identity: (item: T) => string = (item) => (item as { id?: string }).id ?? '',
): Promise<BucketPayload[]> {
  if (!items.length) return [{ kind, items: [] }];
  const hashed = await Promise.all(items.map(async (item) => ({ item, hash: await sha256(identity(item)) })));
  hashed.sort((left, right) => left.hash.localeCompare(right.hash));
  const result: BucketPayload[] = [];
  const visit = async (entries: typeof hashed, depth: number): Promise<void> => {
    const payload: BucketPayload = { kind, items: entries.map(({ item }) => item) };
    const contentHash = await sha256(canonicalStringify(payload));
    const candidateKey = `sync/bucket/${kind}/${contentHash}`;
    const candidate: BucketRecord = { schemaVersion: 1, hash: contentHash, data: bytesToBase64(gzipJson(payload)) };
    if (encodedItemBytes(candidateKey, candidate) <= CHROME_ITEM_TARGET_BYTES) {
      result.push(payload);
      return;
    }
    if (entries.length === 1 || depth >= 64) throw new Error('CHROME_SYNC_ENTITY_TOO_LARGE');
    const groups = new Map<string, typeof hashed>();
    for (const entry of entries) {
      const prefix = entry.hash.slice(0, depth + 1);
      const group = groups.get(prefix) ?? [];
      group.push(entry);
      groups.set(prefix, group);
    }
    if (groups.size === 1) return visit(entries, depth + 1);
    for (const group of groups.values()) await visit(group, depth + 1);
  };
  await visit(hashed, 0);
  return result;
}

function assembleEnvelope(payloads: BucketPayload[], manifest: Manifest): SyncEnvelope {
  const settings = payloads.find((payload) => payload.kind === 'settings')?.items[0] as {
    config: Pick<SyncEnvelope['config'], 'schemaVersion' | 'datasetId' | 'appearance'>;
  } | undefined;
  if (!settings) throw new Error('REMOTE_SETTINGS_MISSING');
  const items = (kind: BucketPayload['kind']) => payloads.filter((payload) => payload.kind === kind).flatMap((payload) => payload.items);
  return {
    schemaVersion: manifest.schemaVersion,
    datasetId: manifest.datasetId,
    epoch: manifest.epoch,
    revision: manifest.revision,
    config: {
      ...settings.config,
      updatedAt: manifest.configUpdatedAt,
      groups: items('groups') as SyncEnvelope['config']['groups'],
      shortcuts: items('shortcuts') as SyncEnvelope['config']['shortcuts'],
    },
    pieces: items('pieces') as SyncEnvelope['pieces'],
    metadata: { tombstones: items('tombstones') as SyncEnvelope['metadata']['tombstones'] },
  };
}

function normalizeEnvelope(envelope: SyncEnvelope): SyncEnvelope {
  const normalized = structuredClone(envelope);
  normalized.pieces ??= [];
  normalized.pieces.sort((left, right) => left.id.localeCompare(right.id));
  normalized.config.groups.sort(compareBySortKey);
  normalized.config.shortcuts.sort(compareBySortKey);
  normalized.metadata.tombstones.sort((left, right) =>
    left.entityType.localeCompare(right.entityType)
      || left.entityId.localeCompare(right.entityId)
      || left.revision.counter - right.revision.counter
      || left.revision.deviceId.localeCompare(right.revision.deviceId),
  );
  return normalized;
}

function metadataFrom(head: ActiveHead, manifest: Manifest): RemoteMetadata {
  return {
    datasetId: manifest.datasetId,
    revision: manifest.revision,
    hash: manifest.envelopeHash,
    epoch: manifest.epoch,
    version: head.version,
  };
}

function revisionVersion(revision: Revision): string {
  return `${revision.counter}:${revision.deviceId}`;
}

function encodedItemBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key + JSON.stringify(value)).byteLength;
}

function compareRevision(left: Revision, right: Revision): number {
  if (left.counter !== right.counter) return left.counter - right.counter;
  return left.deviceId.localeCompare(right.deviceId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_SYNC_ERROR';
}
