// Pure combat math: AABB collision, swing hitboxes, knockback. All unit-testable.

import { SWING_REACH, SWING_WIDTH, KNOCKBACK_SPEED } from './config';

export interface Rect {
  x: number; // top-left
  y: number;
  w: number;
  h: number;
}

export type Facing = 'up' | 'down' | 'left' | 'right';

export const FACING_VEC: Record<Facing, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Strict overlap — rectangles merely touching at an edge do NOT hit. */
export function aabbOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Sword swing hitbox extending from an attacker's center in the facing direction.
 * extraReach comes from weapon tier.
 */
export function swingHitbox(cx: number, cy: number, facing: Facing, extraReach = 0): Rect {
  const reach = SWING_REACH + extraReach;
  const width = SWING_WIDTH;
  switch (facing) {
    case 'up':
      return { x: cx - width / 2, y: cy - reach, w: width, h: reach };
    case 'down':
      return { x: cx - width / 2, y: cy, w: width, h: reach };
    case 'left':
      return { x: cx - reach, y: cy - width / 2, w: reach, h: width };
    case 'right':
      return { x: cx, y: cy - width / 2, w: reach, h: width };
  }
}

/** Knockback impulse pushing target away from source; speedMult for Brittle Bones etc. */
export function knockbackVector(
  sourceX: number, sourceY: number,
  targetX: number, targetY: number,
  speedMult = 1,
): { x: number; y: number } {
  let dx = targetX - sourceX;
  let dy = targetY - sourceY;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) {
    dx = 0;
    dy = 1;
  } else {
    dx /= len;
    dy /= len;
  }
  return { x: dx * KNOCKBACK_SPEED * speedMult, y: dy * KNOCKBACK_SPEED * speedMult };
}

/** Final damage of a player swing given weapon and mutation bonus. */
export function swingDamage(weaponDamage: number, mutationBonus: number): number {
  return Math.max(1, weaponDamage + mutationBonus);
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
