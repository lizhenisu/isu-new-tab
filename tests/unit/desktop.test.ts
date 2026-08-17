import { describe, expect, it } from 'vitest';
import { createInitialConfig } from '../../core/domain/defaults';
import {
  centeredGridSpan,
  desktopPlacements,
  measuredWidthToGridColumns,
  migrateDesktopPositions,
  overlaps,
  reflowDesktopItems,
  repairDesktopEntityPositions,
  resolveDesktopItems,
} from '../../core/domain/desktop';
import { DEFAULT_GROUP_ID, type Shortcut, type ShortcutGroup } from '../../core/domain/types';

const revision = { counter: 1, deviceId: 'test' };
const position = (column: number, row = 20) => ({ column, row, width: 4 as const, height: 3 as const, gridVersion: 3 as const });

describe('unified desktop layout', () => {
  it('keeps the default search placement centered at its rendered width', () => {
    const config = createInitialConfig({ deviceId: 'test', counter: 0, epoch: 0 });
    const search = resolveDesktopItems(config, { search: 39 }).find((item) => item.kind === 'system-widget' && item.id === 'search');

    expect(search?.position).toMatchObject({ column: 4, width: 40 });
  });

  it('rounds measured component widths up to the smallest whole grid footprint', () => {
    expect(measuredWidthToGridColumns(1, 1_548)).toBe(1);
    expect(measuredWidthToGridColumns(246, 1_548)).toBe(8);
    expect(measuredWidthToGridColumns(312, 1_548)).toBe(10);
    expect(measuredWidthToGridColumns(619, 1_548)).toBe(20);
    expect(measuredWidthToGridColumns(2_000, 1_548)).toBe(48);
  });

  it('adds the minimum parity column required for exact integer-grid centering', () => {
    expect(centeredGridSpan(12, 48)).toBe(12);
    expect(centeredGridSpan(13, 48)).toBe(14);
    expect(centeredGridSpan(39, 48)).toBe(40);
    expect(centeredGridSpan(12, 49)).toBe(13);
  });

  it('keeps the persisted add tile migration idempotent', () => {
    const config = createInitialConfig({ deviceId: 'test', counter: 0, epoch: 0 });
    const first = migrateDesktopPositions(config);
    const second = migrateDesktopPositions(first.config);
    expect(first.widgetLayoutChanged).toBe(false);
    expect(second.widgetLayoutChanged).toBe(false);
    expect(second.config.appearance.widgetLayout.value.filter((item) => item.id === 'addShortcut')).toHaveLength(1);
  });

  it('migrates shortcuts and folders from the legacy shortcut widget seed', () => {
    const config = createInitialConfig({ deviceId: 'test', counter: 0, epoch: 0 });
    config.appearance.widgetLayout.value.push({ id: 'shortcuts', enabled: true, position: { column: 8, row: 20, width: 16, height: 4, gridVersion: 3 } });
    config.shortcuts.push({ id: 'a', groupId: DEFAULT_GROUP_ID, name: 'A', url: 'https://a.example', sortKey: 'a', revision });
    config.groups.push({ id: 'folder', name: 'Folder', collapsed: false, sortKey: 'b', revision });

    const migrated = migrateDesktopPositions(config);

    expect(migrated.config.appearance.widgetLayout.value.some((item) => item.id === 'shortcuts')).toBe(false);
    expect(migrated.config.shortcuts[0]?.position).toEqual(position(8));
    expect(migrated.config.groups.find((item) => item.id === 'folder')?.position).toEqual(position(12));
    expect(migrated.changedShortcuts).toEqual(['a']);
    expect(migrated.changedGroups).toEqual(['folder']);
  });

  it('treats the add tile as a persisted movable desktop item', () => {
    const config = createInitialConfig({ deviceId: 'test', counter: 0, epoch: 0 });
    const before = resolveDesktopItems(config);
    const add = before.find((item) => item.kind === 'add-shortcut')!;
    const after = reflowDesktopItems(before, add.key, position(0, 30));

    expect(after.find((item) => item.kind === 'add-shortcut')?.position).toEqual(position(0, 30));
    expect(desktopPlacements(after)).toContainEqual({ kind: 'add-shortcut', id: 'addShortcut', position: position(0, 30) });
  });

  it('reflows mixed desktop items in row order without overlaps', () => {
    const config = createInitialConfig({ deviceId: 'test', counter: 0, epoch: 0 });
    config.shortcuts.push(
      { id: 'a', groupId: DEFAULT_GROUP_ID, name: 'A', url: 'https://a.example', sortKey: 'a', revision, position: position(0, 26) },
      { id: 'b', groupId: DEFAULT_GROUP_ID, name: 'B', url: 'https://b.example', sortKey: 'b', revision, position: position(4, 26) },
      { id: 'c', groupId: DEFAULT_GROUP_ID, name: 'C', url: 'https://c.example', sortKey: 'c', revision, position: position(8, 26) },
    );
    const items = resolveDesktopItems(config);
    const next = reflowDesktopItems(items, 'shortcut:c', position(2, 26));
    const persisted = next.filter((item) => item.kind !== 'add-shortcut');

    expect(next.find((item) => item.key === 'shortcut:c')?.position).toEqual(position(2, 26));
    for (const [index, item] of persisted.entries()) {
      expect(persisted.slice(index + 1).some((candidate) => overlaps(item.position, candidate.position))).toBe(false);
    }
    expect(desktopPlacements(next).some((item) => item.id === 'c')).toBe(true);
  });

  it('repairs concurrent entity overlaps deterministically', () => {
    const config = createInitialConfig({ deviceId: 'test', counter: 0, epoch: 0 });
    const groups: ShortcutGroup[] = [...config.groups, { id: 'folder', name: 'Folder', collapsed: false, sortKey: 'b', revision, position: position(0, 26) }];
    const shortcuts: Shortcut[] = [{ id: 'a', groupId: DEFAULT_GROUP_ID, name: 'A', url: 'https://a.example', sortKey: 'a', revision, position: position(0, 26) }];

    const repaired = repairDesktopEntityPositions(groups, shortcuts, config.appearance.widgetLayout.value);

    expect(overlaps(repaired.shortcuts[0]!.position!, repaired.groups.find((item) => item.id === 'folder')!.position!)).toBe(false);
    expect(repaired.changedGroups).toEqual(['folder']);
  });
});
