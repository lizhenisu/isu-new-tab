import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';

type Point = { x: number; y: number };
type Motion = {
  from: Point;
  to: Point;
  startedAt: number;
  frame?: number;
};

export const DAMPED_LAYOUT_MOTION_DURATION = 460;

export function dampedLayoutProgress(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped ** 4;
}

export function dampedLayoutPoint(from: Point, to: Point, progress: number): Point {
  const eased = dampedLayoutProgress(progress);
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
  };
}

/** Keeps interrupted layout motion on one deterministic straight-line trajectory. */
export function useDampedLayoutMotion(
  nodeRef: MutableRefObject<HTMLElement | null>,
  position: { column: number; row: number },
  disabled: boolean,
): void {
  const targetRef = useRef<Point | undefined>(undefined);
  const motionRef = useRef<Motion | undefined>(undefined);
  const disabledRef = useRef(disabled);

  useEffect(() => () => stopMotion(motionRef, nodeRef.current), [nodeRef]);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const resumedFromOwnDrag = disabledRef.current && !disabled;
    disabledRef.current = disabled;
    const now = performance.now();
    const running = motionRef.current;
    const current = running ? motionPosition(running, now) : targetRef.current;

    // Individual translate is intentionally separate from dnd-kit's transform.
    // Clearing it gives the new layout target without disturbing drag transforms.
    node.style.translate = 'none';
    const rect = node.getBoundingClientRect();
    const target = { x: rect.left, y: rect.top };
    targetRef.current = target;

    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The dragged node already followed the pointer to its drop target. Its first
    // post-drag layout update must snap there instead of replaying A -> B.
    if (disabled || resumedFromOwnDrag || reducedMotion) {
      stopMotion(motionRef, node);
      return;
    }
    if (running && samePoint(running.to, target)) {
      applyPosition(node, current ?? target, target);
      return;
    }
    if (!current || samePoint(current, target)) {
      stopMotion(motionRef, node);
      return;
    }

    stopMotion(motionRef, node);
    const motion: Motion = { from: current, to: target, startedAt: now };
    motionRef.current = motion;
    node.dataset.layoutMotion = 'damped-quartic';
    const tick = (time: number) => {
      if (motionRef.current !== motion) return;
      const point = motionPosition(motion, time);
      applyPosition(node, point, target);
      if (time - motion.startedAt < DAMPED_LAYOUT_MOTION_DURATION) {
        motion.frame = requestAnimationFrame(tick);
      } else {
        motionRef.current = undefined;
        node.style.translate = '';
        delete node.dataset.layoutMotion;
      }
    };
    tick(now);
  }, [disabled, nodeRef, position.column, position.row]);
}

function motionPosition(motion: Motion, time: number): Point {
  return dampedLayoutPoint(motion.from, motion.to, (time - motion.startedAt) / DAMPED_LAYOUT_MOTION_DURATION);
}

function applyPosition(node: HTMLElement, point: Point, target: Point): void {
  node.style.translate = `${point.x - target.x}px ${point.y - target.y}px`;
}

function samePoint(left: Point, right: Point): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) < .5;
}

function stopMotion(ref: { current?: Motion }, node: HTMLElement | null): void {
  if (ref.current?.frame !== undefined) cancelAnimationFrame(ref.current.frame);
  ref.current = undefined;
  if (!node) return;
  node.style.translate = '';
  delete node.dataset.layoutMotion;
}
