import type { CSSProperties, InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'min' | 'max' | 'value'> & {
  min: number;
  max: number;
  value: number;
};

export function RangeInput({ min, max, value, style, ...props }: Props) {
  const progress = max === min ? 0 : Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
  return (
    <input
      {...props}
      className={`rangeInput ${props.className ?? ''}`.trim()}
      type="range"
      min={min}
      max={max}
      value={value}
      style={{ ...style, '--range-progress': `${progress}%` } as CSSProperties}
    />
  );
}
