// Item definitions and the player's inventory.
// Use-effects are applied by playScene (they need world access); this file is data + container.

import type { SpellId } from './spells';

export type ItemId =
  | 'sword1' | 'sword2' | 'sword3'
  | 'bow' | 'arrows'
  | 'healPotion' | 'purityPotion' | 'elixir' | 'bomb'
  | 'tomeNova' | 'tomeHaste' | 'tomeStoneskin' | 'tomeBlink'
  | 'key';

export const ARROWS_PER_BUNDLE = 5;

export interface WeaponStats {
  damage: number;
  reach: number; // px added to swing extent
  tier: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'weapon' | 'consumable' | 'key' | 'tool' | 'ammo' | 'tome';
  weapon?: WeaponStats;
  spell?: SpellId; // for tomes: the spell taught
  pickupMessage: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  sword1: {
    id: 'sword1', name: 'Rusty Sword', kind: 'weapon',
    weapon: { damage: 1, reach: 0, tier: 1 },
    pickupMessage: 'A rusty sword. Better than nothing.',
  },
  sword2: {
    id: 'sword2', name: "Soldier's Blade", kind: 'weapon',
    weapon: { damage: 2, reach: 2, tier: 2 },
    pickupMessage: "You take up the Soldier's Blade!",
  },
  sword3: {
    id: 'sword3', name: 'Chaosbane', kind: 'weapon',
    weapon: { damage: 3, reach: 6, tier: 3 },
    pickupMessage: 'Chaosbane hums with purpose!',
  },
  bow: {
    id: 'bow', name: "Hunter's Bow", kind: 'tool',
    pickupMessage: "A hunter's bow! Aim with the mouse, click to shoot.",
  },
  arrows: {
    id: 'arrows', name: 'Arrows', kind: 'ammo',
    pickupMessage: `You gather arrows. (+${ARROWS_PER_BUNDLE})`,
  },
  healPotion: {
    id: 'healPotion', name: 'Heal Potion', kind: 'consumable',
    pickupMessage: 'You pick up a heal potion.',
  },
  purityPotion: {
    id: 'purityPotion', name: 'Purity Potion', kind: 'consumable',
    pickupMessage: 'You pick up a shimmering purity potion.',
  },
  elixir: {
    id: 'elixir', name: 'Elixir of Order', kind: 'consumable',
    pickupMessage: 'The Elixir of Order glows softly.',
  },
  bomb: {
    id: 'bomb', name: 'Bomb', kind: 'consumable',
    pickupMessage: 'You pick up a bomb.',
  },
  tomeNova: {
    id: 'tomeNova', name: 'Tome of Nova', kind: 'tome', spell: 'nova',
    pickupMessage: 'A scorched tome, humming with force.',
  },
  tomeHaste: {
    id: 'tomeHaste', name: 'Tome of Haste', kind: 'tome', spell: 'haste',
    pickupMessage: 'A featherlight tome, pages fluttering.',
  },
  tomeStoneskin: {
    id: 'tomeStoneskin', name: 'Tome of Stoneskin', kind: 'tome', spell: 'stoneskin',
    pickupMessage: 'A tome bound in granite scales.',
  },
  tomeBlink: {
    id: 'tomeBlink', name: 'Tome of Blink', kind: 'tome', spell: 'blink',
    pickupMessage: 'A tome that is never quite where you left it.',
  },
  key: {
    id: 'key', name: 'Chaos Key', kind: 'key',
    pickupMessage: 'You found the floor\'s key!',
  },
};

export const CONSUMABLE_ORDER: ItemId[] = ['healPotion', 'purityPotion', 'elixir', 'bomb'];

export class Inventory {
  weapon: ItemId = 'sword1';
  hasKey = false;
  hasBow = false;
  arrows = 0;
  gold = 0;
  private counts = new Map<ItemId, number>();

  get weaponStats(): WeaponStats {
    return ITEMS[this.weapon].weapon!;
  }

  count(item: ItemId): number {
    return this.counts.get(item) ?? 0;
  }

  /** Returns true if the item was taken (weapons only if strictly better). */
  add(item: ItemId): boolean {
    const def = ITEMS[item];
    if (def.kind === 'weapon') {
      if (def.weapon!.tier <= this.weaponStats.tier) return false;
      this.weapon = item;
      return true;
    }
    if (def.kind === 'key') {
      this.hasKey = true;
      return true;
    }
    if (def.kind === 'tool') {
      // duplicate bows become a small arrow refill
      if (this.hasBow) {
        this.arrows += 3;
        return true;
      }
      this.hasBow = true;
      this.arrows += ARROWS_PER_BUNDLE;
      return true;
    }
    if (def.kind === 'ammo') {
      this.arrows += ARROWS_PER_BUNDLE;
      return true;
    }
    this.counts.set(item, this.count(item) + 1);
    return true;
  }

  /** Consume one of the item; returns false if none held. */
  use(item: ItemId): boolean {
    if (this.count(item) <= 0) return false;
    this.counts.set(item, this.count(item) - 1);
    return true;
  }

  useKey(): boolean {
    if (!this.hasKey) return false;
    this.hasKey = false;
    return true;
  }

  /** Snapshot consumable counts for saving. */
  snapshotCounts(): [ItemId, number][] {
    return [...this.counts.entries()];
  }

  /** Restore consumable counts from a save. */
  setCounts(entries: [ItemId, number][]): void {
    this.counts = new Map(entries);
  }

  /** Consumables currently held (for the inventory window). */
  held(): { id: ItemId; count: number }[] {
    return CONSUMABLE_ORDER
      .map((id) => ({ id, count: this.count(id) }))
      .filter((e) => e.count > 0);
  }
}
