import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isDesktopContextActionAllowed, type DesktopContextAction, type DesktopContextTarget } from '../../../core/browser/native-context-menu';
import { t } from '../../../core/browser/i18n';
import { observeElementSize } from '../../../core/browser/observe-element-size';
import {
  centeredGridSpan,
  desktopPlacements,
  measuredWidthToGridColumns,
  overlaps,
  reflowDesktopItems,
  resolveDesktopItems,
  type DesktopItem,
  type DesktopPlacement,
} from '../../../core/domain/desktop';
import { faviconUrl } from '../../../core/domain/url';
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_ROW_HEIGHT,
  WIDGET_SIZE_PRESETS,
  snapGridCoordinate,
  type SystemWidgetId,
  type WidgetLayout,
  type WidgetPosition,
  type WidgetSizePreset,
} from '../../../core/domain/widgets';
import { FolderDialog } from '../components/FolderDialog';
import { useDragClickGuard } from '../hooks/useDragClickGuard';
import { useNativeDesktopContextMenu } from '../hooks/useNativeDesktopContextMenu';
import { WIDGET_REGISTRY, type DashboardWidgetContext } from './registry';

type Props = {
  layout: WidgetLayout;
  context: DashboardWidgetContext;
  onPlacementsChange(placements: DesktopPlacement[]): Promise<void>;
  onLayoutChange(layout: WidgetLayout): Promise<void>;
};

type DragCandidate = { item: DesktopItem; position: WidgetPosition };
const candidateKey = (candidate: DragCandidate | undefined) => candidate
  ? `${candidate.item.key}:${candidate.position.column}:${candidate.position.row}`
  : undefined;

