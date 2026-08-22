import { useLayoutEffect, type MutableRefObject } from 'react';
import { DASHBOARD_COLUMNS, DASHBOARD_ROW_HEIGHT } from '../../../core/domain/widgets';
import { roundCollisionSize, snapCollisionEdge } from '../../../core/layout/desktop-collision';
import type { WidgetPosition } from '../../../core/domain/widgets';

type MeasuredSize = { width: number; height: number };
type IntrinsicMeasureOptions = { preserveWidth?: boolean };
type TightCollisionBoxOptions = boolean | { enabled: boolean; preserveWidth?: boolean; position?: WidgetPosition };

const intrinsicProperties = [
  'width',
  'minWidth',
  'maxWidth',
  'height',
  'minHeight',
  'maxHeight',
  'overflow',
  'textOverflow',
  'whiteSpace',
] as const;

/**
 * Measures a widget's content without letting its grid-sized wrapper constrain it.
 * The temporary styles are deliberately restored before returning: this helper is
 * a measurement boundary, not a second layout system.
 */
export function measureIntrinsicContent(
  content: HTMLElement,
  readRect: () => Pick<DOMRect, 'width' | 'height'> = () => content.getBoundingClientRect(),
  options: IntrinsicMeasureOptions = {},
): MeasuredSize {
  const previous = Object.fromEntries(intrinsicProperties.map((property) => [property, content.style[property]])) as Record<typeof intrinsicProperties[number], string>;
  try {
    if (!options.preserveWidth) content.style.width = 'max-content';
    content.style.minWidth = '0';
    content.style.height = 'max-content';
    content.style.minHeight = '0';
    content.style.maxHeight = 'none';
    content.style.overflow = 'visible';
    content.style.textOverflow = 'clip';
    content.style.whiteSpace = 'normal';
    const rect = readRect();
    return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  } finally {
    for (const property of intrinsicProperties) content.style[property] = previous[property];
  }
}

/** Positions intrinsic widget content on the grid without creating a runtime wrapper box. */
export function useTightCollisionBox(
  nodeRef: MutableRefObject<HTMLElement | null>,
  options: TightCollisionBoxOptions,
): void {
  const enabled = typeof options === 'boolean' ? options : options.enabled;
  const preserveWidth = typeof options === 'boolean' ? false : options.preserveWidth === true;
  const position = typeof options === 'boolean' ? undefined : options.position;
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node || !enabled) return;
    const content = node.firstElementChild;
    if (!(content instanceof HTMLElement)) return;

    const sync = () => {
      const board = node.closest<HTMLElement>('.dashboardBoard');
      const boardRect = board?.getBoundingClientRect();
      const previousTranslate = node.style.translate;
      const previousTransform = node.style.transform;
      // Damped motion is a visual overlay. Measure the layout anchor without
      // the overlay, otherwise an interrupted animation becomes the next
      // grid anchor and can move the section to a distant column.
      node.style.translate = 'none';
      // dnd-kit applies the pointer delta through `transform`. It is also a
      // transient visual overlay and must not become the next grid anchor when
      // a drop commits during the same frame.
      node.style.transform = 'none';
      // Clear the previous runtime anchor before measuring. Otherwise a layout
      // position change would be measured through the old margin and could
      // preserve a stale offset from the previous grid cell.
      node.style.justifySelf = 'center';
      node.style.alignSelf = 'center';
      // The grid footprint remains the persisted anchor. The section itself
      // must stay intrinsic; only its margin is allowed to position content
      // inside that footprint.
      if (!preserveWidth) node.style.width = '';
      node.style.height = '';
      node.style.maxWidth = '';
      node.style.marginLeft = '0px';
      node.style.marginTop = '0px';
      node.style.marginRight = '0px';
      node.style.marginBottom = '0px';
      const boardWidth = boardRect?.width ?? 0;
      const columnWidth = boardWidth / DASHBOARD_COLUMNS;
      try {
        const measured = measureIntrinsicContent(content, undefined, { preserveWidth });
        // Some grid children (notably the clock header) resolve their final
        // block size differently while `height: max-content` is applied for
        // measurement. Read the restored layout once more so the margin is
        // based on the same dimensions that are actually rendered.
        const restoredRect = content.getBoundingClientRect();
        const width = restoredRect.width > 0 ? restoredRect.width : measured.width;
        const height = restoredRect.height > 0 ? restoredRect.height : measured.height;
        if (width <= 0 || height <= 0) return;
        if (boardRect && position) {
          const logicalLeft = boardRect.left + position.column * columnWidth;
          const logicalTop = boardRect.top + position.row * DASHBOARD_ROW_HEIGHT;
          // Derive the centered intrinsic position from the logical grid area,
          // rather than measuring the section's current pixels. During a
          // layout commit React may still be applying the previous grid area;
          // using that transient rectangle would permanently carry the old
          // column into the new runtime margin.
          const naturalLeft = preserveWidth
            ? logicalLeft
            : logicalLeft + (position.width * columnWidth - width) / 2;
          const naturalTop = logicalTop + (position.height * DASHBOARD_ROW_HEIGHT - height) / 2;
          const rounded = roundCollisionSize(width, height, columnWidth, DASHBOARD_ROW_HEIGHT, DASHBOARD_COLUMNS);
          const snappedLeft = snapCollisionEdge(naturalLeft, boardRect.left, columnWidth);
          const snappedTop = snapCollisionEdge(naturalTop, boardRect.top, DASHBOARD_ROW_HEIGHT);
          // The border is rendered by the widget itself while dragging. These
          // variables describe the invisible grid-aligned collision rectangle
          // without changing the section's intrinsic layout dimensions.
          node.style.setProperty('--collision-left', `${snappedLeft - naturalLeft}px`);
          node.style.setProperty('--collision-top', `${snappedTop - naturalTop}px`);
          node.style.setProperty('--collision-width', `${rounded.width}px`);
          node.style.setProperty('--collision-height', `${rounded.height}px`);
          // Keep the rendered content centered in its persisted logical footprint.
          // Grid-line snapping belongs to the invisible collision geometry; applying
          // it to the visible margin shifts odd-sized content by up to half a cell
          // (most noticeable immediately after restoring the default layout).
          node.style.justifySelf = 'start';
          node.style.alignSelf = 'start';
          node.style.marginLeft = `${naturalLeft - logicalLeft}px`;
          node.style.marginTop = `${naturalTop - logicalTop}px`;
        }
      } finally {
        node.style.transform = previousTransform;
        node.style.translate = previousTranslate;
      }
    };

    sync();
    const onWindowResize = () => sync();
    window.addEventListener('resize', onWindowResize, { passive: true });
    if (typeof ResizeObserver !== 'function') return () => window.removeEventListener('resize', onWindowResize);
    const observer = new ResizeObserver(sync);
    observer.observe(content);
    const board = node.closest<HTMLElement>('.dashboardBoard');
    if (board) observer.observe(board);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [enabled, nodeRef, preserveWidth, position?.column, position?.row, position?.width, position?.height]);
}
