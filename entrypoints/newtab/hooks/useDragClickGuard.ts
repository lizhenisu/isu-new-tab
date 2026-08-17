import { useCallback, useEffect, useRef } from 'react';

const CLICK_GUARD_MS = 700;

export function useDragClickGuard() {
  const blockedUntilRef = useRef(new Map<string, number>());

  const blockClicks = useCallback((key: string) => {
    blockedUntilRef.current.set(key, Number.POSITIVE_INFINITY);
  }, []);

  const blockNextClick = useCallback((key: string) => {
    const blockedUntil = performance.now() + CLICK_GUARD_MS;
    blockedUntilRef.current.set(key, blockedUntil);
    window.setTimeout(() => {
      if (blockedUntilRef.current.get(key) === blockedUntil) blockedUntilRef.current.delete(key);
    }, CLICK_GUARD_MS);
  }, []);

  useEffect(() => {
    const guardClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drag-click-key]') : null;
      const key = target?.dataset.dragClickKey;
      if (!key || performance.now() > (blockedUntilRef.current.get(key) ?? 0)) return;
      blockedUntilRef.current.delete(key);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('click', guardClick, true);
    return () => document.removeEventListener('click', guardClick, true);
  }, []);

  return { blockClicks, blockNextClick };
}
