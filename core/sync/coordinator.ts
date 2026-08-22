import { applySyncProjection, createEnvelope, envelopeContainsRevision, mergeThreeWay } from './engine';
import { base64ToBytes, bytesToBase64, canonicalStringify, gunzipJson, gzipJson, sha256 } from './codec';
import type { ProviderCursor, SyncEnvelope, SyncMode } from '../domain/types';
import { compareRevision, nextRevision } from '../domain/revision';
import type { AppConfig } from '../domain/types';
import { selectRemovableTombstones } from './tombstones';
import type { SyncAdapter } from './adapter';
import type { SyncRepository } from '../storage/ports';
import type { SyncStatusRecord, SyncStatusStore } from './status-store';

export type SyncCoordinatorDependencies = {
  adapter: SyncAdapter;
  repository: SyncRepository;
  statusStore: SyncStatusStore;
  providerMode: Exclude<SyncMode, 'local'>;
  refreshWallpaper(config: AppConfig): Promise<void>;
};

/**
 * Orchestrates provider-neutral pull, merge, commit, acknowledgement, and
 * tombstone compaction without knowing the provider's storage representation.
 */
export class SyncCoordinator {
  private readonly adapter: SyncAdapter;
  private readonly repository: SyncRepository;
  private readonly statusStore: SyncStatusStore;
  private readonly providerMode: Exclude<SyncMode, 'local'>;
  private readonly refreshWallpaper: (config: AppConfig) => Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private rerun = false;
  private lastCommitAt = 0;

  constructor({ adapter, repository, statusStore, providerMode, refreshWallpaper }: SyncCoordinatorDependencies) {
    this.adapter = adapter;
    this.repository = repository;
    this.statusStore = statusStore;
    this.providerMode = providerMode;
    this.refreshWallpaper = refreshWallpaper;
  }

