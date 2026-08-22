import {
  PIECE_MAX_X,
  PIECE_MIN_X,
  type Piece,
  type PiecePosition,
  piecePositionsOverlap,
  isPiecePositionValid as isValidPiecePosition,
} from '../domain/pieces';

export type PieceDragDirection = { x: -1 | 0 | 1; y: -1 | 0 | 1 };
export type PieceLayoutResult = { pieces: Piece[]; movedPieceIds: string[] };

export type OccupancyItem = { id: string; position: PiecePosition };
export type OccupancyIndex = {
  items: OccupancyItem[];
  byX: OccupancyItem[];
  byY: OccupancyItem[];
};

type AxisInterval = { start: number; end: number; id: string };
export type PushPlan = Map<string, PiecePosition>;

/**
 * Deterministic integer-grid solver. It jumps between rectangle boundaries
 * instead of scanning every intermediate row or column.
 */
export class PieceLayoutEngine {
  constructor(private readonly columns = 48) {}

  place(snapshot: Piece[], activeId: string, target: PiecePosition, direction: PieceDragDirection = { x: 0, y: 1 }): PieceLayoutResult {
    const active = snapshot.find((piece) => piece.id === activeId);
    if (!active || active.container.kind !== 'desktop') return unchanged(snapshot);

    const activePosition = clampPosition({
      ...target,
      width: active.position?.width ?? target.width,
      height: active.position?.height ?? target.height,
    }, this.columns);
    const desktop = snapshot.filter((piece): piece is Piece & { position: PiecePosition } => piece.id !== activeId
      && piece.container.kind === 'desktop' && Boolean(piece.position));
    const blockers = desktop.filter((piece) => piecePositionsOverlap(piece.position, activePosition));
    const pieces = snapshot.map((piece) => structuredClone(piece));
    const activeResult = pieces.find((piece) => piece.id === activeId)!;
    activeResult.position = activePosition;

    if (!blockers.length) return { pieces, movedPieceIds: [activeId] };

    const blockerIds = new Set(blockers.map((piece) => piece.id));
    const fixed = desktop.filter((piece) => !blockerIds.has(piece.id));
    const index = buildPieceOccupancyIndex([
      { id: activeId, position: activePosition },
      ...fixed.map((piece) => ({ id: piece.id, position: piece.position })),
    ]);

    for (const pushDirection of orderedDirections(direction)) {
      const plan = solveDirectionalPush(blockers, index, activePosition, pushDirection, this.columns);
      if (plan) return applyPlan(pieces, activeId, activePosition, plan);
    }

    const fallbackPlan = solveNearestFallback(blockers, index, activePosition, this.columns);
    if (fallbackPlan) return applyPlan(pieces, activeId, activePosition, fallbackPlan);

    // The board is vertically expanding, so this is only a defensive guard
    // for malformed snapshots or an invalid custom column count.
    return unchanged(snapshot);
  }
}

export function solvePiecePlacement(snapshot: Piece[], activeId: string, target: PiecePosition, direction?: PieceDragDirection): PieceLayoutResult {
  return new PieceLayoutEngine().place(snapshot, activeId, target, direction);
}

export function buildPieceOccupancyIndex(items: OccupancyItem[]): OccupancyIndex {
  const normalized = items.slice().sort((left, right) => left.id.localeCompare(right.id));
  return {
    items: normalized,
    byX: normalized.slice().sort((left, right) => left.position.x - right.position.x || left.id.localeCompare(right.id)),
    byY: normalized.slice().sort((left, right) => left.position.y - right.position.y || left.id.localeCompare(right.id)),
  };
}

export function pieceLayoutHasCollisions(pieces: Piece[]): boolean {
  const desktop = pieces.filter((piece): piece is Piece & { position: PiecePosition } => piece.container.kind === 'desktop' && Boolean(piece.position));
  return desktop.some((left, index) => desktop.slice(index + 1).some((right) => piecePositionsOverlap(left.position, right.position)));
}

