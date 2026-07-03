// Spells, the player's spellbook (known spells + mana), and the 9-slot hotbar.
// Casting side-effects live in playScene; this file is data + pure state, unit-testable.

import { MANA_MAX, MANA_REGEN } from './config';
import type { ItemId } from './items';

export type SpellId = 'chaosBolt' | 'nova' | 'haste' | 'stoneskin' | 'cleanse' | 'blink';

export interface SpellDef {
  id: SpellId;
  name: string;
  cost: number; // mana
  kind: 'attack' | 'buff' | 'utility';
  description: string;
  learnMessage: string;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  chaosBolt: {
    id: 'chaosBolt', name: 'Chaos Bolt', cost: 2, kind: 'attack',
    description: 'Hurl an aimed bolt of chaos. (3 dmg)',
    learnMessage: 'Chaos Bolt crackles at your fingertips.',
  },
  nova: {
    id: 'nova', name: 'Nova', cost: 4, kind: 'attack',
    description: 'Blast everything nearby. (2 dmg + push)',
    learnMessage: 'You learn Nova! The air hums around you.',
  },
  haste: {
    id: 'haste', name: 'Haste', cost: 3, kind: 'buff',
    description: '+40% move speed for 8s.',
    learnMessage: 'You learn Haste! Your feet feel light.',
  },
  stoneskin: {
    id: 'stoneskin', name: 'Stoneskin', cost: 3, kind: 'buff',
    description: 'Shrug off 1 damage per hit for 8s.',
    learnMessage: 'You learn Stoneskin! Your skin hardens.',
  },
  cleanse: {
    id: 'cleanse', name: 'Cleanse', cost: 2, kind: 'utility',
    description: 'Cure poison, purge 8 corruption.',
    learnMessage: 'Cleanse settles into your mind like cool water.',
  },
  blink: {
    id: 'blink', name: 'Blink', cost: 2, kind: 'utility',
    description: 'Teleport a short distance toward your aim.',
    learnMessage: 'You learn Blink! Space folds politely.',
  },
};

export const ALL_SPELLS = Object.keys(SPELLS) as SpellId[];

export class Spellbook {
  readonly known: SpellId[] = [];
  mana = MANA_MAX;
  maxMana = MANA_MAX;

  knows(id: SpellId): boolean {
    return this.known.includes(id);
  }

  /** Returns false if already known. */
  learn(id: SpellId): boolean {
    if (this.knows(id)) return false;
    this.known.push(id);
    return true;
  }

  regen(dt: number): void {
    this.mana = Math.min(this.maxMana, this.mana + MANA_REGEN * dt);
  }

  canCast(id: SpellId): boolean {
    return this.knows(id) && this.mana >= SPELLS[id].cost;
  }

  /** Deduct the cost; returns false (and deducts nothing) if it can't be cast. */
  spend(id: SpellId): boolean {
    if (!this.canCast(id)) return false;
    this.mana -= SPELLS[id].cost;
    return true;
  }
}

export type HotbarEntry =
  | { kind: 'item'; id: ItemId }
  | { kind: 'spell'; id: SpellId };

export function entryEquals(a: HotbarEntry | null, b: HotbarEntry | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

export const HOTBAR_SIZE = 9;

export class Hotbar {
  readonly slots: (HotbarEntry | null)[] = new Array(HOTBAR_SIZE).fill(null);
  selected = 0; // gamepad cursor

  get(slot: number): HotbarEntry | null {
    return this.slots[slot] ?? null;
  }

  /** Bind an entry to a slot; the entry vacates any other slot it occupied. */
  assign(slot: number, entry: HotbarEntry | null): void {
    if (slot < 0 || slot >= HOTBAR_SIZE) return;
    if (entry) {
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        if (i !== slot && entryEquals(this.slots[i]!, entry)) this.slots[i] = null;
      }
    }
    this.slots[slot] = entry;
  }

  /** Put the entry in the first empty slot unless it is already bound somewhere. */
  autoAssign(entry: HotbarEntry): void {
    for (const s of this.slots) {
      if (entryEquals(s, entry)) return;
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (!this.slots[i]) {
        this.slots[i] = entry;
        return;
      }
    }
  }

  slotOf(entry: HotbarEntry): number {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (entryEquals(this.slots[i]!, entry)) return i;
    }
    return -1;
  }

  /** Gamepad: advance the cursor to the next non-empty slot. */
  cycle(): void {
    for (let step = 1; step <= HOTBAR_SIZE; step++) {
      const i = (this.selected + step) % HOTBAR_SIZE;
      if (this.slots[i]) {
        this.selected = i;
        return;
      }
    }
  }
}
