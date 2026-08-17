import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppLanguage } from '../../core/browser/i18n';
import { ClockWidget } from '../../entrypoints/newtab/components/ClockWidget';
import { FocusTimer } from '../../entrypoints/newtab/components/FocusTimer';
import { QuickNote } from '../../entrypoints/newtab/components/QuickNote';

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  setAppLanguage('system');
});

describe('dashboard widgets', () => {
  it('formats the date with the selected app language', () => {
    const now = new Date(2026, 7, 16, 8, 3);
    setAppLanguage('en');
    const { rerender } = render(<ClockWidget now={now} />);
    expect(screen.getByText('Sunday, August 16')).toBeVisible();

    setAppLanguage('zh_CN');
    rerender(<ClockWidget now={now} />);
    expect(screen.getByText('8月16日星期日')).toBeVisible();
  });

  it('starts and resets the focus timer', () => {
    vi.useFakeTimers();
    render(<FocusTimer />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('24:59')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByText('25:00')).toBeVisible();
  });

  it('keeps the quick note in local-only browser storage', () => {
    render(<QuickNote />);
    expect(screen.queryByText('savedLocally')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('quickNote'), { target: { value: 'Finish the dashboard' } });
    expect(localStorage.getItem('isu:quick-note')).toBe('Finish the dashboard');
  });
});
