import { describe, expect, it } from 'vitest';
import { PieceLayoutEngine, pieceLayoutHasCollisions, type PieceDragDirection } from '../../core/layout/piece-layout-engine';
import type { Piece, PiecePosition } from '../../core/domain/pieces';

const revision = { counter: 1, deviceId: 'test' };

function piece(id: string, position: PiecePosition): Piece {
  return {
    id,
    kind: id === 'active' ? 'system-widget' : 'shortcut',
    payloadRef: id,
    container: { kind: 'desktop' },
    position,
    revision,
  };
}

function position(x: number, y: number, width = 4, height = 3): PiecePosition {
  return { x, y, width, height };
}

function solve(snapshot: Piece[], target: PiecePosition, direction: PieceDragDirection = { x: 1, y: 0 }) {
  return new PieceLayoutEngine().place(snapshot, 'active', target, direction);
}

describe('PieceLayoutEngine event-jump displacement', () => {
  it('moves a blocker by one cell when a one-cell clearance is enough', () => {
    const result = solve([piece('active', position(0, 0)), piece('blocker', position(6, 0))], position(3, 0));
    expect(result.pieces.find((item) => item.id === 'blocker')?.position).toEqual(position(7, 0));
    expect(result.pieces.find((item) => item.id === 'active')?.position).toEqual(position(3, 0));
    expect(result.movedPieceIds).toEqual(['active', 'blocker']);
    expect(pieceLayoutHasCollisions(result.pieces)).toBe(false);
  });

  it('does not use the active piece width as the displacement step', () => {
    const result = solve([piece('active', position(0, 0)), piece('blocker', position(6, 0))], position(3, 0));
    expect(result.pieces.find((item) => item.id === 'blocker')?.position?.x).not.toBe(10);
  });

  it('keeps unrelated pieces frozen', () => {
    const result = solve([
      piece('active', position(0, 0)),
      piece('blocker', position(6, 0)),
      piece('unrelated', position(14, 0)),
    ], position(3, 0));
    expect(result.pieces.find((item) => item.id === 'unrelated')?.position).toEqual(position(14, 0));
  });

  it('uses the confirmed horizontal direction order', () => {
    const result = solve([
      piece('active', position(0, 0)),
      piece('blocker', position(6, 0)),
      piece('right-wall', position(10, 0)),
    ], position(3, 0), { x: 1, y: 0 });
    // The preferred direction is tried before the reverse direction and
    // remains deterministic even when the reverse side is closer.
    expect(result.pieces.find((item) => item.id === 'blocker')?.position?.x).toBeGreaterThan(6);
    expect(pieceLayoutHasCollisions(result.pieces)).toBe(false);
  });

  it('returns the same result for the same snapshot and command', () => {
    const snapshot = [piece('active', position(0, 0)), piece('blocker', position(6, 0)), piece('fixed', position(14, 0))];
    const first = solve(snapshot, position(3, 0));
    const second = solve(snapshot, position(3, 0));
    expect(first.pieces).toEqual(second.pieces);
    expect(first.movedPieceIds).toEqual(second.movedPieceIds);
  });
});
