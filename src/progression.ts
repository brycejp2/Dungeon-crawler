// Leveling & experience: permanent in-run growth, ADOM style. Kills grant xp
// scaled by depth and corruption; levels grant vitality, mana, and every third
// level a little more bite. All pure and unit-testable.

import { LEVEL_CAP, XP_LEVEL_BASE, XP_LEVEL_GROWTH, XP_DEPTH_SCALE, LEVELUP_HEAL } from './config';
import type { EnemyKind } from './dungeon';

export interface Progression {
  level: number;
  xp: number; // progress within the current level
}

export function newProgression(): Progression {
  return { level: 1, xp: 0 };
}

/** Xp required to advance FROM the given level to the next one. */
export function xpToNext(level: number): number {
  return XP_LEVEL_BASE + XP_LEVEL_GROWTH * (level - 1);
}

const KILL_XP: Record<EnemyKind, number> = {
  bat: 2,
  chaser: 3,
  archer: 4,
  boss: 50,
};

export function xpForKill(kind: EnemyKind, corrupted: boolean, depth: number): number {
  const depthMult = 1 + XP_DEPTH_SCALE * (depth - 1);
  return Math.max(1, Math.round(KILL_XP[kind] * depthMult * (corrupted ? 2 : 1)));
}

/** What a single new level grants. Deltas are applied by the caller. */
export interface LevelUpBoon {
  level: number;
  maxHpDelta: number; // half-hearts
  maxManaDelta: number;
  damageDelta: number; // permanent melee bonus
  heal: number; // half-hearts restored immediately
  message: string;
}

export function boonFor(level: number): LevelUpBoon {
  const damageDelta = level % 3 === 0 ? 1 : 0;
  return {
    level,
    maxHpDelta: 1,
    maxManaDelta: 1,
    damageDelta,
    heal: LEVELUP_HEAL,
    message:
      damageDelta > 0
        ? `Level ${level}! Your strikes carry new weight.`
        : `Level ${level}! You feel tougher and more attuned.`,
  };
}

/**
 * Grant xp, consuming thresholds as levels are gained (overflow carries).
 * Returns one boon per level gained, in order. At the cap, xp still
 * accumulates for the HUD but no further levels fire.
 */
export function grantXp(p: Progression, amount: number): LevelUpBoon[] {
  p.xp += amount;
  const boons: LevelUpBoon[] = [];
  while (p.level < LEVEL_CAP && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    boons.push(boonFor(p.level));
  }
  if (p.level >= LEVEL_CAP) p.xp = Math.min(p.xp, xpToNext(LEVEL_CAP));
  return boons;
}
