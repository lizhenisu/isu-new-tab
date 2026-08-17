import { compareRevision } from '../domain/revision';
import type { Tombstone } from '../domain/types';
import type { DeviceAck } from './adapter';

export function selectRemovableTombstones(tombstones: Tombstone[], acks: DeviceAck[], epoch: number): Tombstone[] {
  return tombstones.filter((tombstone) =>
    acks.length > 0 && acks.every((ack) => ack.epoch === epoch && compareRevision(ack.revision, tombstone.revision) >= 0),
  );
}
