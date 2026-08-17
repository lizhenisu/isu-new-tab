import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FolderDialog } from '../../entrypoints/newtab/components/FolderDialog';

describe('FolderDialog', () => {
  it('keeps native shortcut links and exposes desktop, edit, delete, and ordering actions', async () => {
    const shortcut = { id: 'a', groupId: 'folder', name: 'Docs', url: 'https://example.com/docs', sortKey: 'a', revision: { counter: 1, deviceId: 'test' } };
    const onMoveToDesktop = vi.fn().mockResolvedValue(undefined);
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<FolderDialog
      folder={{ id: 'folder', name: 'Work', collapsed: false, sortKey: 'a', revision: { counter: 1, deviceId: 'test' } }}
      shortcuts={[shortcut]} onClose={vi.fn()} onEdit={onEdit} onDelete={onDelete}
      onMove={vi.fn().mockResolvedValue(undefined)} onMoveToDesktop={onMoveToDesktop}
      boardPositionAt={() => undefined}
    />);

    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com/docs');
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'moveToDesktop' }));
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(onEdit).toHaveBeenCalledWith(shortcut);
    expect(onMoveToDesktop).toHaveBeenCalledWith('a');
    expect(onDelete).toHaveBeenCalledWith('a');
  });
});
