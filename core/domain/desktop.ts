import { compareBySortKey } from './sort';
import { DEFAULT_GROUP_ID, type AppConfig, type Shortcut, type ShortcutGroup } from './types';
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_ROW_HEIGHT,
  resolveWidgetLayout,
  type SystemWidgetId,
  type WidgetPosition,
  type WidgetSizePreset,
} from './widgets';

export const DESKTOP_ICON_SIZE = { width: 4, height: 3 } as const;

export type DesktopItem =
  | { kind: 'system-widget'; key: `widget:${SystemWidgetId}`; id: SystemWidgetId; position: WidgetPosition; sizePreset: WidgetSizePreset; movable: true }
  | { kind: 'shortcut'; key: `shortcut:${string}`; entity: Shortcut; position: WidgetPosition; movable: true }
  | { kind: 'folder'; key: `folder:${string}`; entity: ShortcutGroup; children: Shortcut[]; position: WidgetPosition; movable: true }
  | { kind: 'add-shortcut'; key: 'add-shortcut'; position: WidgetPosition; movable: true };

export type DesktopPlacement = {
  kind: 'system-widget' | 'shortcut' | 'folder' | 'add-shortcut';
  id: string;
  position: WidgetPosition;
  sizePreset?: WidgetSizePreset;
};

export type SystemWidgetFootprintOverrides = Partial<Record<SystemWidgetId, Partial<Pick<WidgetPosition, 'width' | 'height'>>>>;

export function measuredWidthToGridColumns(measuredWidth: number, boardWidth: number): number {
  if (!Number.isFinite(measuredWidth) || !Number.isFinite(boardWidth) || measuredWidth <= 0 || boardWidth <= 0) return 1;
  const columnWidth = boardWidth / DASHBOARD_COLUMNS;
  return Math.max(1, Math.min(DASHBOARD_COLUMNS, Math.ceil((measuredWidth - 0.5) / columnWidth)));
}

export function measuredSizeToGridFootprint(measuredWidth: number, measuredHeight: number, boardWidth: number): Pick<WidgetPosition, 'width' | 'height'> {
  const height = Number.isFinite(measuredHeight) && measuredHeight > 0
    ? Math.max(1, Math.ceil((measuredHeight - 0.5) / DASHBOARD_ROW_HEIGHT))
    : 1;
  return { width: measuredWidthToGridColumns(measuredWidth, boardWidth), height };
}

export function centeredGridSpan(span: number, columns = DASHBOARD_COLUMNS): number {
  const normalized = Math.max(1, Math.min(columns, Math.round(span)));
  return (columns - normalized) % 2 === 0 ? normalized : Math.min(columns, normalized + 1);
}

export function isHorizontallyCentered(position: WidgetPosition, columns = DASHBOARD_COLUMNS): boolean {
  return position.column === Math.round((columns - position.width) / 2);
}

export function firstFreePosition(
  occupied: WidgetPosition[],
  size: Pick<WidgetPosition, 'width' | 'height'> = DESKTOP_ICON_SIZE,
  start: Pick<WidgetPosition, 'column' | 'row'> = { column: 0, row: 0 },
): WidgetPosition {
  const startIndex = Math.max(0, start.row * DASHBOARD_COLUMNS + start.column);
  for (let index = startIndex; index < 100_000; index += 1) {
    const column = index % DASHBOARD_COLUMNS;
    const row = Math.floor(index / DASHBOARD_COLUMNS);
    if (column + size.width > DASHBOARD_COLUMNS) continue;
    const candidate: WidgetPosition = { column, row, width: size.width, height: size.height, gridVersion: 3 };
    if (!occupied.some((position) => overlaps(candidate, position))) return candidate;
  }
  throw new Error('DESKTOP_POSITION_EXHAUSTED');
}

