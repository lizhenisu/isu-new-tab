import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeviceIdentity, createInitialConfig } from '../../core/domain/defaults';
import { useAppStore } from '../../core/state/store';
import { AppearanceSettings } from '../../entrypoints/newtab/components/settings/AppearanceSettings';
import { SearchSettings } from '../../entrypoints/newtab/components/settings/SearchSettings';

const originalState = useAppStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  useAppStore.setState(originalState, true);
  vi.useRealTimers();
});

describe('appearance slider previews', () => {
  it('previews every slider movement but persists only the settled values', async () => {
    const updateAppearance = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      ...originalState,
      config: createInitialConfig(createDeviceIdentity()),
      appearancePreview: {},
      updateAppearance,
    }, true);
    render(<><AppearanceSettings /><SearchSettings historySource="local" onHistorySourceChange={vi.fn().mockResolvedValue(true)} /></>);

    fireEvent.change(screen.getByLabelText('blur'), { target: { value: '22' } });
    fireEvent.change(screen.getByLabelText('blur'), { target: { value: '27' } });
    fireEvent.change(screen.getByLabelText('searchWidth'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('searchWidth'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('searchBackground'), { target: { value: '40' } });

    expect(useAppStore.getState().appearancePreview).toMatchObject({
      blur: 27,
      search: { widthPercent: 70, backgroundOpacity: 40 },
    });
    expect(updateAppearance).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(250); });
    expect(updateAppearance).toHaveBeenCalledTimes(2);
    expect(updateAppearance).toHaveBeenCalledWith('blur', 27);
    expect(updateAppearance).toHaveBeenCalledWith('search', expect.objectContaining({ widthPercent: 70, backgroundOpacity: 40 }));
    expect(useAppStore.getState().appearancePreview).toEqual({});
  });
});
