/** Observes rendered size changes and falls back to viewport resize events when necessary. */
export function observeElementSize(element: Element, measure: () => void): () => void {
  measure();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', measure);
  return () => window.removeEventListener('resize', measure);
}
