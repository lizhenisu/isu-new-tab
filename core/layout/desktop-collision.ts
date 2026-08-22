import { DASHBOARD_COLUMNS, type WidgetPosition } from '../domain/widgets';
import type { DesktopCollisionGeometry, DesktopCollisionNode, DesktopCollisionRect } from '../domain/desktop-collision';

export type { DesktopCollisionGeometry, DesktopCollisionNode, DesktopCollisionRect } from '../domain/desktop-collision';

type MeasuredRect = { left: number; top: number; width: number; height: number };

const ROUNDING_EPSILON = 1e-6;

function ceilGrid(value: number, unit: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(unit) || unit <= 0 || value <= 0) return unit;
  return Math.max(unit, Math.ceil(value / unit - ROUNDING_EPSILON) * unit);
}

function ceilGridUnits(value: number, unit: number): number {
  return Math.max(1, Math.ceil(value / unit - ROUNDING_EPSILON));
}

export function roundCollisionSize(
  width: number,
  height: number,
  columnWidth: number,
  rowHeight: number,
  columns = DASHBOARD_COLUMNS,
): { width: number; height: number } {
  if (!Number.isFinite(columnWidth) || columnWidth <= 0 || !Number.isFinite(rowHeight) || rowHeight <= 0) {
    return { width, height };
  }
  const widthUnits = Number.isFinite(width) && width > 0 ? ceilGridUnits(width, columnWidth) : 1;
  const parity = Number.isInteger(columns) && columns > 0 ? columns % 2 : DASHBOARD_COLUMNS % 2;
  const centeredWidthUnits = widthUnits % 2 === parity ? widthUnits : widthUnits + 1;
  return {
    width: centeredWidthUnits * columnWidth,
    height: ceilGrid(height, rowHeight),
  };
}

export function snapCollisionEdge(value: number, boardOrigin: number, unit: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(boardOrigin) || !Number.isFinite(unit) || unit <= 0) return value;
  return boardOrigin + Math.round((value - boardOrigin) / unit) * unit;
}

export function collisionRectFor(
  key: string,
  position: WidgetPosition,
  geometry: DesktopCollisionGeometry,
): DesktopCollisionRect | undefined {
  const node = geometry.nodes[key];
  if (!node) return;
  const size = roundCollisionSize(node.width, node.height, geometry.columnWidth, geometry.rowHeight, DASHBOARD_COLUMNS);
  const left = geometry.boardLeft + position.column * geometry.columnWidth + node.offsetX;
  const top = geometry.boardTop + position.row * geometry.rowHeight + node.offsetY;
  return {
    left,
    right: left + size.width,
    top,
    bottom: top + size.height,
  };
}

/** Edges touching at exactly one line are not a collision. */
export function collisionRectsOverlap(left: DesktopCollisionRect, right: DesktopCollisionRect): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

export function collisionGeometryForRects(
  board: Pick<MeasuredRect, 'left' | 'top' | 'width'>,
  rowHeight: number,
  rects: Iterable<{ key: string; rect: MeasuredRect; position: WidgetPosition }>,
): DesktopCollisionGeometry {
  const columnWidth = board.width / 48;
  const nodes: Record<string, DesktopCollisionNode> = {};
  for (const { key, rect, position } of rects) {
    const size = roundCollisionSize(rect.width, rect.height, columnWidth, rowHeight, DASHBOARD_COLUMNS);
    const snappedLeft = snapCollisionEdge(rect.left, board.left, columnWidth);
    const snappedTop = snapCollisionEdge(rect.top, board.top, rowHeight);
    nodes[key] = {
      width: size.width,
      height: size.height,
      offsetX: snappedLeft - (board.left + position.column * columnWidth),
      offsetY: snappedTop - (board.top + position.row * rowHeight),
    };
  }
  return { boardLeft: board.left, boardTop: board.top, columnWidth, rowHeight, nodes };
}
