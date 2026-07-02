import { describe, it, expect } from 'vitest';
import {
  aabbOverlap, swingHitbox, knockbackVector, swingDamage, resolveAimDir, castThrow,
} from '../src/combat';
import { SWING_REACH, SWING_WIDTH, KNOCKBACK_SPEED } from '../src/config';

describe('aabbOverlap', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };

  it('detects overlap', () => {
    expect(aabbOverlap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(aabbOverlap(a, { x: -5, y: -5, w: 10, h: 10 })).toBe(true);
  });

  it('touching edges do NOT count as a hit', () => {
    expect(aabbOverlap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(aabbOverlap(a, { x: 0, y: 10, w: 10, h: 10 })).toBe(false);
    expect(aabbOverlap(a, { x: -10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('containment counts as overlap', () => {
    expect(aabbOverlap(a, { x: 2, y: 2, w: 3, h: 3 })).toBe(true);
  });

  it('separated rects do not overlap', () => {
    expect(aabbOverlap(a, { x: 100, y: 100, w: 5, h: 5 })).toBe(false);
  });
});

describe('swingHitbox', () => {
  const cx = 50;
  const cy = 50;

  it('extends in the facing direction for all 4 facings', () => {
    const up = swingHitbox(cx, cy, 'up');
    expect(up.y + up.h).toBe(cy);
    expect(up.h).toBe(SWING_REACH);
    expect(up.w).toBe(SWING_WIDTH);

    const down = swingHitbox(cx, cy, 'down');
    expect(down.y).toBe(cy);
    expect(down.h).toBe(SWING_REACH);

    const left = swingHitbox(cx, cy, 'left');
    expect(left.x + left.w).toBe(cx);
    expect(left.w).toBe(SWING_REACH);
    expect(left.h).toBe(SWING_WIDTH);

    const right = swingHitbox(cx, cy, 'right');
    expect(right.x).toBe(cx);
    expect(right.w).toBe(SWING_REACH);
  });

  it('is centered on the perpendicular axis', () => {
    const up = swingHitbox(cx, cy, 'up');
    expect(up.x + up.w / 2).toBe(cx);
    const right = swingHitbox(cx, cy, 'right');
    expect(right.y + right.h / 2).toBe(cy);
  });

  it('weapon reach extends the hitbox', () => {
    const base = swingHitbox(cx, cy, 'right', 0);
    const long = swingHitbox(cx, cy, 'right', 6);
    expect(long.w).toBe(base.w + 6);
  });
});

describe('knockbackVector', () => {
  it('pushes the target directly away from the source', () => {
    const kb = knockbackVector(0, 0, 10, 0);
    expect(kb.x).toBeCloseTo(KNOCKBACK_SPEED);
    expect(kb.y).toBeCloseTo(0);
  });

  it('normalizes diagonals to constant speed', () => {
    const kb = knockbackVector(0, 0, 10, 10);
    expect(Math.hypot(kb.x, kb.y)).toBeCloseTo(KNOCKBACK_SPEED);
  });

  it('Brittle Bones doubles knockback via the multiplier', () => {
    const kb = knockbackVector(0, 0, 10, 0, 2);
    expect(kb.x).toBeCloseTo(KNOCKBACK_SPEED * 2);
  });

  it('handles coincident source and target without NaN', () => {
    const kb = knockbackVector(5, 5, 5, 5);
    expect(Number.isFinite(kb.x)).toBe(true);
    expect(Number.isFinite(kb.y)).toBe(true);
    expect(Math.hypot(kb.x, kb.y)).toBeCloseTo(KNOCKBACK_SPEED);
  });
});

describe('resolveAimDir', () => {
  it('right stick takes priority over the pointer', () => {
    const dir = resolveAimDir(true, 1, 0, true, 0, 100, 0, 0, 'down');
    expect(dir.x).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
  });

  it('pointer aim points from origin toward the cursor', () => {
    const dir = resolveAimDir(false, 0, 0, true, 100, 100, 100, 0, 'down');
    expect(dir.x).toBeCloseTo(0);
    expect(dir.y).toBeCloseTo(1);
  });

  it('normalizes stick deflection to a unit vector', () => {
    const dir = resolveAimDir(true, 0.5, 0.5, false, 0, 0, 0, 0, 'down');
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1);
  });

  it('falls back to facing with no stick or pointer', () => {
    const dir = resolveAimDir(false, 0, 0, false, 0, 0, 0, 0, 'left');
    expect(dir).toEqual({ x: -1, y: 0 });
  });

  it('falls back to facing when the pointer sits exactly on the origin', () => {
    const dir = resolveAimDir(false, 0, 0, true, 50, 50, 50, 50, 'up');
    expect(dir).toEqual({ x: 0, y: -1 });
  });
});

describe('castThrow', () => {
  const wallAtX48 = (tx: number): boolean => tx >= 3; // tiles 3+ are solid (x >= 48px)

  it('travels the full distance in open space', () => {
    const p = castThrow(() => false, 10, 10, 1, 0, 64);
    expect(p.x).toBeCloseTo(74);
    expect(p.y).toBeCloseTo(10);
  });

  it('stops before a wall', () => {
    const p = castThrow(wallAtX48, 10, 10, 1, 0, 100);
    expect(p.x).toBeLessThan(48);
    expect(p.x).toBeGreaterThan(40); // lands close to the wall, not at the start
  });

  it('returns the origin when immediately blocked', () => {
    const p = castThrow(() => true, 10, 10, 1, 0, 64);
    expect(p).toEqual({ x: 10, y: 10 });
  });

  it('respects diagonal directions', () => {
    const inv = 1 / Math.SQRT2;
    const p = castThrow(() => false, 0, 0, inv, inv, 64);
    expect(p.x).toBeCloseTo(p.y);
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(64);
  });
});

describe('swingDamage', () => {
  it('adds weapon damage and mutation bonus', () => {
    expect(swingDamage(1, 0)).toBe(1); // rusty sword
    expect(swingDamage(2, 0)).toBe(2); // soldier's blade
    expect(swingDamage(3, 1)).toBe(4); // chaosbane + Chaos Attunement
  });

  it('never drops below 1', () => {
    expect(swingDamage(1, -5)).toBe(1);
  });
});
