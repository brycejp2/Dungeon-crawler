// Item definitions and the player's inventory.
// Use-effects are applied by playScene (they need world access); this file is data + container.

export type ItemId =
  | 'sword1' | 'sword2' | 'sword3'
  | 'healPotion' | 'purityPotion' | 'elixir' | 'bomb'
  | 'key';

export interface WeaponStats {
  damage: number;
  reach: number; // px added to swing extent
  tier: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'weapon' | 'consumable' | 'key';
  weapon?: WeaponStats;
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
  key: {
    id: 'key', name: 'Chaos Key', kind: 'key',
    pickupMessage: 'You found the floor\'s key!',
  },
};

const CONSUMABLE_ORDER: ItemId[] = ['healPotion', 'purityPotion', 'elixir', 'bomb'];

export class Inventory {
  weapon: ItemId = 'sword1';
  hasKey = false;
  private counts = new Map<ItemId, number>();
  private selectedIdx = 0;

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
    this.counts.set(item, this.count(item) + 1);
    if (this.selected === null) this.selectFirstAvailable();
    return true;
  }

  /** Currently selected consumable, or null if none held. */
  get selected(): ItemId | null {
    const id = CONSUMABLE_ORDER[this.selectedIdx]!;
    return this.count(id) > 0 ? id : this.firstAvailable();
  }

  private firstAvailable(): ItemId | null {
    for (const id of CONSUMABLE_ORDER) {
      if (this.count(id) > 0) return id;
    }
    return null;
  }

  private selectFirstAvailable(): void {
    for (let i = 0; i < CONSUMABLE_ORDER.length; i++) {
      if (this.count(CONSUMABLE_ORDER[i]!) > 0) {
        this.selectedIdx = i;
        return;
      }
    }
  }

  cycle(): void {
    for (let step = 1; step <= CONSUMABLE_ORDER.length; step++) {
      const idx = (this.selectedIdx + step) % CONSUMABLE_ORDER.length;
      if (this.count(CONSUMABLE_ORDER[idx]!) > 0) {
        this.selectedIdx = idx;
        return;
      }
    }
  }

  /** Consume the selected item; returns which item was used or null. */
  useSelected(): ItemId | null {
    const id = this.selected;
    if (!id) return null;
    this.counts.set(id, this.count(id) - 1);
    if (this.count(id) === 0) this.selectFirstAvailable();
    return id;
  }

  useKey(): boolean {
    if (!this.hasKey) return false;
    this.hasKey = false;
    return true;
  }

  /** For the HUD inventory bar. */
  consumables(): { id: ItemId; count: number; selected: boolean }[] {
    return CONSUMABLE_ORDER.map((id) => ({
      id,
      count: this.count(id),
      selected: this.selected === id,
    }));
  }
}
