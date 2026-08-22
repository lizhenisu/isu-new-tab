import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FolderDialog } from '../../entrypoints/newtab/components/FolderDialog';

describe('FolderDialog', () => {
  it('keeps native shortcut links without hover action controls', () => {
    const shortcut = { id: 'a', groupId: 'folder', name: 'Docs', url: 'https://example.com/docs', sortKey: 'a', revision: { counter: 1, deviceId: 'test' } };
    render(<FolderDialog
      folder={{ id: 'folder', name: 'Work', collapsed: false, sortKey: 'a', revision: { counter: 1, deviceId: 'test' } }}
      shortcuts={[shortcut]} onClose={vi.fn()}
    />);

    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
