import { describe, it, expect } from 'vitest';
import {
  PRICES, QUESTS, HERMIT_HINTS, PRIEST_PRICE, PRIEST_CLEANSE,
  merchantStock, castleStock, hermitHint, hermitGift, goldDropFor, goldPileFor,
} from '../src/friendly';
import { ITEMS } from '../src/items';
import { Rng } from '../src/rng';

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 104729 + 7);

describe('merchantStock', () => {
  it('always carries the survival staples', () => {
    for (const seed of SEEDS) {
      for (const depth of [0, 1, 3, 5, 7]) {
        const stock = merchantStock(depth, new Rng(seed));
        const items = stock.map((s) => s.item);
        expect(items).toContain('healPotion');
        expect(items).toContain('purityPotion');
        expect(items).toContain('bomb');
        expect(items).toContain('arrows');
      }
    }
  });

  it('village merchants (depth 0) sell the bow and elixir', () => {
    for (const seed of SEEDS) {
      const items = merchantStock(0, new Rng(seed)).map((s) => s.item);
      expect(items).toContain('bow');
      expect(items).toContain('elixir');
    }
  });

  it('deep merchants (4+) always stock the elixir', () => {
    for (const seed of SEEDS) {
      const items = merchantStock(5, new Rng(seed)).map((s) => s.item);
      expect(items).toContain('elixir');
    }
  });

  it('never sells sword3 in the shallows or sword2 in the depths', () => {
    for (const seed of SEEDS) {
      const shallow = merchantStock(2, new Rng(seed)).map((s) => s.item);
      expect(shallow).not.toContain('sword3');
      const deep = merchantStock(6, new Rng(seed)).map((s) => s.item);
      expect(deep).not.toContain('sword2');
    }
  });

  it('every entry has a positive price matching PRICES and stock >= 1', () => {
    for (const seed of SEEDS) {
      for (const stock of [merchantStock(0, new Rng(seed)), merchantStock(4, new Rng(seed)), castleStock(new Rng(seed))]) {
        for (const s of stock) {
          expect(s.price).toBeGreaterThan(0);
          expect(s.stock).toBeGreaterThanOrEqual(1);
          expect(PRICES[s.item], `price defined for ${s.item}`).toBeDefined();
          expect(ITEMS[s.item], `item def exists for ${s.item}`).toBeDefined();
        }
      }
    }
  });

  it('the castle merchant discounts sword2 and carries sword3', () => {
    const stock = castleStock(new Rng(1));
    const sword2 = stock.find((s) => s.item === 'sword2')!;
    const sword3 = stock.find((s) => s.item === 'sword3')!;
    expect(sword2.price).toBeLessThan(PRICES.sword2!);
    expect(sword3.price).toBe(PRICES.sword3!);
  });
});

describe('quest chain', () => {
  it('has three escalating quests with escalating rewards', () => {
    expect(QUESTS).toHaveLength(3);
    for (let i = 1; i < QUESTS.length; i++) {
      expect(QUESTS[i]!.targetKills).toBeGreaterThan(QUESTS[i - 1]!.targetKills);
      expect(QUESTS[i]!.rewardGold).toBeGreaterThan(QUESTS[i - 1]!.rewardGold);
    }
  });

  it('reward items reference real item defs', () => {
    for (const q of QUESTS) {
      if (q.rewardItem) expect(ITEMS[q.rewardItem]).toBeDefined();
    }
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
  });
});

describe('hermits and gold', () => {
  it('hermitHint draws from the hint pool', () => {
    for (const seed of SEEDS) {
      expect(HERMIT_HINTS).toContain(hermitHint(new Rng(seed)));
    }
  });

  it('hermit gifts and gold drops stay in sane bounds', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed);
      const gift = hermitGift(rng);
      expect(gift).toBeGreaterThanOrEqual(8);
      expect(gift).toBeLessThanOrEqual(18);
      for (const depth of [0, 1, 4, 8]) {
        const drop = goldDropFor(depth, rng);
        expect(drop).toBeGreaterThanOrEqual(1);
        expect(drop).toBeLessThanOrEqual(3 + depth);
        const pile = goldPileFor(depth, rng);
        expect(pile).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('priest rites are priced and potent', () => {
    expect(PRIEST_PRICE).toBeGreaterThan(0);
    expect(PRIEST_CLEANSE).toBeGreaterThan(0);
  });
});