export function DashboardBoard({ layout: storedLayout, context, onPlacementsChange, onLayoutChange }: Props) {
  const [boardWidth, setBoardWidth] = useState(0);
  const [measuredWidgetWidths, setMeasuredWidgetWidths] = useState<Partial<Record<SystemWidgetId, number>>>({});
  const widthOverrides = useMemo<Partial<Record<SystemWidgetId, number>>>(() => Object.fromEntries(
    Object.entries(measuredWidgetWidths).map(([id, width]) => [id, measuredWidthToGridColumns(width, boardWidth)]),
  ), [boardWidth, measuredWidgetWidths]);
  const resolved = useMemo(
    () => resolveDesktopItems({ ...context.config, appearance: { ...context.config.appearance, widgetLayout: { ...context.config.appearance.widgetLayout, value: storedLayout } } }, widthOverrides),
    [context.config, storedLayout, widthOverrides],
  );
  const [items, setItems] = useState(resolved);
  const [preview, setPreview] = useState<DesktopItem[]>();
  const [dragging, setDragging] = useState(false);
  const [openFolderId, setOpenFolderId] = useState<string>();
  const [acceptedFolderId, setAcceptedFolderId] = useState<string>();
  const boardRef = useRef<HTMLDivElement>(null);
  const dragBaseRef = useRef<DesktopItem[]>([]);
  const pendingRef = useRef<DragCandidate | undefined>(undefined);
  const acceptedRef = useRef<{ key: string; items: DesktopItem[] } | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  const folderTimerRef = useRef<number | undefined>(undefined);
  const pendingFolderRef = useRef<string | undefined>(undefined);
  const acceptedFolderRef = useRef<string | undefined>(undefined);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 500, tolerance: 6 } }));
  const { blockClicks, blockNextClick } = useDragClickGuard();
  const recordWidgetWidth = useCallback((id: SystemWidgetId, width: number) => {
    setMeasuredWidgetWidths((current) => Math.abs((current[id] ?? 0) - width) < 0.5 ? current : { ...current, [id]: width });
  }, []);

  useEffect(() => setItems(resolved), [resolved]);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const update = () => setBoardWidth((current) => {
      const width = board.getBoundingClientRect().width;
      return Math.abs(current - width) < 0.5 ? current : width;
    });
    return observeElementSize(board, update);
  }, []);
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (folderTimerRef.current) window.clearTimeout(folderTimerRef.current);
    };
  }, []);

  const displayed = preview ?? items;
  const rows = Math.max(18, ...displayed.map((item) => item.position.row + item.position.height)) + 2;
  const clearTimer = () => { if (timerRef.current) window.clearTimeout(timerRef.current); timerRef.current = undefined; };
  const candidateFromDrag = (activeKey: string | number, delta: { x: number; y: number }): DragCandidate | undefined => {
    const item = dragBaseRef.current.find((candidate) => candidate.key === activeKey);
    const width = boardRef.current?.getBoundingClientRect().width;
    if (!item || !width) return;
    const previous = pendingRef.current?.item.key === item.key ? pendingRef.current.position : undefined;
    return {
      item,
      position: {
        ...item.position,
        column: Math.max(0, Math.min(DASHBOARD_COLUMNS - item.position.width, snapGridCoordinate(item.position.column + delta.x / (width / DASHBOARD_COLUMNS), previous?.column))),
        row: Math.max(0, snapGridCoordinate(item.position.row + delta.y / DASHBOARD_ROW_HEIGHT, previous?.row)),
      },
    };
  };
  const blockingItem = (activeKey: string | number, target: WidgetPosition) =>
    dragBaseRef.current.find((item) => item.key !== activeKey && overlaps(item.position, target));
  const onDragMove = ({ active, delta }: DragMoveEvent) => {
    const candidate = candidateFromDrag(active.id, delta);
    if (!candidate || candidateKey(candidate) === candidateKey(pendingRef.current)) return;
    clearTimer();
    pendingRef.current = candidate;
    const key = candidateKey(candidate)!;
    if (blockingItem(candidate.item.key, candidate.position)) {
      acceptedRef.current = undefined;
      setPreview(undefined);
      return;
    }
    if (acceptedRef.current?.key === key) return;
    timerRef.current = window.setTimeout(() => {
      if (candidateKey(pendingRef.current) !== key) return;
      const reflowed = reflowDesktopItems(dragBaseRef.current, candidate.item.key, candidate.position);
      acceptedRef.current = { key, items: reflowed };
      setPreview(reflowed.map((item) => item.key === candidate.item.key ? candidate.item : item));
    }, 400);
  };
  const onDragOver = ({ active, over }: DragOverEvent) => {
    const activeItem = dragBaseRef.current.find((item) => item.key === active.id);
    const folderId = activeItem?.kind === 'shortcut' && typeof over?.id === 'string' && over.id.startsWith('folder-drop:')
      ? over.id.slice('folder-drop:'.length)
      : undefined;
    if (pendingFolderRef.current === folderId) return;
    if (folderTimerRef.current) window.clearTimeout(folderTimerRef.current);
    folderTimerRef.current = undefined;
    pendingFolderRef.current = folderId;
    acceptedFolderRef.current = undefined;
    setAcceptedFolderId(undefined);
    if (!folderId) return;
    folderTimerRef.current = window.setTimeout(() => {
      if (pendingFolderRef.current !== folderId) return;
      acceptedFolderRef.current = folderId;
      setAcceptedFolderId(folderId);
      folderTimerRef.current = undefined;
    }, 400);
  };
  const finishDrag = async ({ active, over, delta }: DragEndEvent) => {
    clearTimer();
    setDragging(false);
    blockNextClick(String(active.id));
    const activeItem = dragBaseRef.current.find((item) => item.key === active.id);
    if (activeItem?.kind === 'shortcut' && typeof over?.id === 'string' && over.id === `folder-drop:${acceptedFolderRef.current}`) {
      setPreview(undefined);
      resetDragState();
      await context.onMoveShortcut(activeItem.entity.id, over.id.slice('folder-drop:'.length));
      return;
    }
    const candidate = candidateFromDrag(active.id, delta);
    if (!candidate) { resetDragState(); return; }
    if (blockingItem(candidate.item.key, candidate.position)) {
      setItems(dragBaseRef.current);
      setPreview(undefined);
      resetDragState();
      return;
    }
    const key = candidateKey(candidate)!;
    const next = acceptedRef.current?.key === key
      ? acceptedRef.current.items
      : reflowDesktopItems(dragBaseRef.current, candidate.item.key, candidate.position);
    setItems(next);
    setPreview(undefined);
    resetDragState();
    await onPlacementsChange(desktopPlacements(next));
  };
  const resetDragState = () => {
    if (folderTimerRef.current) window.clearTimeout(folderTimerRef.current);
    folderTimerRef.current = undefined;
    pendingFolderRef.current = undefined;
    acceptedFolderRef.current = undefined;
    setAcceptedFolderId(undefined);
    pendingRef.current = undefined;
    acceptedRef.current = undefined;
  };
  const cancelDrag = () => { clearTimer(); setDragging(false); setPreview(undefined); resetDragState(); };

  const commitReflow = async (key: string, position: WidgetPosition, sizePreset?: WidgetSizePreset) => {
    const sized = items.map((item) => {
      if (item.key !== key) return item;
      if (item.kind === 'system-widget' && sizePreset) return { ...item, sizePreset, position: { ...position, ...WIDGET_SIZE_PRESETS[item.id][sizePreset] } };
      return { ...item, position };
    }) as DesktopItem[];
    const target = sized.find((item) => item.key === key);
    if (!target) return;
    const next = reflowDesktopItems(sized, key, target.position);
    setItems(next);
    await onPlacementsChange(desktopPlacements(next));
  };
  const center = (item: DesktopItem) => {
    const width = centeredGridSpan(item.position.width);
    void commitReflow(item.key, { ...item.position, width, column: (DASHBOARD_COLUMNS - width) / 2 });
  };
  const boardPositionAt = (clientX: number, clientY: number): WidgetPosition | undefined => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
    return {
      column: Math.max(0, Math.min(44, Math.floor(((clientX - rect.left) / rect.width) * DASHBOARD_COLUMNS))),
      row: Math.max(0, Math.floor((clientY - rect.top) / DASHBOARD_ROW_HEIGHT)),
      width: 4,
      height: 3,
      gridVersion: 3,
    };
  };
  const hideWidget = async (item: Extract<DesktopItem, { kind: 'system-widget' }>) => {
    await onLayoutChange(storedLayout.map((widget) => widget.id === item.id ? { ...widget, enabled: false } : widget));
  };
  const executeContextAction = async (action: DesktopContextAction, target: DesktopContextTarget) => {
    if (!isDesktopContextActionAllowed(action, target)) return;
    if (target.kind === 'board') {
      context.onAddGroup(target.position);
      return;
    }
    if (target.kind === 'none') return;
    const item = items.find((candidate) => candidate.key === target.key);
    if (!item || item.kind !== target.kind) return;
    if (action === 'center') {
      center(item);
    } else if (action === 'edit' && item.kind === 'shortcut') {
      context.onEditShortcut(item.entity);
    } else if (action === 'delete' && item.kind === 'shortcut') {
      await context.onDeleteShortcut(item.entity.id);
    } else if (action === 'open' && item.kind === 'folder') {
      setOpenFolderId(item.entity.id);
    } else if (action === 'rename' && item.kind === 'folder') {
      context.onRenameGroup(item.entity);
    } else if (action === 'delete' && item.kind === 'folder') {
      await context.onDeleteGroup(item.entity);
    } else if (action === 'hide' && item.kind === 'system-widget') {
      await hideWidget(item);
    } else if (action.startsWith('size-') && item.kind === 'system-widget' && item.id !== 'search') {
      await commitReflow(item.key, item.position, action.slice('size-'.length) as WidgetSizePreset);
    }
  };
  useNativeDesktopContextMenu(boardRef, displayed, executeContextAction);
  const folder = openFolderId ? context.config.groups.find((group) => group.id === openFolderId) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={({ active }) => { blockClicks(String(active.id)); dragBaseRef.current = items; setDragging(true); }} onDragMove={onDragMove} onDragOver={onDragOver} onDragEnd={(event) => void finishDrag(event)} onDragCancel={({ active }) => { blockNextClick(String(active.id)); cancelDrag(); }}>
      <div
        ref={boardRef}
        className={`dashboardBoard ${dragging ? 'dragging' : ''} ${preview ? 'reflowPreview' : ''}`}
        style={{ '--board-rows': rows } as React.CSSProperties}
      >
        {displayed.map((item) => {
          const committed = items.find((candidate) => candidate.key === item.key);
          const displaced = Boolean(committed && (committed.position.column !== item.position.column || committed.position.row !== item.position.row));
          return (
            <DesktopCell key={item.key} item={item} context={context} displaced={displaced}
              folderAccepted={item.kind === 'folder' && acceptedFolderId === item.entity.id}
              onWidgetWidth={recordWidgetWidth}
              onAdd={() => context.onAddShortcut()} onOpenFolder={setOpenFolderId} />
          );
        })}
      </div>
      {folder && <FolderDialog folder={folder} shortcuts={context.config.shortcuts.filter((item) => item.groupId === folder.id)}
        onClose={() => setOpenFolderId(undefined)} onEdit={context.onEditShortcut} onDelete={context.onDeleteShortcut}
        onMove={context.onMoveShortcut} boardPositionAt={boardPositionAt}
        onMoveToDesktop={(id, position) => context.onMoveShortcut(id, 'default', undefined, undefined, position)} />}
    </DndContext>
  );
}

