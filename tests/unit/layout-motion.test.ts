import { describe, expect, it } from 'vitest';
import { dampedLayoutPoint, dampedLayoutProgress } from '../../entrypoints/newtab/hooks/useDampedLayoutMotion';

describe('damped layout motion', () => {
  it('keeps the first two thirds slow and moves most distance in the final third', () => {
    expect(dampedLayoutProgress(-1)).toBe(0);
    expect(dampedLayoutProgress(.25)).toBe(.00390625);
    expect(dampedLayoutProgress(.5)).toBe(.0625);
    expect(dampedLayoutProgress(2 / 3)).toBeCloseTo(.1975, 3);
    expect(dampedLayoutProgress(.75)).toBeCloseTo(.3164, 3);
    expect(dampedLayoutProgress(2)).toBe(1);
  });

  it('uses the same damped progress on both axes to keep a straight path', () => {
    expect(dampedLayoutPoint({ x: 0, y: 0 }, { x: 8, y: 4 }, .5)).toEqual({ x: .5, y: .25 });
    expect(dampedLayoutPoint({ x: 2, y: 8 }, { x: -6, y: 0 }, .5)).toEqual({ x: 1.5, y: 7.5 });
  });
});
