import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMemo } from 'react';
import { t } from '../../../core/browser/i18n';
import { compareBySortKey } from '../../../core/domain/sort';
import type { Shortcut, ShortcutGroup } from '../../../core/domain/types';
import { faviconUrl } from '../../../core/domain/url';
import type { WidgetPosition } from '../../../core/domain/widgets';
import { Modal } from './Modal';
import { useDragClickGuard } from '../hooks/useDragClickGuard';

type Props = {
  folder: ShortcutGroup;
  shortcuts: Shortcut[];
  onClose(): void;
  onEdit(shortcut: Shortcut): void;
  onDelete(id: string): Promise<void>;
  onMove(id: string, groupId: string, beforeId?: string, afterId?: string): Promise<void>;
  onMoveToDesktop(id: string, position?: WidgetPosition): Promise<void>;
  boardPositionAt(clientX: number, clientY: number): WidgetPosition | undefined;
};

export function FolderDialog({ folder, shortcuts, onClose, onEdit, onDelete, onMove, onMoveToDesktop, boardPositionAt }: Props) {
  const ordered = useMemo(() => [...shortcuts].sort(compareBySortKey), [shortcuts]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 500, tolerance: 6 } }));
  const { blockClicks, blockNextClick } = useDragClickGuard();
  const shift = async (shortcut: Shortcut, direction: -1 | 1) => {
    const current = ordered.findIndex((item) => item.id === shortcut.id);
    const target = current + direction;
    if (target < 0 || target >= ordered.length) return;
    const without = ordered.filter((item) => item.id !== shortcut.id);
    await onMove(shortcut.id, folder.id, without[target - 1]?.id, without[target]?.id);
  };
  const finishDrag = async ({ active, over, delta }: DragEndEvent) => {
    blockNextClick(String(active.id));
    const shortcut = ordered.find((item) => item.id === active.id);
    const initial = active.rect.current.initial;
    if (!shortcut || !initial) return;
    const desktopPosition = boardPositionAt(initial.left + initial.width / 2 + delta.x, initial.top + initial.height / 2 + delta.y);
    if (desktopPosition) {
      await onMoveToDesktop(shortcut.id, desktopPosition);
      return;
    }
    const targetId = typeof over?.id === 'string' && over.id.startsWith('folder-item:') ? over.id.slice('folder-item:'.length) : undefined;
    if (!targetId || targetId === shortcut.id) return;
    const without = ordered.filter((item) => item.id !== shortcut.id);
    const index = without.findIndex((item) => item.id === targetId);
    await onMove(shortcut.id, folder.id, without[index - 1]?.id, without[index]?.id);
  };
  return <Modal title={folder.name} onClose={onClose}>
    <DndContext sensors={sensors} collisionDetection={pointerWithin}
      onDragStart={({ active }) => blockClicks(String(active.id))}
      onDragCancel={({ active }) => blockNextClick(String(active.id))}
      onDragEnd={(event) => void finishDrag(event)}>
      <p className="folderDragHint">{t('folderDragHint')}</p>
      <div className="folderDialogGrid">
        {ordered.map((shortcut, index) => <FolderMember key={shortcut.id} shortcut={shortcut} index={index} count={ordered.length}
          onEdit={onEdit} onDelete={onDelete} onShift={shift} onMoveToDesktop={onMoveToDesktop} />)}
        {!ordered.length && <p className="emptyFolder">{t('emptyGroup')}</p>}
      </div>
    </DndContext>
  </Modal>;
}

function FolderMember({ shortcut, index, count, onEdit, onDelete, onShift, onMoveToDesktop }: {
  shortcut: Shortcut;
  index: number;
  count: number;
  onEdit(shortcut: Shortcut): void;
  onDelete(id: string): Promise<void>;
  onShift(shortcut: Shortcut, direction: -1 | 1): Promise<void>;
  onMoveToDesktop(id: string): Promise<void>;
}) {
  const draggable = useDraggable({ id: shortcut.id });
  const droppable = useDroppable({ id: `folder-item:${shortcut.id}` });
  return <article ref={(node) => { draggable.setNodeRef(node); droppable.setNodeRef(node); }} className={`folderDialogItem ${draggable.isDragging ? 'isDragging' : ''}`}
    data-drag-click-key={shortcut.id}
    style={{ transform: CSS.Translate.toString(draggable.transform) }}
    onPointerDown={(event) => draggable.listeners?.onPointerDown?.(event)}>
    <a href={shortcut.url} className="desktopShortcut">
      <span className="desktopIcon"><img src={faviconUrl(shortcut.url)} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling?.removeAttribute('hidden'); }} /><b hidden>{shortcut.name.slice(0, 1).toUpperCase()}</b></span>
      <span>{shortcut.name}</span>
    </a>
    <div className="folderItemActions">
      <button type="button" disabled={index === 0} onClick={() => void onShift(shortcut, -1)} aria-label={t('movePrevious')}>←</button>
      <button type="button" disabled={index === count - 1} onClick={() => void onShift(shortcut, 1)} aria-label={t('moveNext')}>→</button>
      <button type="button" onClick={() => onEdit(shortcut)}>{t('edit')}</button>
      <button type="button" onClick={() => void onMoveToDesktop(shortcut.id)}>{t('moveToDesktop')}</button>
      <button type="button" onClick={() => void onDelete(shortcut.id)}>{t('delete')}</button>
    </div>
  </article>;
}
