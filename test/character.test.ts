import { describe, it, expect } from 'vitest';
import {
  buildCharacter, identityOf, rollBlessingOptions, randomCharacter, randomName,
  RACES, CLASSES, BLESSINGS, ALL_RACES, ALL_CLASSES, ALL_BLESSINGS, UNIVERSAL_SPELLS,
} from '../src/character';
import type { CharacterDef } from '../src/character';
import { newCorruptionState, addCorruption, neutralEffects, mergeEffects } from '../src/corruption';
import { Spellbook, SPELLS } from '../src/spells';
import { Rng } from '../src/rng';

const base: CharacterDef = {
  name: 'Test', gender: 'female', race: 'human', clazz: 'priest', blessing: 'fortune',
};

describe('buildCharacter', () => {
  it('always includes the universal spells', () => {
    for (const race of ALL_RACES) {
      for (const clazz of ALL_CLASSES) {
        const b = buildCharacter({ ...base, race, clazz });
        for (const s of UNIVERSAL_SPELLS) expect(b.spells).toContain(s);
      }
    }
  });

  it('knight gains hearts and stoneskin but loses mana', () => {
    const b = buildCharacter({ ...base, race: 'human', clazz: 'knight', blessing: 'swiftness' });
    expect(b.fx.maxHpDelta).toBe(2);
    expect(b.maxManaDelta).toBe(-2);
    expect(b.spells).toContain('stoneskin');
  });

  it('ranger starts with a bow and arrows', () => {
    const b = buildCharacter({ ...base, clazz: 'ranger' });
    expect(b.bow).toBe(true);
    expect(b.arrows).toBe(10);
    expect(b.spells).toContain('haste');
  });

  it('race and blessing effects stack multiplicatively/additively', () => {
    // elf (+8% speed) + swiftness (+10% speed)
    const b = buildCharacter({ ...base, race: 'elf', clazz: 'priest', blessing: 'swiftness' });
    expect(b.fx.speedMult).toBeCloseTo(1.08 * 1.1);
    // elf -1 heart
    expect(b.fx.maxHpDelta).toBe(-2);
    // elf +3 mana
    expect(b.maxManaDelta).toBe(3);
  });

  it('items from race, class, and blessing all accumulate', () => {
    // human (+1 heal) + priest (+1 purity) + fortune (+2 heal)
    const b = buildCharacter({ ...base, race: 'human', clazz: 'priest', blessing: 'fortune' });
    expect(b.items.filter((i) => i === 'healPotion')).toHaveLength(3);
    expect(b.items.filter((i) => i === 'purityPotion')).toHaveLength(1);
  });

  it('blessing of order grants a grace that absorbs the first mutation', () => {
    const b = buildCharacter({ ...base, blessing: 'order' });
    expect(b.graces).toBe(1);
    const state = newCorruptionState(b.graces);
    const rng = new Rng(9);
    const events = addCorruption(state, 25, rng); // crosses threshold 1
    expect(events).toEqual([{ type: 'grace' }]);
    expect(state.mutations).toHaveLength(0);
    expect(state.tierReached).toBe(1);
    // the next threshold mutates normally
    const events2 = addCorruption(state, 20, rng);
    expect(events2[0]!.type).toBe('mutation');
  });

  it('blessing of echoes reduces spell costs to a minimum of 1', () => {
    const b = buildCharacter({ ...base, blessing: 'echoes' });
    const sb = new Spellbook();
    sb.costReduction = b.spellCostReduction;
    sb.learn('nova');
    sb.learn('chaosBolt');
    expect(sb.costOf('nova')).toBe(SPELLS.nova.cost - 1);
    expect(sb.costOf('chaosBolt')).toBe(Math.max(1, SPELLS.chaosBolt.cost - 1));
    sb.mana = SPELLS.nova.cost - 1;
    expect(sb.spend('nova')).toBe(true);
    expect(sb.mana).toBe(0);
  });

  it('every race, class, and blessing has a name and description', () => {
    for (const r of ALL_RACES) expect(RACES[r].description.length).toBeGreaterThan(0);
    for (const c of ALL_CLASSES) expect(CLASSES[c].description.length).toBeGreaterThan(0);
    for (const bl of ALL_BLESSINGS) expect(BLESSINGS[bl].description.length).toBeGreaterThan(0);
  });
});

describe('identityOf', () => {
  it('formats name, race, and class', () => {
    expect(identityOf({ ...base, name: 'Kara', race: 'elf', clazz: 'mage' })).toBe('Kara the Elf Mage');
  });
});

describe('rollBlessingOptions', () => {
  it('returns 4 distinct blessings', () => {
    for (let seed = 1; seed < 40; seed++) {
      const opts = rollBlessingOptions(new Rng(seed));
      expect(opts).toHaveLength(4);
      expect(new Set(opts).size).toBe(4);
      for (const o of opts) expect(ALL_BLESSINGS).toContain(o);
    }
  });
});

describe('randomCharacter', () => {
  it('picks its blessing from the provided options', () => {
    for (let seed = 1; seed < 30; seed++) {
      const rng = new Rng(seed);
      const opts = rollBlessingOptions(rng);
      const def = randomCharacter(rng, opts);
      expect(opts).toContain(def.blessing);
      expect(def.name.length).toBeGreaterThan(0);
    }
  });

  it('randomName produces non-empty pronounceable names', () => {
    const rng = new Rng(4);
    for (let i = 0; i < 20; i++) {
      expect(randomName(rng)).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

describe('mergeEffects', () => {
  it('is neutral with neutralEffects', () => {
    const a = { ...neutralEffects(), damageBonus: 2, speedMult: 1.5 };
    expect(mergeEffects(a, neutralEffects())).toEqual(a);
  });

  it('adds deltas and multiplies multipliers', () => {
    const a = { ...neutralEffects(), maxHpDelta: 2, speedMult: 1.2, poisonOnHit: true };
    const b = { ...neutralEffects(), maxHpDelta: -1, speedMult: 0.5 };
    const m = mergeEffects(a, b);
    expect(m.maxHpDelta).toBe(1);
    expect(m.speedMult).toBeCloseTo(0.6);
    expect(m.poisonOnHit).toBe(true);
  });
});
