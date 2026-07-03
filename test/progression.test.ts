import { describe, it, expect } from 'vitest';
import { newProgression, xpToNext, xpForKill, grantXp, boonFor } from '../src/progression';
import { LEVEL_CAP, XP_LEVEL_BASE, XP_LEVEL_GROWTH, LEVELUP_HEAL } from '../src/config';

describe('xpToNext', () => {
  it('matches the configured curve', () => {
    expect(xpToNext(1)).toBe(XP_LEVEL_BASE);
    expect(xpToNext(2)).toBe(XP_LEVEL_BASE + XP_LEVEL_GROWTH);
    expect(xpToNext(5)).toBe(XP_LEVEL_BASE + 4 * XP_LEVEL_GROWTH);
  });

  it('is strictly increasing', () => {
    for (let l = 1; l < LEVEL_CAP; l++) {
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    }
  });
});

describe('xpForKill', () => {
  it('rewards tougher enemies more', () => {
    expect(xpForKill('archer', false, 1)).toBeGreaterThan(xpForKill('bat', false, 1));
    expect(xpForKill('boss', false, 8)).toBeGreaterThan(xpForKill('chaser', false, 8));
  });

  it('corrupted enemies grant double', () => {
    expect(xpForKill('chaser', true, 1)).toBe(2 * xpForKill('chaser', false, 1));
  });

  it('deeper floors grant more', () => {
    expect(xpForKill('chaser', false, 8)).toBeGreaterThan(xpForKill('chaser', false, 1));
  });

  it('always grants at least 1 xp', () => {
    expect(xpForKill('bat', false, 1)).toBeGreaterThanOrEqual(1);
  });
});

describe('grantXp', () => {
  it('accumulates below the threshold without leveling', () => {
    const p = newProgression();
    const boons = grantXp(p, xpToNext(1) - 1);
    expect(boons).toHaveLength(0);
    expect(p.level).toBe(1);
    expect(p.xp).toBe(xpToNext(1) - 1);
  });

  it('levels up and carries overflow xp', () => {
    const p = newProgression();
    const boons = grantXp(p, xpToNext(1) + 3);
    expect(boons).toHaveLength(1);
    expect(boons[0]!.level).toBe(2);
    expect(p.level).toBe(2);
    expect(p.xp).toBe(3);
  });

  it('can gain multiple levels from one big award', () => {
    const p = newProgression();
    const boons = grantXp(p, xpToNext(1) + xpToNext(2) + xpToNext(3));
    expect(boons.map((b) => b.level)).toEqual([2, 3, 4]);
    expect(p.level).toBe(4);
    expect(p.xp).toBe(0);
  });

  it('stops at the level cap and clamps stored xp', () => {
    const p = newProgression();
    grantXp(p, 1_000_000);
    expect(p.level).toBe(LEVEL_CAP);
    expect(p.xp).toBeLessThanOrEqual(xpToNext(LEVEL_CAP));
    const more = grantXp(p, 1000);
    expect(more).toHaveLength(0);
    expect(p.level).toBe(LEVEL_CAP);
  });
});

describe('boonFor', () => {
  it('every level grants vitality, mana, and a heal', () => {
    for (let l = 2; l <= LEVEL_CAP; l++) {
      const b = boonFor(l);
      expect(b.maxHpDelta).toBe(1);
      expect(b.maxManaDelta).toBe(1);
      expect(b.heal).toBe(LEVELUP_HEAL);
      expect(b.message.length).toBeGreaterThan(0);
    }
  });

  it('every third level adds melee damage', () => {
    expect(boonFor(3).damageDelta).toBe(1);
    expect(boonFor(6).damageDelta).toBe(1);
    expect(boonFor(9).damageDelta).toBe(1);
    expect(boonFor(2).damageDelta).toBe(0);
    expect(boonFor(4).damageDelta).toBe(0);
  });
});
