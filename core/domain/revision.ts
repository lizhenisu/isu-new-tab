import type { DeviceIdentity, Revision } from './types';

export function compareRevision(left: Revision, right: Revision): number {
  if (left.counter !== right.counter) return left.counter - right.counter;
  return left.deviceId.localeCompare(right.deviceId);
}

export function maxRevision(left: Revision, right: Revision): Revision {
  return compareRevision(left, right) >= 0 ? left : right;
}

export function nextRevision(identity: DeviceIdentity, observed?: Revision): Revision {
  identity.counter = Math.max(identity.counter, observed?.counter ?? 0) + 1;
  return { counter: identity.counter, deviceId: identity.deviceId };
}

export function sameRevision(left: Revision, right: Revision): boolean {
  return left.counter === right.counter && left.deviceId === right.deviceId;
}