export function solveDirectionalPush(
  blockers: Array<Piece & { position: PiecePosition }>,
  fixedIndex: OccupancyIndex,
  active: PiecePosition,
  direction: PieceDragDirection,
  columns: number,
): PushPlan | undefined {
  // A rigid push is the least disruptive result: every directly blocking
  // piece keeps its relative arrangement and only one boundary distance is
  // calculated for the whole cluster.
  const rigid = solveRigidPush(blockers, fixedIndex, active, direction, columns);

  // If the rigid cluster cannot pass an edge or a fixed obstacle, split only
  // the direct blockers. Previously placed blockers become fixed obstacles,
  // so unrelated pieces are never pulled into the reflow.
  const plan: PushPlan = new Map();
  const placed: OccupancyItem[] = fixedIndex.items.slice();
  placed.push({ id: 'active', position: active });
  for (const blocker of blockers.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const candidate = directionalClearance(blocker.position, buildPieceOccupancyIndex(placed), direction, columns);
    if (!candidate) return rigid;
    plan.set(blocker.id, candidate);
    placed.push({ id: blocker.id, position: candidate });
  }
  if (!rigid) return plan;
  return comparePushPlans(rigid, plan, blockers, direction) <= 0 ? rigid : plan;
}

export function comparePushPlans(
  left: PushPlan,
  right: PushPlan,
  originals: Array<Pick<Piece, 'id' | 'position'>>,
  direction: PieceDragDirection,
): number {
  const score = (plan: PushPlan) => {
    const distances = originals.map((item) => {
      const from = item.position!;
      const to = plan.get(item.id) ?? from;
      return {
        distance: Math.abs(to.x - from.x) + Math.abs(to.y - from.y),
        directionPenalty: Math.max(0, -((to.x - from.x) * direction.x + (to.y - from.y) * direction.y)),
      };
    });
    return {
      moved: distances.filter((item) => item.distance > 0).length,
      total: distances.reduce((sum, item) => sum + item.distance, 0),
      maximum: Math.max(0, ...distances.map((item) => item.distance)),
      penalty: distances.reduce((sum, item) => sum + item.directionPenalty, 0),
      key: [...plan.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([id, position]) => `${id}:${position.x},${position.y}`).join('|'),
    };
  };
  const leftScore = score(left);
  const rightScore = score(right);
  return leftScore.moved - rightScore.moved
    || leftScore.total - rightScore.total
    || leftScore.maximum - rightScore.maximum
    || leftScore.penalty - rightScore.penalty
    || leftScore.key.localeCompare(rightScore.key);
}

function solveRigidPush(
  blockers: Array<Piece & { position: PiecePosition }>,
  fixedIndex: OccupancyIndex,
  active: PiecePosition,
  direction: PieceDragDirection,
  columns: number,
): PushPlan | undefined {
  if (!blockers.length) return new Map();
  const axis = direction.x !== 0 ? 'x' : direction.y !== 0 ? 'y' : undefined;
  if (!axis) return undefined;

  const obstacles = [{ id: 'active', position: active }, ...fixedIndex.items];
  const events: AxisInterval[] = [];
  let maximumDistance = Number.POSITIVE_INFINITY;

  for (const blocker of blockers) {
    const position = blocker.position;
    const base = axis === 'x' ? position.x : position.y;
    const size = axis === 'x' ? position.width : position.height;
    const sign = axis === 'x' ? direction.x : direction.y;
    const perpendicularStart = axis === 'x' ? position.y : position.x;
    const perpendicularEnd = axis === 'x' ? position.y + position.height : position.x + position.width;
    const edgeDistance = sign > 0
      ? (axis === 'x' ? columns / 2 - position.width - position.x : Number.POSITIVE_INFINITY)
      : (axis === 'x' ? position.x - PIECE_MIN_X : position.y);
    maximumDistance = Math.min(maximumDistance, edgeDistance);

    for (const obstacle of obstacles) {
      const obstacleStart = axis === 'x' ? obstacle.position.y : obstacle.position.x;
      const obstacleEnd = axis === 'x' ? obstacle.position.y + obstacle.position.height : obstacle.position.x + obstacle.position.width;
      if (perpendicularEnd <= obstacleStart || obstacleEnd <= perpendicularStart) continue;
      const obstacleAxisStart = axis === 'x' ? obstacle.position.x : obstacle.position.y;
      const obstacleAxisEnd = axis === 'x' ? obstacle.position.x + obstacle.position.width : obstacle.position.y + obstacle.position.height;
      const coordinateStart = obstacleAxisStart - size + 1;
      const coordinateEnd = obstacleAxisEnd - 1;
      const distanceStart = sign > 0 ? coordinateStart - base : base - coordinateEnd;
      const distanceEnd = sign > 0 ? coordinateEnd - base : base - coordinateStart;
      const start = Math.max(0, Math.min(distanceStart, distanceEnd));
      const end = Math.max(distanceStart, distanceEnd);
      if (end >= 0 && start <= maximumDistance) events.push({ start, end, id: `${blocker.id}:${obstacle.id}` });
    }
  }

  const distance = firstFreeDistance(events, maximumDistance);
  if (distance === undefined) return undefined;
  const plan = new Map<string, PiecePosition>();
  for (const blocker of blockers) {
    const position = translate(blocker.position, direction, distance);
    if (!isPiecePositionValid(position, columns) || piecePositionsOverlap(position, active)
      || blockers.some((other) => other.id !== blocker.id && piecePositionsOverlap(position, translate(other.position, direction, distance)))
      || fixedIndex.items.some((item) => piecePositionsOverlap(position, item.position))) return undefined;
    plan.set(blocker.id, position);
  }
  return plan;
}