  schedule(delay = 3_000): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, delay);
  }

  async run(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.perform().finally(() => {
      this.running = undefined;
      if (this.rerun) {
        this.rerun = false;
        this.schedule(0);
      }
    });
    return this.running;
  }

  async setMode(mode: 'local' | 'chrome', force = false): Promise<void> {
    const current = await this.repository.getSyncMode();
    if (mode === current) return;
    if (mode === 'local' && force) {
      await this.repository.createCheckpoint();
      const cursor = await this.repository.getCursor(this.adapter.providerId);
      if (cursor) await this.repository.putCursor({ ...cursor, needsReconciliation: true });
      await this.repository.setSyncMode('local');
      await this.adapter.disable();
      await this.setStatus({ state: 'disabled', message: 'LOCAL_WITH_RECONCILIATION_REQUIRED' });
      return;
    }
    if (this.running) await this.running;
    this.lastCommitAt = 0;
    await this.adapter.enable();
    if (mode === 'local') await this.run();
    else await this.perform(true);
    const syncStatus = await this.statusStore.get();
    if (!syncStatus || ['error', 'conflict', 'syncing'].includes(syncStatus.state)) {
      if (mode === 'local') throw new Error('FINAL_SYNC_REQUIRED');
      return;
    }
    await this.repository.createCheckpoint();
    await this.repository.setSyncMode(mode);
    if (mode === 'local') {
      await this.adapter.disable();
      await this.setStatus({ state: 'disabled' });
    }
  }

  async resolveConflict(choice: 'local-overwrite' | 'remote-replace' | 'external-import'): Promise<void> {
    const remote = await this.adapter.pull();
    if (!remote) return this.run();
    if (choice === 'remote-replace') {
      await this.repository.createCheckpoint();
      const local = await this.repository.getConfig();
      const identity = await this.repository.getDeviceIdentity();
      identity.counter = Math.max(identity.counter, remote.revision.counter);
      identity.epoch = remote.epoch;
      const config = applySyncProjection(local, remote.config);
      await this.repository.replaceFromSync(config, remote.metadata, identity, await cursorFrom(remote, this.adapter.providerId), { discardOutbox: true, pieces: remote.pieces });
      await this.refreshWallpaper(config);
      await this.confirm(remote);
    } else if (choice === 'external-import') {
      await this.repository.createCheckpoint();
      const local = await this.repository.getConfig();
      await this.repository.importExternalSync(applySyncProjection(local, remote.config));
      await this.commitLocal(true);
    } else {
      await this.commitLocal(true);
    }
    await this.statusStore.clearConflict();
    await this.repository.setSyncMode(this.providerMode);
    this.schedule(0);
  }

  private async perform(ignoreMode = false): Promise<void> {
    await this.repository.initialize();
    if (!ignoreMode && await this.repository.getSyncMode() === 'local') {
      await this.setStatus({ state: 'disabled' });
      return;
    }
    await this.setStatus({ state: 'syncing' });
    try {
      const localConfig = await this.repository.getConfig();
      const identity = await this.repository.getDeviceIdentity();
      const localEnvelope = createEnvelope(localConfig, await this.repository.getMetadata(), { counter: identity.counter, deviceId: identity.deviceId }, identity.epoch, await this.repository.getPieces());
      const remoteMetadata = await this.adapter.getRemoteMetadata();
      if (!remoteMetadata) {
        await this.commitEnvelope(localEnvelope);
        return;
      }
      if (remoteMetadata.datasetId !== localConfig.datasetId) {
        await this.reportConflict('DATASET_MISMATCH', localEnvelope, await this.adapter.pull());
        return;
      }
      if (remoteMetadata.epoch !== identity.epoch) {
        if (remoteMetadata.epoch < identity.epoch) {
          // A destructive local piece-model reset intentionally supersedes an
          // older remote epoch; never let stale data resurrect old positions.
          await this.commitEnvelope(localEnvelope, true);
          return;
        }
        await this.repository.createCheckpoint();
        const remote = await this.requireRemote();
        identity.counter = Math.max(identity.counter, remote.revision.counter);
        identity.epoch = remote.epoch;
        const config = applySyncProjection(localConfig, remote.config);
        await this.repository.replaceFromSync(config, remote.metadata, identity, await cursorFrom(remote, this.adapter.providerId), { discardOutbox: true, pieces: remote.pieces });
        await this.refreshWallpaper(config);
        await this.confirm(remote);
        return;
      }
      const cursor = await this.repository.getCursor(this.adapter.providerId);
      if (!cursor) {
        await this.reportConflict('BASELINE_MISSING', localEnvelope, await this.adapter.pull());
        return;
      }
      const outbox = await this.repository.getOutbox();
      if (cursor.remoteVersion === remoteMetadata.version && cursor.baseSnapshotHash === remoteMetadata.hash) {
        let baseline: SyncEnvelope;
        try {
          baseline = gunzipJson<SyncEnvelope>(base64ToBytes(cursor.compressedBaseline));
          if (await sha256(canonicalStringify(baseline)) !== cursor.baseSnapshotHash) throw new Error('BASELINE_HASH_MISMATCH');
        } catch {
          await this.reportConflict('BASELINE_CORRUPT', localEnvelope, await this.adapter.pull());
          return;
        }
        const alreadyConfirmed = outbox.filter((entry) => envelopeContainsRevision(baseline, entry.entityType, entry.entityId, entry.revision));
        if (alreadyConfirmed.length) await this.repository.removeOutbox(alreadyConfirmed.map((entry) => entry.opId));
        if (alreadyConfirmed.length < outbox.length) {
          await this.commitEnvelope(localEnvelope);
        } else {
          await this.writeAck(identity.deviceId, remoteMetadata.revision, identity.epoch);
          await this.refreshWallpaper(localConfig);
          if (!await this.maybeCompactTombstones(baseline)) await this.setAdapterStatus();
        }
        return;
      }
      const remote = await this.requireRemote();
      let base: SyncEnvelope;
      try {
        base = gunzipJson<SyncEnvelope>(base64ToBytes(cursor.compressedBaseline));
        if (base.datasetId !== localEnvelope.datasetId) throw new Error('BASELINE_DATASET_MISMATCH');
      } catch {
        await this.reportConflict('BASELINE_CORRUPT', localEnvelope, remote);
        return;
      }
      const merged = mergeThreeWay(base, localEnvelope, remote, identity);
      await this.repository.createCheckpoint();
      const mergedConfig = applySyncProjection(localConfig, merged.config);
      await this.repository.replaceFromSync(mergedConfig, merged.metadata, identity, await cursorFrom(remote, this.adapter.providerId), { pendingRevision: merged.revision, pieces: merged.pieces });
      await this.refreshWallpaper(mergedConfig);
      await this.commitEnvelope(merged);
    } catch (error) {
      await this.setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async commitLocal(force = false): Promise<void> {
    const config = await this.repository.getConfig();
    const identity = await this.repository.getDeviceIdentity();
    const envelope = createEnvelope(config, await this.repository.getMetadata(), { counter: identity.counter, deviceId: identity.deviceId }, identity.epoch, await this.repository.getPieces());
    await this.commitEnvelope(envelope, force);
  }

  private async commitEnvelope(envelope: SyncEnvelope, force = false): Promise<void> {
    const wait = 10_000 - (Date.now() - this.lastCommitAt);
    if (!force && wait > 0) {
      this.schedule(wait);
      return;
    }
    const metadata = await this.adapter.push(envelope);
    this.lastCommitAt = Date.now();
    const confirmed = await this.requireRemote();
    if (metadata.hash !== await sha256(canonicalStringify(confirmed))) throw new Error('REMOTE_READBACK_HASH_MISMATCH');
    await this.repository.putCursor(await cursorFrom(confirmed, this.adapter.providerId));
    await this.confirm(confirmed);
  }

  private async confirm(envelope: SyncEnvelope): Promise<void> {
    const identity = await this.repository.getDeviceIdentity();
    await this.writeAck(identity.deviceId, envelope.revision, envelope.epoch);
    const confirmed = (await this.repository.getOutbox())
      .filter((entry) => envelopeContainsRevision(envelope, entry.entityType, entry.entityId, entry.revision))
      .map((entry) => entry.opId);
    await this.repository.removeOutbox(confirmed);
    await this.setAdapterStatus();
  }

  private async maybeCompactTombstones(envelope: SyncEnvelope): Promise<boolean> {
    if (!this.adapter.removeExpiredAcks || !this.adapter.getAcks || !this.adapter.writeAck) return false;
    const expired = await this.adapter.removeExpiredAcks();
    const acks = Object.values(await this.adapter.getAcks());
    const removable = selectRemovableTombstones(envelope.metadata.tombstones, acks, envelope.epoch);
    if (!expired.length && !removable.length) return false;
    const wait = 10_000 - (Date.now() - this.lastCommitAt);
    if (wait > 0) {
      this.schedule(wait);
      await this.setAdapterStatus();
      return true;
    }
    await this.repository.createCheckpoint();
    const identity = await this.repository.getDeviceIdentity();
    identity.epoch = envelope.epoch + 1;
    const compacted: SyncEnvelope = {
      ...structuredClone(envelope),
      epoch: identity.epoch,
      revision: nextRevision(identity, envelope.revision),
      metadata: {
        tombstones: envelope.metadata.tombstones.filter((tombstone) => !removable.some((item) =>
          item.entityType === tombstone.entityType && item.entityId === tombstone.entityId,
        )),
      },
    };
    await this.adapter.push(compacted);
    this.lastCommitAt = Date.now();
    const confirmed = await this.requireRemote();
    if (await sha256(canonicalStringify(confirmed)) !== await sha256(canonicalStringify(compacted))) {
      this.rerun = true;
      return true;
    }
    await this.repository.updateSyncControl(confirmed.metadata, identity, await cursorFrom(confirmed, this.adapter.providerId));
    await this.adapter.writeAck(identity.deviceId, confirmed.revision, confirmed.epoch);
    await this.setAdapterStatus();
    return true;
  }

  private async requireRemote(): Promise<SyncEnvelope> {
    const envelope = await this.adapter.pull();
    if (!envelope) throw new Error('REMOTE_DATA_MISSING');
    return envelope;
  }

  private async reportConflict(reason: string, local: SyncEnvelope, remote: SyncEnvelope | null): Promise<void> {
    const conflict = {
      reason,
      local: { datasetId: local.datasetId, groups: local.config.groups.length, shortcuts: local.config.shortcuts.length },
      remote: remote ? { datasetId: remote.datasetId, groups: remote.config.groups.length, shortcuts: remote.config.shortcuts.length } : null,
      summary: remote ? summarizeConflict(local, remote) : null,
    };
    await this.statusStore.setConflict(conflict);
    await this.setStatus({ state: 'conflict', message: reason });
  }

  private async setAdapterStatus(): Promise<void> {
    const status = this.adapter.getStatus();
    await this.setStatus({ state: status.state === 'disabled' ? 'disabled' : status.state, message: status.message, usedBytes: status.usedBytes });
  }

  private async setStatus(status: Omit<SyncStatusRecord, 'updatedAt'>): Promise<void> {
    await this.statusStore.set(status);
  }

  private async writeAck(deviceId: string, revision: SyncEnvelope['revision'], epoch: number): Promise<void> {
    await this.adapter.writeAck?.(deviceId, revision, epoch);
  }
}

async function cursorFrom(envelope: SyncEnvelope, providerId: string): Promise<ProviderCursor> {
  const hash = await sha256(canonicalStringify(envelope));
  return {
    providerId,
    datasetId: envelope.datasetId,
    baseRevision: envelope.revision,
    baseSnapshotHash: hash,
    compressedBaseline: bytesToBase64(gzipJson(envelope)),
    remoteVersion: `${envelope.revision.counter}:${envelope.revision.deviceId}`,
    lastSyncedAt: new Date().toISOString(),
    needsReconciliation: false,
  };
}

function summarizeConflict(local: SyncEnvelope, remote: SyncEnvelope) {
  const localEntities = new Map([...local.config.groups, ...local.config.shortcuts].map((item) => [item.id, item]));
  const remoteEntities = new Map([...remote.config.groups, ...remote.config.shortcuts].map((item) => [item.id, item]));
  let onlyLocal = 0;
  let onlyRemote = 0;
  let bothModified = 0;
  for (const [id, entity] of localEntities) {
    const other = remoteEntities.get(id);
    if (!other) onlyLocal += 1;
    else if (compareRevision(entity.revision, other.revision) !== 0) bothModified += 1;
  }
  for (const id of remoteEntities.keys()) if (!localEntities.has(id)) onlyRemote += 1;
  const deleteModifyConflicts = local.metadata.tombstones.filter((item) => remoteEntities.has(item.entityId)).length
    + remote.metadata.tombstones.filter((item) => localEntities.has(item.entityId)).length;
  return {
    onlyLocal,
    onlyRemote,
    bothModified,
    deleteModifyConflicts,
    estimatedResult: localEntities.size + onlyRemote,
  };
}
