import { describe, expect, it } from 'vitest';
import { createInitialConfig } from '../../core/domain/defaults';
import type { DeviceIdentity } from '../../core/domain/types';
import { createEnvelope } from '../../core/sync/engine';
import { MemorySyncAdapter } from '../support/memory-sync-adapter';

describe.each(['google-drive-future', 'webdav-future'])('%s SyncAdapter contract', (providerId) => {
  it('transports a complete provider-neutral envelope', async () => {
    const identity: DeviceIdentity = { deviceId: 'test', counter: 0, epoch: 0 };
    const config = createInitialConfig(identity);
    const envelope = createEnvelope(config, { tombstones: [] }, { counter: identity.counter, deviceId: identity.deviceId }, 0);
    const adapter = new MemorySyncAdapter(providerId);
    await adapter.enable();
    await adapter.push(envelope);
    expect(await adapter.pull()).toEqual(envelope);
    expect(JSON.stringify(await adapter.pull())).not.toMatch(/sync\/bucket|activeHead|base64/i);
  });
});
