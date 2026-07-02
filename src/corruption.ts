// The signature race-against-time system. Corruption rises steadily; thresholds
// inflict mutations (fire exactly once — cleansing lowers points but never re-arms
// a threshold or revokes a mutation); 100 points ends the run.

import {
  CORRUPTION_MAX, CORRUPTION_BASE_RATE, CORRUPTION_DEPTH_RATE, CORRUPTION_THRESHOLDS,
} from './config';
import type { Rng } from './rng';

export type MutationId =
  | 'corruptedFlesh' | 'twitchingLimbs' | 'bulgingEyes' | 'venomousTouch'
  | 'chaosAttunement' | 'brittleBones' | 'witheredHeart';

export interface MutationDef {
  id: MutationId;
  name: string;
  message: string; // ADOM-flavor line shown when gained
}

export const MUTATIONS: Record<MutationId, MutationDef> = {
  corruptedFlesh: {
    id: 'corruptedFlesh', name: 'Corrupted Flesh',
    message: 'Your flesh withers and blackens. (-1 max heart)',
  },
  twitchingLimbs: {
    id: 'twitchingLimbs', name: 'Twitching Limbs',
    message: 'Your limbs twitch with unnatural speed! (+speed, slower dodge)',
  },
  bulgingEyes: {
    id: 'bulgingEyes', name: 'Bulging Eyes',
    message: 'Your eyes bulge horribly. (+vision, enemies notice you sooner)',
  },
  venomousTouch: {
    id: 'venomousTouch', name: 'Venomous Touch',
    message: 'Venom seeps from your hands. (poison blade, weaker healing)',
  },
  chaosAttunement: {
    id: 'chaosAttunement', name: 'Chaos Attunement',
    message: 'Chaos sings in your veins! (+damage, corruption spreads faster)',
  },
  brittleBones: {
    id: 'brittleBones', name: 'Brittle Bones',
    message: 'You feel your bones grow brittle. (all knockback doubled)',
  },
  witheredHeart: {
    id: 'witheredHeart', name: 'Withered Heart',
    message: 'Your heart withers. (purity potions weakened)',
  },
};

export const ALL_MUTATIONS = Object.keys(MUTATIONS) as MutationId[];

export interface CorruptionState {
  points: number;
  tierReached: number; // count of thresholds already fired (0..4)
  mutations: MutationId[];
}

export function newCorruptionState(): CorruptionState {
  return { points: 0, tierReached: 0, mutations: [] };
}

export type CorruptionEvent =
  | { type: 'mutation'; mutation: MutationId }
  | { type: 'death' };

/** Passive corruption gain per second at a given depth. */
export function corruptionRate(depth: number): number {
  return CORRUPTION_BASE_RATE + CORRUPTION_DEPTH_RATE * (depth - 1);
}

/**
 * Add corruption points; fires threshold mutations (each exactly once) and death at max.
 * Returns events in the order they occurred.
 */
export function addCorruption(state: CorruptionState, amount: number, rng: Rng): CorruptionEvent[] {
  const events: CorruptionEvent[] = [];
  state.points = Math.min(CORRUPTION_MAX, state.points + amount);
  while (
    state.tierReached < CORRUPTION_THRESHOLDS.length &&
    state.points >= CORRUPTION_THRESHOLDS[state.tierReached]!
  ) {
    state.tierReached++;
    const available = ALL_MUTATIONS.filter((m) => !state.mutations.includes(m));
    if (available.length > 0) {
      const mutation = rng.pick(available);
      state.mutations.push(mutation);
      events.push({ type: 'mutation', mutation });
    }
  }
  if (state.points >= CORRUPTION_MAX) events.push({ type: 'death' });
  return events;
}

/** Passive tick; rateMult carries Chaos Attunement's ×1.25. */
export function tickCorruption(
  state: CorruptionState, dt: number, depth: number, rateMult: number, rng: Rng,
): CorruptionEvent[] {
  return addCorruption(state, corruptionRate(depth) * rateMult * dt, rng);
}

/** Remove points (potions, stairs). Never re-arms thresholds or revokes mutations. */
export function cleanse(state: CorruptionState, amount: number): void {
  state.points = Math.max(0, state.points - amount);
}

/** Aggregated stat modifiers from the player's current mutations. */
export interface MutationEffects {
  maxHpDelta: number;
  speedMult: number;
  dodgeCooldownMult: number;
  visionDelta: number; // fog-of-war radius tiles
  aggroDelta: number; // enemy aggro radius tiles
  poisonOnHit: boolean;
  healMult: number;
  damageBonus: number;
  corruptionRateMult: number;
  knockbackDealtMult: number;
  knockbackTakenMult: number;
  purityMult: number; // multiplier on purity potion cleansing
}

export function computeMutationEffects(mutations: readonly MutationId[]): MutationEffects {
  const fx: MutationEffects = {
    maxHpDelta: 0,
    speedMult: 1,
    dodgeCooldownMult: 1,
    visionDelta: 0,
    aggroDelta: 0,
    poisonOnHit: false,
    healMult: 1,
    damageBonus: 0,
    corruptionRateMult: 1,
    knockbackDealtMult: 1,
    knockbackTakenMult: 1,
    purityMult: 1,
  };
  for (const m of mutations) {
    switch (m) {
      case 'corruptedFlesh':
        fx.maxHpDelta -= 2; // one full heart
        break;
      case 'twitchingLimbs':
        fx.speedMult *= 1.25;
        fx.dodgeCooldownMult *= 1.5;
        break;
      case 'bulgingEyes':
        fx.visionDelta += 3;
        fx.aggroDelta += 2;
        break;
      case 'venomousTouch':
        fx.poisonOnHit = true;
        fx.healMult *= 0.5;
        break;
      case 'chaosAttunement':
        fx.damageBonus += 1;
        fx.corruptionRateMult *= 1.25;
        break;
      case 'brittleBones':
        fx.knockbackDealtMult *= 2;
        fx.knockbackTakenMult *= 2;
        break;
      case 'witheredHeart':
        fx.purityMult *= 0.7;
        break;
    }
  }
  return fx;
}