export function resolveDesktopItems(config: AppConfig, footprintOverrides: SystemWidgetFootprintOverrides = {}): DesktopItem[] {
  const widgets: DesktopItem[] = [];
  const occupied: WidgetPosition[] = [];
  for (const item of resolveWidgetLayout(config.appearance.widgetLayout.value).filter((item) => item.enabled)) {
    const id = item.id as SystemWidgetId;
    const centered = isHorizontallyCentered(item.position);
    const override = footprintOverrides[id];
    const minimumWidth = override?.width ? clamp(override.width, 1, DASHBOARD_COLUMNS) : undefined;
    const measuredWidth = minimumWidth && centered ? centeredGridSpan(minimumWidth) : minimumWidth;
    const candidate = measuredWidth || override?.height
      ? {
          ...item.position,
          width: measuredWidth ?? item.position.width,
          height: Math.max(item.position.height, override?.height ?? item.position.height),
          column: centered && measuredWidth
            ? Math.round((DASHBOARD_COLUMNS - measuredWidth) / 2)
            : clamp(item.position.column, 0, DASHBOARD_COLUMNS - (measuredWidth ?? item.position.width)),
        }
      : item.position;
    const position = occupied.some((placed) => overlaps(candidate, placed))
      ? firstFreePosition(occupied, candidate, { column: candidate.column, row: candidate.row })
      : candidate;
    occupied.push(position);
    widgets.push({
      kind: 'system-widget',
      key: `widget:${id}` as `widget:${SystemWidgetId}`,
      id,
      position,
      sizePreset: item.sizePreset ?? 'medium',
      movable: true,
    });
  }
  const desktop: DesktopItem[] = [...widgets];
  for (const shortcut of config.shortcuts.filter((item) => item.groupId === DEFAULT_GROUP_ID).sort(compareBySortKey)) {
    const position = normalizedIconPosition(shortcut.position, occupied);
    occupied.push(position);
    desktop.push({ kind: 'shortcut', key: `shortcut:${shortcut.id}`, entity: shortcut, position, movable: true });
  }
  for (const group of config.groups.filter((item) => item.id !== DEFAULT_GROUP_ID).sort(compareBySortKey)) {
    const position = normalizedIconPosition(group.position, occupied);
    occupied.push(position);
    desktop.push({
      kind: 'folder',
      key: `folder:${group.id}`,
      entity: group,
      children: config.shortcuts.filter((item) => item.groupId === group.id).sort(compareBySortKey),
      position,
      movable: true,
    });
  }
  const storedAdd = config.appearance.widgetLayout.value.find((item) => item.id === 'addShortcut')?.position;
  const addPosition = normalizedIconPosition(storedAdd, occupied, positionAfterLast(occupied));
  desktop.push({ kind: 'add-shortcut', key: 'add-shortcut', position: addPosition, movable: true });
  return desktop;
}

export function reflowDesktopItems(items: DesktopItem[], activeKey: string, target: WidgetPosition): DesktopItem[] {
  const movable = items;
  const active = movable.find((item) => item.key === activeKey);
  if (!active) return items;
  const ordered = movable.filter((item) => item.key !== activeKey).sort(compareDesktopPosition);
  const placed: DesktopItem[] = [{ ...active, position: normalizeTarget(target, active.position) } as DesktopItem];
  for (const item of ordered) {
    const occupied = placed.map((candidate) => candidate.position);
    const position = occupied.some((candidate) => overlaps(item.position, candidate))
      ? firstFreePosition(occupied, item.position, { column: item.position.column, row: item.position.row })
      : item.position;
    placed.push({ ...item, position } as DesktopItem);
  }
  const byKey = new Map(placed.map((item) => [item.key, item]));
  return movable.map((item) => byKey.get(item.key) ?? item);
}

export function desktopPlacements(items: DesktopItem[]): DesktopPlacement[] {
  const placements: DesktopPlacement[] = [];
  for (const item of items) {
    if (item.kind === 'add-shortcut') placements.push({ kind: item.kind, id: 'addShortcut', position: item.position });
    else if (item.kind === 'system-widget') placements.push({ kind: item.kind, id: item.id, position: item.position, sizePreset: item.sizePreset });
    else placements.push({ kind: item.kind, id: item.entity.id, position: item.position });
  }
  return placements;
}

export function migrateDesktopPositions(config: AppConfig): {
  config: AppConfig;
  changedShortcuts: string[];
  changedGroups: string[];
  widgetLayoutChanged: boolean;
} {
  const next = structuredClone(config);
  const legacy = next.appearance.widgetLayout.value.find((item) => item.id === 'shortcuts');
  const storedAdd = next.appearance.widgetLayout.value.find((item) => item.id === 'addShortcut');
  const resolvedWidgets = resolveWidgetLayout(next.appearance.widgetLayout.value);
  let widgetLayoutChanged = Boolean(legacy) || !storedAdd
    || next.appearance.widgetLayout.value.some((item) => item.id !== 'shortcuts' && item.id !== 'addShortcut' && !item.sizePreset);
  next.appearance.widgetLayout.value = resolvedWidgets;
  const occupied = resolvedWidgets.filter((item) => item.enabled).map((item) => item.position);
  let addPosition: WidgetPosition | undefined;
  if (storedAdd?.position) {
    addPosition = normalizedIconPosition(storedAdd.position, occupied);
    occupied.push(addPosition);
  }
  let cursor = legacy?.position ? { column: legacy.position.column, row: legacy.position.row } : positionAfterLast(occupied);
  const changedShortcuts: string[] = [];
  const changedGroups: string[] = [];
  for (const shortcut of next.shortcuts.filter((item) => item.groupId === DEFAULT_GROUP_ID).sort(compareBySortKey)) {
    const position = normalizedIconPosition(shortcut.position, occupied, cursor);
    if (!samePosition(shortcut.position, position)) changedShortcuts.push(shortcut.id);
    shortcut.position = position;
    occupied.push(position);
    cursor = positionAfter(position);
  }
  for (const group of next.groups.filter((item) => item.id !== DEFAULT_GROUP_ID).sort(compareBySortKey)) {
    const position = normalizedIconPosition(group.position, occupied, cursor);
    if (!samePosition(group.position, position)) changedGroups.push(group.id);
    group.position = position;
    occupied.push(position);
    cursor = positionAfter(position);
  }
  addPosition ??= normalizedIconPosition(undefined, occupied, cursor);
  if (!samePosition(storedAdd?.position, addPosition)) widgetLayoutChanged = true;
  next.appearance.widgetLayout.value.push({ id: 'addShortcut', enabled: true, position: addPosition });
  return { config: next, changedShortcuts, changedGroups, widgetLayoutChanged };
}

