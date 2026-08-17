import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutEditor } from '../../entrypoints/newtab/components/ShortcutEditor';

describe('ShortcutEditor', () => {
  it('submits a shortcut with its selected group', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ShortcutEditor groups={[{ id: 'default', name: 'Default', sortKey: 'a0', collapsed: false, revision: { counter: 1, deviceId: 'a' } }]} defaultGroupId="default" onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveClass('modal--editor');
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('url'), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: 'Example', url: 'example.com', groupId: 'default' }));
  });
});