export function directionalClearance(position: PiecePosition, index: OccupancyIndex, direction: PieceDragDirection, columns: number): PiecePosition | undefined {
  const axis = direction.x !== 0 ? 'x' : direction.y !== 0 ? 'y' : undefined;
  if (!axis) return undefined;
  const sign = axis === 'x' ? direction.x : direction.y;
  const base = axis === 'x' ? position.x : position.y;
  const size = axis === 'x' ? position.width : position.height;
  const perpendicularStart = axis === 'x' ? position.y : position.x;
  const perpendicularEnd = axis === 'x' ? position.y + position.height : position.x + position.width;
  const intervals = (axis === 'x' ? index.byY : index.byX).flatMap((item) => {
    const obstacleStart = axis === 'x' ? item.position.y : item.position.x;
    const obstacleEnd = axis === 'x' ? item.position.y + item.position.height : item.position.x + item.position.width;
    if (perpendicularEnd <= obstacleStart || obstacleEnd <= perpendicularStart) return [];
    const obstacleAxisStart = axis === 'x' ? item.position.x : item.position.y;
    const obstacleAxisEnd = axis === 'x' ? item.position.x + item.position.width : item.position.y + item.position.height;
    return [{
      start: obstacleAxisStart - size + 1,
      end: obstacleAxisEnd - 1,
      id: item.id,
    }];
  }).sort((left, right) => sign > 0 ? left.start - right.start || left.end - right.end || left.id.localeCompare(right.id) : right.end - left.end || right.start - left.start || left.id.localeCompare(right.id));

  let coordinate = base;
  const minimum = axis === 'x' ? PIECE_MIN_X : 0;
  const maximum = axis === 'x' ? columns / 2 - size : Number.POSITIVE_INFINITY;
  for (let event = 0; event <= intervals.length; event += 1) {
    const obstacle = intervals.find((candidate) => coordinate >= candidate.start && coordinate <= candidate.end);
    if (!obstacle) {
      const candidate = axis === 'x'
        ? { ...position, x: coordinate }
        : { ...position, y: coordinate };
      return isPiecePositionValid(candidate, columns) ? candidate : undefined;
    }
    coordinate = jumpPastObstacle(coordinate, obstacle, sign as -1 | 1);
    if (coordinate < minimum || coordinate > maximum) return undefined;
  }
  return undefined;
}

export function jumpPastObstacle(coordinate: number, obstacle: AxisInterval, direction: -1 | 1): number {
  return direction > 0 ? obstacle.end + 1 : obstacle.start - 1;
}

function solveNearestFallback(
  blockers: Array<Piece & { position: PiecePosition }>,
  fixedIndex: OccupancyIndex,
  active: PiecePosition,
  columns: number,
): PushPlan | undefined {
  const plan: PushPlan = new Map();
  const occupied = [...fixedIndex.items, { id: 'active', position: active }];
  for (const blocker of blockers.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const candidate = nearestFreePosition(blocker.position, buildPieceOccupancyIndex(occupied), columns);
    if (!candidate) return undefined;
    plan.set(blocker.id, candidate);
    occupied.push({ id: blocker.id, position: candidate });
  }
  return plan;
}

