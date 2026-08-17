import type { SyncEnvelope } from '../../core/domain/types';
import type { AdapterStatus, RemoteMetadata, SyncAdapter } from '../../core/sync/adapter';
import { canonicalStringify, sha256 } from '../../core/sync/codec';

export class MemorySyncAdapter implements SyncAdapter {
  readonly providerId: string;
  readonly capabilities = { conditionalWrite: true, incremental: false };
  private envelope: SyncEnvelope | null = null;
  private enabled = false;

  constructor(providerId: string) {
    this.providerId = providerId;
  }

  async enable() { this.enabled = true; }
  async disable() { this.enabled = false; }
  async getRemoteMetadata(): Promise<RemoteMetadata | null> {
    if (!this.envelope) return null;
    return {
      datasetId: this.envelope.datasetId,
      revision: this.envelope.revision,
      hash: await sha256(canonicalStringify(this.envelope)),
      epoch: this.envelope.epoch,
      version: `${this.envelope.revision.counter}:${this.envelope.revision.deviceId}`,
    };
  }
  async pull() { return this.envelope ? structuredClone(this.envelope) : null; }
  async push(envelope: SyncEnvelope) {
    if (!this.enabled) throw new Error('SYNC_DISABLED');
    this.envelope = structuredClone(envelope);
    return (await this.getRemoteMetadata())!;
  }
  async remove() { this.envelope = null; }
  getStatus(): AdapterStatus { return { state: this.enabled ? 'idle' : 'disabled' }; }
}
