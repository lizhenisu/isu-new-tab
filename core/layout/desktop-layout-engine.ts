import {
  DASHBOARD_COLUMNS,
  type WidgetPosition,
} from '../domain/widgets';
import {
  desktopItems,
  firstFreePosition,
  normalizeTarget,
  overlaps,
  samePosition,
  snapshotWithDesktopItems,
  type DesktopItem,
  type DesktopNode,
  type DesktopSnapshot,
} from '../domain/desktop';
import { collisionRectFor, collisionRectsOverlap, type DesktopCollisionGeometry } from './desktop-collision';

export type DragDirection = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export type DesktopLayoutResult = {
  success: true;
  snapshot: DesktopSnapshot;
  items: DesktopItem[];
  movedKeys: string[];
};

/** Deterministic launcher-style placement over a vertically expanding grid. */
export function placeDesktopNode(
  snapshot: DesktopSnapshot,
  activeKey: string,
  target: WidgetPosition,
  direction: DragDirection = { x: 0, y: 1 },
  geometry?: DesktopCollisionGeometry,
): DesktopLayoutResult {
  const original = desktopItems(snapshot);
  const active = original.find((item) => item.key === activeKey);
  if (!active) throw new Error('DESKTOP_ITEM_NOT_FOUND');
  const normalized = normalizeTarget(target, active.position);
  const stationary = original.filter((item) => item.key !== activeKey);
  const lockedActive = { ...active, position: normalized } as DesktopItem;
  const blockers = stationary.filter((item) => itemsOverlap(item, normalized, activeKey, geometry));
  if (!blockers.length) return result(snapshot, original, [lockedActive, ...stationary]);

  const candidates: DesktopItem[][] = [];
  for (const pushDirection of orderedDirections(direction)) {
    const pushed = pushRigidCluster(stationary, blockers.map((item) => item.key), normalized, activeKey, pushDirection, geometry);
    if (pushed) candidates.push([lockedActive, ...pushed]);
  }
  candidates.push([lockedActive, ...relocateBlockers(stationary, blockers, normalized, activeKey, direction, geometry)]);
  candidates.sort((left, right) => compareLayouts(original, activeKey, direction, left, right));
  return result(snapshot, original, candidates[0]!);
}

export function placeNewDesktopNode(
  snapshot: DesktopSnapshot,
  node: DesktopNode & { container: { kind: 'desktop' }; position: WidgetPosition },
  target = node.position,
  direction: DragDirection = { x: 0, y: 1 },
  geometry?: DesktopCollisionGeometry,
): DesktopLayoutResult {
  const withNode = snapshotWithDesktopItems(snapshot, [...desktopItems(snapshot), node as DesktopItem]);
  return placeDesktopNode(withNode, node.key, target, direction, geometry);
}

export function repairDesktopSnapshot(snapshot: DesktopSnapshot): DesktopLayoutResult {
  const original = desktopItems(snapshot);
  const next = original.map((item) => ({ ...item, position: { ...item.position } })) as DesktopItem[];
  const components = overlapComponents(next);
  for (const component of components.filter((items) => items.length > 1)) {
    const ordered = [...component].sort(compareRepairPriority);
    const winner = ordered.shift()!;
    const componentKeys = new Set(component.map((item) => item.key));
    const occupied = next.filter((item) => !componentKeys.has(item.key)).map((item) => item.position);
    occupied.push(winner.position);
    for (const item of ordered) {
      item.position = firstFreePosition(occupied, item.position, item.position);
      occupied.push(item.position);
    }
  }
  return result(snapshot, original, next);
}

export function hasDesktopCollisions(snapshot: DesktopSnapshot): boolean {
  return overlapComponents(desktopItems(snapshot)).some((component) => component.length > 1);
}

function itemsOverlap(
  left: Pick<DesktopItem, 'key' | 'position'>,
  rightPosition: WidgetPosition,
  rightKey: string,
  geometry?: DesktopCollisionGeometry,
): boolean {
  return positionsOverlap(left.key, left.position, rightKey, rightPosition, geometry);
}

export function desktopItemsIntersect(
  leftKey: string,
  leftPosition: WidgetPosition,
  rightKey: string,
  rightPosition: WidgetPosition,
  geometry?: DesktopCollisionGeometry,
): boolean {
  return positionsOverlap(leftKey, leftPosition, rightKey, rightPosition, geometry);
}