export function repairDesktopEntityPositions(
  groups: ShortcutGroup[],
  shortcuts: Shortcut[],
  widgetLayout: AppConfig['appearance']['widgetLayout']['value'],
): { groups: ShortcutGroup[]; shortcuts: Shortcut[]; changedGroups: string[]; changedShortcuts: string[] } {
  const nextGroups = structuredClone(groups);
  const nextShortcuts = structuredClone(shortcuts);
  const occupied = resolveWidgetLayout(widgetLayout).filter((item) => item.enabled).map((item) => item.position);
  const addPosition = widgetLayout.find((item) => item.id === 'addShortcut' && item.enabled)?.position;
  if (addPosition) occupied.push(addPosition);
  const changedShortcuts: string[] = [];
  const changedGroups: string[] = [];
  for (const shortcut of nextShortcuts.filter((item) => item.groupId === DEFAULT_GROUP_ID).sort(compareBySortKey)) {
    const position = normalizedIconPosition(shortcut.position, occupied);
    if (!samePosition(shortcut.position, position)) changedShortcuts.push(shortcut.id);
    shortcut.position = position;
    occupied.push(position);
  }
  for (const group of nextGroups.filter((item) => item.id !== DEFAULT_GROUP_ID).sort(compareBySortKey)) {
    const position = normalizedIconPosition(group.position, occupied);
    if (!samePosition(group.position, position)) changedGroups.push(group.id);
    group.position = position;
    occupied.push(position);
  }
  return { groups: nextGroups, shortcuts: nextShortcuts, changedGroups, changedShortcuts };
}

export function overlaps(left: WidgetPosition, right: WidgetPosition): boolean {
  return left.column < right.column + right.width
    && left.column + left.width > right.column
    && left.row < right.row + right.height
    && left.row + left.height > right.row;
}

function normalizedIconPosition(
  position: WidgetPosition | undefined,
  occupied: WidgetPosition[],
  start?: Pick<WidgetPosition, 'column' | 'row'>,
): WidgetPosition {
  if (position) {
    const normalized: WidgetPosition = {
      column: clamp(position.column, 0, DASHBOARD_COLUMNS - DESKTOP_ICON_SIZE.width),
      row: Math.max(0, Math.round(position.row)),
      ...DESKTOP_ICON_SIZE,
      gridVersion: 3,
    };
    if (!occupied.some((item) => overlaps(item, normalized))) return normalized;
  }
  return firstFreePosition(occupied, DESKTOP_ICON_SIZE, start);
}

function compareDesktopPosition(left: DesktopItem, right: DesktopItem): number {
  return left.position.row - right.position.row || left.position.column - right.position.column || left.key.localeCompare(right.key);
}

function normalizeTarget(target: WidgetPosition, fallback: WidgetPosition): WidgetPosition {
  return {
    ...fallback,
    column: clamp(target.column, 0, DASHBOARD_COLUMNS - fallback.width),
    row: Math.max(0, Math.round(target.row)),
  };
}

function positionAfter(position: WidgetPosition): Pick<WidgetPosition, 'column' | 'row'> {
  const column = position.column + position.width;
  return column >= DASHBOARD_COLUMNS ? { column: 0, row: position.row + position.height } : { column, row: position.row };
}

function positionAfterLast(positions: WidgetPosition[]): Pick<WidgetPosition, 'column' | 'row'> {
  const last = [...positions].sort((left, right) => left.row - right.row || left.column - right.column).at(-1);
  return last ? positionAfter(last) : { column: 0, row: 0 };
}

function samePosition(left: WidgetPosition | undefined, right: WidgetPosition): boolean {
  return Boolean(left && left.column === right.column && left.row === right.row && left.width === right.width && left.height === right.height && left.gridVersion === right.gridVersion);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
