export type MeasuredElementSize = { width: number; height: number; stretchesContainerWidth: boolean };

/** Measures visual content together with margins and its collision container's padding. */
export function measureElementSize(element: HTMLElement, container?: HTMLElement): MeasuredElementSize {
  const rect = element.getBoundingClientRect();
  const elementStyle = getComputedStyle(element);
  const containerStyle = container ? getComputedStyle(container) : undefined;
  const horizontalPadding = pixels(containerStyle?.paddingLeft) + pixels(containerStyle?.paddingRight);
  const containerContentWidth = container ? Math.max(0, container.getBoundingClientRect().width - horizontalPadding) : undefined;
  return {
    width: rect.width
      + pixels(elementStyle.marginLeft) + pixels(elementStyle.marginRight)
      + horizontalPadding,
    height: rect.height
      + pixels(elementStyle.marginTop) + pixels(elementStyle.marginBottom)
      + pixels(containerStyle?.paddingTop) + pixels(containerStyle?.paddingBottom),
    stretchesContainerWidth: containerContentWidth !== undefined && Math.abs(rect.width - containerContentWidth) < 1,
  };
}

function pixels(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}