function DesktopCell({ item, context, displaced, folderAccepted, onWidgetWidth, onAdd, onOpenFolder }: {
  item: DesktopItem;
  context: DashboardWidgetContext;
  displaced: boolean;
  folderAccepted: boolean;
  onWidgetWidth(id: SystemWidgetId, width: number): void;
  onAdd(): void;
  onOpenFolder(id: string): void;
}) {
  const draggable = useDraggable({ id: item.key, disabled: !item.movable });
  const folderDrop = useDroppable({ id: item.kind === 'folder' ? `folder-drop:${item.entity.id}` : `drop:${item.key}`, disabled: item.kind !== 'folder' });
  const nodeRef = useRef<HTMLElement | null>(null);
  const previousRect = useRef<DOMRect | undefined>(undefined);
  const widgetId = item.kind === 'system-widget' ? item.id : undefined;
  const transform = draggable.transform ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)` : undefined;
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const previous = previousRect.current;
    if (previous && displaced && !draggable.isDragging && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.animate([{ transform: `translate3d(${previous.left - rect.left}px, ${previous.top - rect.top}px, 0)` }, { transform: 'translate3d(0,0,0)' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    previousRect.current = rect;
  }, [displaced, draggable.isDragging, item.position.column, item.position.row]);
  useLayoutEffect(() => {
    if (!widgetId) return;
    const content = nodeRef.current?.firstElementChild;
    if (!(content instanceof HTMLElement)) return;
    const measure = () => onWidgetWidth(widgetId, content.getBoundingClientRect().width);
    return observeElementSize(content, measure);
  }, [onWidgetWidth, widgetId]);
  const content: ReactNode = item.kind === 'system-widget'
    ? WIDGET_REGISTRY[item.id].render(context)
    : item.kind === 'shortcut'
      ? <ShortcutTile shortcut={item.entity} />
      : item.kind === 'folder'
        ? <FolderTile item={item} onOpen={() => onOpenFolder(item.entity.id)} active={folderAccepted} />
        : <button type="button" className="desktopAddTile" onClick={onAdd}><span>＋</span><strong>{t('addShortcut')}</strong></button>;
  return (
    <section
      ref={(node) => { draggable.setNodeRef(node); folderDrop.setNodeRef(node); nodeRef.current = node; }}
      className={`dashboardWidget desktopItem--${item.kind} ${item.kind === 'system-widget' ? `dashboardWidget--${item.id}` : ''} ${draggable.isDragging ? 'isDragging' : ''} ${displaced ? 'isDisplaced' : ''} ${folderAccepted ? 'isFolderTarget' : ''}`}
      data-desktop-key={item.key}
      data-drag-click-key={item.key}
      data-widget-id={item.kind === 'system-widget' ? item.id : undefined}
      style={{ gridColumn: `${item.position.column + 1} / span ${item.position.width}`, gridRow: `${item.position.row + 1} / span ${item.position.height}`, transform }}
      onPointerDown={(event) => { if (item.movable) draggable.listeners?.onPointerDown?.(event); }}
    >{content}</section>
  );
}

function ShortcutTile({ shortcut }: { shortcut: Extract<DesktopItem, { kind: 'shortcut' }>['entity'] }) {
  return <a className="desktopShortcut" href={shortcut.url}><DesktopIcon name={shortcut.name} url={shortcut.url} /><span>{shortcut.name}</span></a>;
}

function DesktopIcon({ name, url }: { name: string; url: string }) {
  return <span className="desktopIcon"><img src={faviconUrl(url)} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling?.removeAttribute('hidden'); }} /><b hidden>{name.slice(0, 1).toUpperCase()}</b></span>;
}

function FolderTile({ item, onOpen, active }: { item: Extract<DesktopItem, { kind: 'folder' }>; onOpen(): void; active: boolean }) {
  return <button type="button" className={`desktopFolder ${active ? 'active' : ''}`} onClick={onOpen}>
    <span className="folderPreview">{item.children.slice(0, 9).map((shortcut) => <span key={shortcut.id}><img src={faviconUrl(shortcut.url)} alt="" /></span>)}</span>
    <strong>{item.entity.name}</strong>
  </button>;
}
