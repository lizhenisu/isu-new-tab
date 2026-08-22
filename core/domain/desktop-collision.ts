export type DesktopCollisionNode = {
  width: number;
  height: number;
  /** Runtime edge offset from the node's logical grid column start. */
  offsetX: number;
  /** Runtime edge offset from the node's logical grid row start. */
  offsetY: number;
};

/** Runtime-only geometry captured from the rendered desktop at drag start. */
export type DesktopCollisionGeometry = {
  boardLeft: number;
  boardTop: number;
  columnWidth: number;
  rowHeight: number;
  nodes: Record<string, DesktopCollisionNode>;
};

export type DesktopCollisionRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