function positionsOverlap(
  leftKey: string,
  leftPosition: WidgetPosition,
  rightKey: string,
  rightPosition: WidgetPosition,
  geometry?: DesktopCollisionGeometry,
): boolean {
  if (!geometry) return overlaps(leftPosition, rightPosition);
  const leftRect = collisionRectFor(leftKey, leftPosition, geometry);
  const rightRect = collisionRectFor(rightKey, rightPosition, geometry);
  return leftRect && rightRect ? collisionRectsOverlap(leftRect, rightRect) : overlaps(leftPosition, rightPosition);
}

function pushRigidCluster(
  stationary: DesktopItem[],
  initialKeys: string[],
  activeRect: WidgetPosition,
  activeKey: string,
  direction: DragDirection,
  geometry?: DesktopCollisionGeometry,
): DesktopItem[] | undefined {
  if (direction.x === 0 && direction.y === 0) return;
  // Only the blockers that intersect the active target are movable in this
  // pass. Nodes encountered while pushing them remain fixed; expanding the
  // cluster here made an unrelated add tile drift when a displaced widget
  // crossed its path.
  const cluster = new Set(initialKeys);
  const originals = new Map(stationary.map((item) => [item.key, item.position]));
  const maximum = Math.max(DASHBOARD_COLUMNS, ...stationary.map((item) => item.position.row + item.position.height)) + 100;
  for (let distance = 1; distance <= maximum; distance += 1) {
    const moved = stationary.map((item) => cluster.has(item.key)
      ? { ...item, position: translate(originals.get(item.key)!, direction, distance) } as DesktopItem
      : item);
    const clusterItems = moved.filter((item) => cluster.has(item.key));
    if (clusterItems.some((item) => !inside(item.position))) break;
    if (clusterItems.some((item) => itemsOverlap(item, activeRect, activeKey, geometry))) continue;
    const collidesWithFixed = stationary.some((item) => !cluster.has(item.key)
      && clusterItems.some((candidate) => itemsOverlap(candidate, item.position, item.key, geometry)));
    if (collidesWithFixed) continue;
    return moved;
  }
}

function relocateBlockers(
  stationary: DesktopItem[],
  blockers: DesktopItem[],
  activeRect: WidgetPosition,
  activeKey: string,
  direction: DragDirection,
  geometry?: DesktopCollisionGeometry,
): DesktopItem[] {
  const blockerKeys = new Set(blockers.map((item) => item.key));
  const fixed = stationary.filter((item) => !blockerKeys.has(item.key));
  const occupied = [{ key: activeKey, position: activeRect }, ...fixed.map((item) => ({ key: item.key, position: item.position }))];
  const replacements = new Map<string, DesktopItem>();
  for (const item of [...blockers].sort((left, right) => left.key.localeCompare(right.key))) {
    const position = nearestFree(occupied, item, direction, geometry);
    occupied.push({ key: item.key, position });
    replacements.set(item.key, { ...item, position } as DesktopItem);
  }
  return stationary.map((item) => replacements.get(item.key) ?? item);
}

function nearestFree(
  occupied: Array<{ key: string; position: WidgetPosition }>,
  originItem: DesktopItem,
  direction: DragDirection,
  geometry?: DesktopCollisionGeometry,
): WidgetPosition {
  const origin = originItem.position;
  const maximum = Math.max(DASHBOARD_COLUMNS, ...occupied.map((item) => item.position.row + item.position.height)) + 100;
  for (let radius = 1; radius <= maximum; radius += 1) {
    const candidates: WidgetPosition[] = [];
    for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
      const columnOffset = radius - Math.abs(rowOffset);
      for (const signed of columnOffset === 0 ? [0] : [-columnOffset, columnOffset]) {
        const candidate = { ...origin, column: origin.column + signed, row: origin.row + rowOffset, gridVersion: 3 as const };
        if (inside(candidate)) candidates.push(candidate);
      }
    }
    candidates.sort((left, right) => directionPenalty(origin, direction, left) - directionPenalty(origin, direction, right)
      || left.row - right.row || left.column - right.column);
    const available = candidates.find((candidate) => !occupied.some((item) => positionsOverlap(originItem.key, candidate, item.key, item.position, geometry)));
    if (available) return available;
  }
  return firstFreePosition(occupied.map((item) => item.position), origin, { column: origin.column, row: Math.max(...occupied.map((item) => item.position.row + item.position.height)) });
}

function result(snapshot: DesktopSnapshot, original: DesktopItem[], items: DesktopItem[]): DesktopLayoutResult {
  const ordered = [...items].sort((left, right) => left.key.localeCompare(right.key));
  const before = new Map(original.map((item) => [item.key, item.position]));
  return {
    success: true,
    snapshot: snapshotWithDesktopItems(snapshot, ordered),
    items: ordered,
    movedKeys: ordered.filter((item) => !samePosition(before.get(item.key), item.position)).map((item) => item.key),
  };
}

