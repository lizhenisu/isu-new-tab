import { useCallback, useEffect, useRef } from 'react';
import type { AppConfig } from '../../../../core/domain/types';
import { useAppStore } from '../../../../core/state/store';

type PreviewKey = 'blur' | 'search';
type PreviewValue<K extends PreviewKey> = AppConfig['appearance'][K]['value'];

/** Keeps high-frequency slider feedback in memory and persists only after interaction settles. */
export function useAppearancePreview<K extends PreviewKey>(key: K, persisted: PreviewValue<K>, delay = 250) {
  const preview = useAppStore((state) => state.appearancePreview[key]) as PreviewValue<K> | undefined;
  const previewAppearance = useAppStore((state) => state.previewAppearance);
  const clearAppearancePreview = useAppStore((state) => state.clearAppearancePreview);
  const updateAppearance = useAppStore((state) => state.updateAppearance);
  const timerRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<PreviewValue<K> | undefined>(undefined);
  const generationRef = useRef(0);

  const persist = useCallback((value: PreviewValue<K>, generation: number) => {
    pendingRef.current = undefined;
    const finish = () => { if (generationRef.current === generation) clearAppearancePreview(key); };
    void updateAppearance(key, value).then(finish, finish);
  }, [clearAppearancePreview, key, updateAppearance]);

  const setPreview = useCallback((value: PreviewValue<K>) => {
    const generation = ++generationRef.current;
    pendingRef.current = value;
    previewAppearance(key, value as never);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      persist(value, generation);
    }, delay);
  }, [delay, key, persist, previewAppearance]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    if (pendingRef.current !== undefined) persist(pendingRef.current, generationRef.current);
  }, [persist]);

  return [preview ?? persisted, setPreview] as const;
}
