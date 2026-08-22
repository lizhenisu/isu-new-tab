import { render } from '@testing-library/react';
import { createElement, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { measureIntrinsicContent, useTightCollisionBox } from '../../entrypoints/newtab/hooks/useTightCollisionBox';

describe('measureIntrinsicContent', () => {
  it('temporarily removes sizing constraints and restores every inline style', () => {
    const content = document.createElement('div');
    content.style.width = '100%';
    content.style.minWidth = '12px';
    content.style.maxWidth = '320px';
    content.style.height = '42px';
    content.style.minHeight = '8px';
    content.style.maxHeight = '64px';
    content.style.overflow = 'hidden';
    content.style.textOverflow = 'ellipsis';
    content.style.whiteSpace = 'nowrap';

    const size = measureIntrinsicContent(content, () => {
      expect(content.style.width).toBe('max-content');
      expect(content.style.maxWidth).toBe('320px');
      expect(content.style.whiteSpace).toBe('normal');
      return { width: 123.2, height: 45.1 };
    });

    expect(size).toEqual({ width: 124, height: 46 });
    expect({
      width: content.style.width,
      minWidth: content.style.minWidth,
      maxWidth: content.style.maxWidth,
      height: content.style.height,
      minHeight: content.style.minHeight,
      maxHeight: content.style.maxHeight,
      overflow: content.style.overflow,
      textOverflow: content.style.textOverflow,
      whiteSpace: content.style.whiteSpace,
    }).toEqual({
      width: '100%',
      minWidth: '12px',
      maxWidth: '320px',
      height: '42px',
      minHeight: '8px',
      maxHeight: '64px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  });

  it('leaves the section intrinsic instead of creating a runtime wrapper box', () => {
    function Fixture({ preserveWidth = false }: { preserveWidth?: boolean }) {
      const ref = useRef<HTMLElement | null>(null);
      useTightCollisionBox(ref, { enabled: true, preserveWidth });
      return createElement('section', { ref: (node: HTMLElement | null) => { ref.current = node; } }, createElement('div'));
    }

    const { container } = render(createElement('div', { className: 'dashboardBoard' }, createElement(Fixture)));
    const board = container.firstElementChild as HTMLElement;
    const node = board.firstElementChild as HTMLElement;
    const content = node.firstElementChild as HTMLElement;
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ width: 960, height: 400, top: 0, left: 0, right: 960, bottom: 400 } as DOMRect);
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ width: 61, height: 41, top: 0, left: 0, right: 61, bottom: 41 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(node.style.width).toBe('');
    expect(node.style.height).toBe('');
  });

  it('preserves explicit full width without adding a runtime height', () => {
    function Fixture() {
      const ref = useRef<HTMLElement | null>(null);
      useTightCollisionBox(ref, { enabled: true, preserveWidth: true });
      return createElement('section', { ref: (node: HTMLElement | null) => { ref.current = node; } }, createElement('div', { style: { width: '100%' } }));
    }

    const { container } = render(createElement('div', { className: 'dashboardBoard' }, createElement(Fixture)));
    const board = container.firstElementChild as HTMLElement;
    const node = board.firstElementChild as HTMLElement;
    const content = node.firstElementChild as HTMLElement;
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ width: 960, height: 400, top: 0, left: 0, right: 960, bottom: 400 } as DOMRect);
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ width: 960, height: 41, top: 0, left: 0, right: 960, bottom: 41 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(node.style.width).toBe('');
    expect(node.style.height).toBe('');
  });

  it('centers intrinsic content inside its logical grid footprint', () => {
    function Fixture() {
      const ref = useRef<HTMLElement | null>(null);
      useTightCollisionBox(ref, {
        enabled: true,
        position: { column: 2, row: 3, width: 4, height: 3, gridVersion: 3 },
      });
      return createElement('section', { ref: (node: HTMLElement | null) => { ref.current = node; } }, createElement('div'));
    }

    const { container } = render(createElement('div', { className: 'dashboardBoard' }, createElement(Fixture)));
    const board = container.firstElementChild as HTMLElement;
    const node = board.firstElementChild as HTMLElement;
    const content = node.firstElementChild as HTMLElement;
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ width: 960, height: 400, top: 20, left: 10, right: 970, bottom: 420 } as DOMRect);
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ width: 41, height: 41, top: 0, left: 0, right: 41, bottom: 41 } as DOMRect);
    window.dispatchEvent(new Event('resize'));

    expect(node.style.width).toBe('');
    expect(node.style.height).toBe('');
    expect(Number.parseFloat(node.style.marginLeft)).toBeCloseTo(19.5, 5);
    expect(Number.parseFloat(node.style.marginTop)).toBeCloseTo(39.5, 5);
    expect(node.style.justifySelf).toBe('start');
    expect(node.style.alignSelf).toBe('start');
  });
});