function compareLayouts(
  original: DesktopItem[],
  activeKey: string,
  direction: DragDirection,
  left: DesktopItem[],
  right: DesktopItem[],
): number {
  const score = (items: DesktopItem[]) => {
    const positions = new Map(items.map((item) => [item.key, item.position]));
    const distances = original.filter((item) => item.key !== activeKey).map((item) => distance(item.position, positions.get(item.key)!));
    const moved = distances.filter(Boolean);
    const relativeChanges = relativeOrderChanges(original, items, activeKey);
    const penalty = original.filter((item) => item.key !== activeKey).reduce((sum, item) => sum + directionPenalty(item.position, direction, positions.get(item.key)!), 0);
    return [moved.length, moved.reduce((sum, value) => sum + value, 0), Math.max(0, ...moved), relativeChanges, penalty] as const;
  };
  const a = score(left);
  const b = score(right);
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return layoutKey(left).localeCompare(layoutKey(right));
}

function relativeOrderChanges(before: DesktopItem[], after: DesktopItem[], activeKey: string): number {
  const original = [...before].filter((item) => item.key !== activeKey).sort(rowOrder);
  const nextIndex = new Map([...after].filter((item) => item.key !== activeKey).sort(rowOrder).map((item, index) => [item.key, index]));
  let changes = 0;
  for (let left = 0; left < original.length; left += 1) {
    for (let right = left + 1; right < original.length; right += 1) {
      if ((nextIndex.get(original[left]!.key) ?? left) > (nextIndex.get(original[right]!.key) ?? right)) changes += 1;
    }
  }
  return changes;
}

function overlapComponents(items: DesktopItem[]): DesktopItem[][] {
  const unseen = new Set(items.map((item) => item.key));
  const byKey = new Map(items.map((item) => [item.key, item]));
  const components: DesktopItem[][] = [];
  while (unseen.size) {
    const first = [...unseen].sort()[0]!;
    unseen.delete(first);
    const component: DesktopItem[] = [];
    const queue = [byKey.get(first)!];
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const key of [...unseen].sort()) {
        const candidate = byKey.get(key)!;
        if (component.some((item) => overlaps(item.position, candidate.position))) {
          unseen.delete(key);
          queue.push(candidate);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function compareRepairPriority(left: DesktopItem, right: DesktopItem): number {
  return right.revision.counter - left.revision.counter
    || right.revision.deviceId.localeCompare(left.revision.deviceId)
    || kindPriority(left) - kindPriority(right)
    || left.key.localeCompare(right.key);
}

function kindPriority(item: DesktopItem): number {
  return item.kind === 'system-widget' ? 0 : item.kind === 'add-shortcut' ? 1 : item.kind === 'folder' ? 2 : 3;
}

function orderedDirections(direction: DragDirection): DragDirection[] {
  const preferred = Math.abs(direction.x) >= Math.abs(direction.y) && direction.x !== 0
    ? [{ x: direction.x, y: 0 }, { x: 0, y: direction.y || 1 }]
    : [{ x: 0, y: direction.y || 1 }, { x: direction.x || 1, y: 0 }];
  const directions = [...preferred, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }] as DragDirection[];
  return directions.filter((value, index) => value.x !== 0 || value.y !== 0)
    .filter((value, index, all) => all.findIndex((candidate) => candidate.x === value.x && candidate.y === value.y) === index);
}

function translate(position: WidgetPosition, direction: DragDirection, distance: number): WidgetPosition {
  return { ...position, column: position.column + direction.x * distance, row: position.row + direction.y * distance, gridVersion: 3 };
}

function inside(position: WidgetPosition): boolean {
  return position.column >= 0 && position.row >= 0 && position.column + position.width <= DASHBOARD_COLUMNS;
}

function distance(left: WidgetPosition, right: WidgetPosition): number {
  return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}

function directionPenalty(origin: WidgetPosition, direction: DragDirection, candidate: WidgetPosition): number {
  const deltaX = candidate.column - origin.column;
  const deltaY = candidate.row - origin.row;
  return Math.max(0, -(deltaX * direction.x + deltaY * direction.y));
}

function rowOrder(left: DesktopItem, right: DesktopItem): number {
  return left.position.row - right.position.row || left.position.column - right.position.column || left.key.localeCompare(right.key);
}

function layoutKey(items: DesktopItem[]): string {
  return [...items].sort((left, right) => left.key.localeCompare(right.key))
    .map((item) => `${item.key}:${item.position.column},${item.position.row}`).join('|');
}