function nearestFreePosition(position: PiecePosition, index: OccupancyIndex, columns: number): PiecePosition | undefined {
  const xCandidates = new Set<number>([PIECE_MIN_X, position.x, PIECE_MAX_X - position.width]);
  const yCandidates = new Set<number>([0, position.y]);
  for (const item of index.items) {
    xCandidates.add(item.position.x - position.width);
    xCandidates.add(item.position.x + item.position.width);
    yCandidates.add(item.position.y - position.height);
    yCandidates.add(item.position.y + item.position.height);
  }
  const candidates = [...xCandidates].flatMap((x) => [...yCandidates].map((y) => clampPosition({ ...position, x, y }, columns)))
    .filter((candidate, index, all) => all.findIndex((item) => samePosition(item, candidate)) === index)
    .filter((candidate) => !index.items.some((item) => piecePositionsOverlap(item.position, candidate)));
  candidates.sort((left, right) => Math.abs(left.x - position.x) + Math.abs(left.y - position.y) - (Math.abs(right.x - position.x) + Math.abs(right.y - position.y))
    || left.y - right.y || left.x - right.x);
  return candidates[0] ?? bottomVacancy(position, index, columns);
}

function bottomVacancy(position: PiecePosition, index: OccupancyIndex, columns: number): PiecePosition | undefined {
  const y = Math.max(0, ...index.items.map((item) => item.position.y + item.position.height));
  const candidate = clampPosition({ ...position, x: PIECE_MIN_X, y }, columns);
  return index.items.some((item) => piecePositionsOverlap(item.position, candidate)) ? undefined : candidate;
}

function firstFreeDistance(events: AxisInterval[], maximumDistance: number): number | undefined {
  let distance = 0;
  for (let event = 0; event <= events.length; event += 1) {
    const obstacle = events.find((candidate) => distance >= candidate.start && distance <= candidate.end);
    if (!obstacle) return distance <= maximumDistance ? distance : undefined;
    distance = obstacle.end + 1;
    if (distance > maximumDistance) return undefined;
  }
  return undefined;
}

function orderedDirections(direction: PieceDragDirection): PieceDragDirection[] {
  if (direction.x !== 0) return [
    { x: direction.x, y: 0 },
    { x: -direction.x as -1 | 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ];
  if (direction.y !== 0) return [
    { x: 0, y: direction.y },
    { x: 0, y: -direction.y as -1 | 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  return [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
}

function translate(position: PiecePosition, direction: PieceDragDirection, distance: number): PiecePosition {
  return { ...position, x: position.x + direction.x * distance, y: position.y + direction.y * distance };
}

function clampPosition(position: PiecePosition, columns: number): PiecePosition {
  const maxX = columns / 2 - position.width;
  return { ...position, x: Math.max(PIECE_MIN_X, Math.min(maxX, Math.round(position.x))), y: Math.max(0, Math.round(position.y)) };
}

function isPiecePositionValid(position: PiecePosition, columns: number): boolean {
  return isPiecePositionValidBase(position) && position.x + position.width <= columns / 2;
}

function isPiecePositionValidBase(position: PiecePosition): boolean {
  return isValidPiecePosition(position);
}

function samePosition(left: PiecePosition, right: PiecePosition): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function applyPlan(pieces: Piece[], activeId: string, activePosition: PiecePosition, plan: PushPlan): PieceLayoutResult {
  const moved = new Set<string>([activeId]);
  for (const piece of pieces) {
    if (piece.id === activeId) piece.position = activePosition;
    const next = plan.get(piece.id);
    if (next) {
      piece.position = next;
      moved.add(piece.id);
    }
  }
  return { pieces, movedPieceIds: [...moved].sort() };
}

function unchanged(snapshot: Piece[], activeId?: string, activePosition?: PiecePosition): PieceLayoutResult {
  const pieces = snapshot.map((piece) => structuredClone(piece));
  if (activeId && activePosition) pieces.find((piece) => piece.id === activeId)!.position = activePosition;
  return { pieces, movedPieceIds: activeId ? [activeId] : [] };
}
