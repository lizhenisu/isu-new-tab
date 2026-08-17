import { describe, expect, it } from 'vitest';
import { selectRemovableTombstones } from '../../core/sync/tombstones';

describe('tombstone acknowledgement', () => {
  const tombstone = { entityType: 'shortcut' as const, entityId: 'deleted', revision: { counter: 5, deviceId: 'a' } };

  it('removes a tombstone only after every active device acknowledges it in the same epoch', () => {
    expect(selectRemovableTombstones([tombstone], [
      { revision: { counter: 6, deviceId: 'a' }, epoch: 2, lastSeen: new Date().toISOString() },
      { revision: { counter: 5, deviceId: 'z' }, epoch: 2, lastSeen: new Date().toISOString() },
    ], 2)).toEqual([tombstone]);
    expect(selectRemovableTombstones([tombstone], [
      { revision: { counter: 6, deviceId: 'a' }, epoch: 2, lastSeen: new Date().toISOString() },
      { revision: { counter: 4, deviceId: 'z' }, epoch: 2, lastSeen: new Date().toISOString() },
    ], 2)).toEqual([]);
  });

  it('keeps the tombstone when a device still belongs to an older epoch', () => {
    expect(selectRemovableTombstones([tombstone], [
      { revision: { counter: 8, deviceId: 'a' }, epoch: 1, lastSeen: new Date().toISOString() },
    ], 2)).toEqual([]);
  });
});
