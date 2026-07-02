import { describe, it, expect } from 'vitest';
import {
  newCorruptionState, addCorruption, tickCorruption, cleanse,
  corruptionRate, computeMutationEffects, ALL_MUTATIONS,
} from '../src/corruption';
import {
  CORRUPTION_BASE_RATE, CORRUPTION_DEPTH_RATE, CORRUPTION_THRESHOLDS, CORRUPTION_MAX,
} from '../src/config';
import { Rng } from '../src/rng';

describe('corruptionRate', () => {
  it('matches the configured formula per depth', () => {
    expect(corruptionRate(1)).toBeCloseTo(CORRUPTION_BASE_RATE);
    expect(corruptionRate(5)).toBeCloseTo(CORRUPTION_BASE_RATE + 4 * CORRUPTION_DEPTH_RATE);
  });

  it('passive tick accumulates rate * dt', () => {
    const state = newCorruptionState();
    const rng = new Rng(1);
    tickCorruption(state, 10, 1, 1, rng); // 10 seconds
    expect(state.points).toBeCloseTo(corruptionRate(1) * 10);
  });

  it('rate multiplier (Chaos Attunement) speeds the clock', () => {
    const a = newCorruptionState();
    const b = newCorruptionState();
    const rng = new Rng(1);
    tickCorruption(a, 10, 1, 1, rng);
    tickCorruption(b, 10, 1, 1.25, rng);
    expect(b.points).toBeCloseTo(a.points * 1.25);
  });
});

describe('thresholds and mutations', () => {
  it('each threshold fires exactly once', () => {
    const state = newCorruptionState();
    const rng = new Rng(42);
    const events = addCorruption(state, 21, rng);
    expect(events.filter((e) => e.type === 'mutation')).toHaveLength(1);
    expect(state.tierReached).toBe(1);
    // adding more below the next threshold fires nothing
    expect(addCorruption(state, 5, rng)).toHaveLength(0);
  });

  it('crossing several thresholds at once fires each in order', () => {
    const state = newCorruptionState();
    const rng = new Rng(7);
    const events = addCorruption(state, 65, rng);
    expect(events.filter((e) => e.type === 'mutation')).toHaveLength(3); // 20, 40, 60
    expect(state.tierReached).toBe(3);
    expect(state.mutations).toHaveLength(3);
  });

  it('never grants duplicate mutations', () => {
    const state = newCorruptionState();
    const rng = new Rng(99);
    addCorruption(state, 85, rng); // all four thresholds
    const unique = new Set(state.mutations);
    expect(unique.size).toBe(state.mutations.length);
  });

  it('cleansing lowers points but never re-arms thresholds or revokes mutations', () => {
    const state = newCorruptionState();
    const rng = new Rng(5);
    addCorruption(state, 45, rng); // tiers 1+2 fired
    const mutationsBefore = [...state.mutations];
    cleanse(state, 40);
    expect(state.points).toBeCloseTo(5);
    expect(state.tierReached).toBe(2);
    expect(state.mutations).toEqual(mutationsBefore);
    // climbing back over 20 and 40 fires nothing new
    const events = addCorruption(state, 40, rng);
    expect(events).toHaveLength(0);
  });

  it('cleansing clamps at zero', () => {
    const state = newCorruptionState();
    const rng = new Rng(5);
    addCorruption(state, 10, rng);
    cleanse(state, 999);
    expect(state.points).toBe(0);
  });

  it('death fires exactly at max corruption and points clamp there', () => {
    const state = newCorruptionState();
    const rng = new Rng(3);
    const under = addCorruption(state, CORRUPTION_MAX - 0.01, rng);
    expect(under.some((e) => e.type === 'death')).toBe(false);
    const over = addCorruption(state, 1, rng);
    expect(over.some((e) => e.type === 'death')).toBe(true);
    expect(state.points).toBe(CORRUPTION_MAX);
  });

  it('threshold count matches config', () => {
    const state = newCorruptionState();
    const rng = new Rng(21);
    addCorruption(state, CORRUPTION_MAX, rng);
    expect(state.tierReached).toBe(CORRUPTION_THRESHOLDS.length);
  });
});

describe('computeMutationEffects', () => {
  it('empty mutation list is all-neutral', () => {
    const fx = computeMutationEffects([]);
    expect(fx.maxHpDelta).toBe(0);
    expect(fx.speedMult).toBe(1);
    expect(fx.damageBonus).toBe(0);
    expect(fx.poisonOnHit).toBe(false);
  });

  it('Corrupted Flesh removes one heart', () => {
    expect(computeMutationEffects(['corruptedFlesh']).maxHpDelta).toBe(-2);
  });

  it('Twitching Limbs trades speed for dodge cooldown', () => {
    const fx = computeMutationEffects(['twitchingLimbs']);
    expect(fx.speedMult).toBeCloseTo(1.25);
    expect(fx.dodgeCooldownMult).toBeCloseTo(1.5);
  });

  it('Withered Heart weakens purity potions', () => {
    expect(computeMutationEffects(['witheredHeart']).purityMult).toBeCloseTo(0.7);
  });

  it('Venomous Touch halves healing and enables poison', () => {
    const fx = computeMutationEffects(['venomousTouch']);
    expect(fx.healMult).toBeCloseTo(0.5);
    expect(fx.poisonOnHit).toBe(true);
  });

  it('Brittle Bones doubles knockback both ways', () => {
    const fx = computeMutationEffects(['brittleBones']);
    expect(fx.knockbackDealtMult).toBe(2);
    expect(fx.knockbackTakenMult).toBe(2);
  });

  it('all mutations stack without conflict', () => {
    const fx = computeMutationEffects(ALL_MUTATIONS);
    expect(fx.maxHpDelta).toBe(-2);
    expect(fx.damageBonus).toBe(1);
    expect(fx.corruptionRateMult).toBeCloseTo(1.25);
  });
});
