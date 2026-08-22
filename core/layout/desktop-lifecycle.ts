import { desktopItems, firstFreePosition, type DesktopNode, type DesktopSnapshot } from '../domain/desktop';
import type { WidgetPosition } from '../domain/widgets';
import type { DesktopCollisionGeometry } from './desktop-collision';
import {
  placeDesktopNode,
  placeNewDesktopNode,
  repairDesktopSnapshot,
  type DesktopLayoutResult,
  type DragDirection,
} from './desktop-layout-engine';

export type DesktopLifecycleCommand =
  | { type: 'move'; key: string; target: WidgetPosition; direction?: DragDirection; geometry?: DesktopCollisionGeometry }
  | { type: 'insert'; node: DesktopNode & { container: { kind: 'desktop' }; position: WidgetPosition }; target?: WidgetPosition; direction?: DragDirection; geometry?: DesktopCollisionGeometry }
  | { type: 'repair' };

/** The sole layout command boundary for preview, persistence, migration, and sync repair. */
export function executeDesktopCommand(snapshot: DesktopSnapshot, command: DesktopLifecycleCommand): DesktopLayoutResult {
  if (command.type === 'move') return placeDesktopNode(snapshot, command.key, command.target, command.direction, command.geometry);
  if (command.type === 'insert') return placeNewDesktopNode(snapshot, command.node, command.target, command.direction, command.geometry);
  return repairDesktopSnapshot(snapshot);
}

export function nearestDesktopVacancy(snapshot: DesktopSnapshot, origin: WidgetPosition, size = origin): WidgetPosition {
  return firstFreePosition(desktopItems(snapshot).map((item) => item.position), size, origin);
}
