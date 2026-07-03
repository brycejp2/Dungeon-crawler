import { describe, it, expect } from 'vitest';
import { Spellbook, Hotbar, SPELLS, ALL_SPELLS, HOTBAR_SIZE, entryEquals } from '../src/spells';
import type { HotbarEntry } from '../src/spells';
import { MANA_MAX, MANA_REGEN } from '../src/config';
import { Inventory } from '../src/items';

describe('Spellbook', () => {
  it('starts with full mana and no spells', () => {
    const sb = new Spellbook();
    expect(sb.mana).toBe(MANA_MAX);
    expect(sb.known).toHaveLength(0);
  });

  it('learn() adds a spell once', () => {
    const sb = new Spellbook();
    expect(sb.learn('nova')).toBe(true);
    expect(sb.learn('nova')).toBe(false);
    expect(sb.known).toEqual(['nova']);
  });

  it('cannot cast unknown spells even with full mana', () => {
    const sb = new Spellbook();
    expect(sb.canCast('nova')).toBe(false);
    expect(sb.spend('nova')).toBe(false);
    expect(sb.mana).toBe(MANA_MAX);
  });

  it('spend() deducts exactly the spell cost', () => {
    const sb = new Spellbook();
    sb.learn('chaosBolt');
    expect(sb.spend('chaosBolt')).toBe(true);
    expect(sb.mana).toBe(MANA_MAX - SPELLS.chaosBolt.cost);
  });

  it('refuses to cast without enough mana and deducts nothing', () => {
    const sb = new Spellbook();
    sb.learn('nova');
    sb.mana = SPELLS.nova.cost - 1;
    expect(sb.spend('nova')).toBe(false);
    expect(sb.mana).toBe(SPELLS.nova.cost - 1);
  });

  it('regen() refills at the configured rate and clamps at max', () => {
    const sb = new Spellbook();
    sb.mana = 0;
    sb.regen(2);
    expect(sb.mana).toBeCloseTo(MANA_REGEN * 2);
    sb.regen(10000);
    expect(sb.mana).toBe(sb.maxMana);
  });

  it('every spell has a positive cost and a description', () => {
    for (const id of ALL_SPELLS) {
      expect(SPELLS[id].cost).toBeGreaterThan(0);
      expect(SPELLS[id].description.length).toBeGreaterThan(0);
    }
  });
});

describe('Hotbar', () => {
  const bolt: HotbarEntry = { kind: 'spell', id: 'chaosBolt' };
  const potion: HotbarEntry = { kind: 'item', id: 'healPotion' };

  it('autoAssign fills the first empty slot', () => {
    const hb = new Hotbar();
    hb.autoAssign(bolt);
    hb.autoAssign(potion);
    expect(hb.get(0)).toEqual(bolt);
    expect(hb.get(1)).toEqual(potion);
  });

  it('autoAssign never duplicates an entry', () => {
    const hb = new Hotbar();
    hb.autoAssign(bolt);
    hb.autoAssign(bolt);
    expect(hb.slots.filter((s) => entryEquals(s, bolt))).toHaveLength(1);
  });

  it('assign moves an entry rather than duplicating it', () => {
    const hb = new Hotbar();
    hb.autoAssign(bolt); // slot 0
    hb.assign(5, bolt);
    expect(hb.get(0)).toBeNull();
    expect(hb.get(5)).toEqual(bolt);
  });

  it('assign overwrites the target slot', () => {
    const hb = new Hotbar();
    hb.assign(2, bolt);
    hb.assign(2, potion);
    expect(hb.get(2)).toEqual(potion);
    expect(hb.slotOf(bolt)).toBe(-1);
  });

  it('slotOf finds bound entries', () => {
    const hb = new Hotbar();
    hb.assign(7, potion);
    expect(hb.slotOf(potion)).toBe(7);
    expect(hb.slotOf(bolt)).toBe(-1);
  });

  it('cycle skips empty slots and wraps', () => {
    const hb = new Hotbar();
    hb.assign(2, bolt);
    hb.assign(6, potion);
    hb.selected = 2;
    hb.cycle();
    expect(hb.selected).toBe(6);
    hb.cycle();
    expect(hb.selected).toBe(2);
  });

  it('ignores out-of-range slots', () => {
    const hb = new Hotbar();
    hb.assign(-1, bolt);
    hb.assign(HOTBAR_SIZE, bolt);
    expect(hb.slots.every((s) => s === null)).toBe(true);
  });
});

describe('Inventory use()', () => {
  it('decrements counts and refuses when empty', () => {
    const inv = new Inventory();
    inv.add('healPotion');
    expect(inv.use('healPotion')).toBe(true);
    expect(inv.count('healPotion')).toBe(0);
    expect(inv.use('healPotion')).toBe(false);
  });

  it('held() lists only owned consumables', () => {
    const inv = new Inventory();
    inv.add('bomb');
    inv.add('bomb');
    expect(inv.held()).toEqual([{ id: 'bomb', count: 2 }]);
  });
});
