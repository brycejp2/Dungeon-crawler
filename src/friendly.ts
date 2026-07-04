// Friendly encounters and the gold economy: merchant shops, priests who sell
// cleansing, hermits with hints and gifts, and the captain's kill-quest chain.
// Pure data + logic; the interaction flow lives in playScene.

import type { ItemId } from './items';
import type { Rng } from './rng';

export type FriendlyKind = 'merchant' | 'priest' | 'hermit' | 'questgiver';

export const FRIENDLY_NAMES: Record<FriendlyKind, string> = {
  merchant: 'Merchant',
  priest: 'Priest of Order',
  hermit: 'Hermit',
  questgiver: 'Captain Aldric',
};

// --- shop prices ---

export const PRICES: Partial<Record<ItemId, number>> = {
  healPotion: 25,
  purityPotion: 40,
  elixir: 90,
  bomb: 15,
  arrows: 12,
  bow: 80,
  sword2: 120,
  sword3: 240,
};

export interface ShopEntry {
  item: ItemId;
  price: number;
  stock: number;
}

/**
 * A merchant's wares. depth 0 = village merchant (broad stock, carries the
 * bow); deeper merchants are trapped traders with leaner, stronger stock.
 */
export function merchantStock(depth: number, rng: Rng): ShopEntry[] {
  const stock: ShopEntry[] = [
    { item: 'healPotion', price: PRICES.healPotion!, stock: 2 },
    { item: 'purityPotion', price: PRICES.purityPotion!, stock: 2 },
    { item: 'bomb', price: PRICES.bomb!, stock: rng.int(2, 3) },
    { item: 'arrows', price: PRICES.arrows!, stock: rng.int(2, 4) },
  ];
  if (depth === 0) {
    stock.push({ item: 'bow', price: PRICES.bow!, stock: 1 });
  }
  if (depth === 0 || depth >= 4) {
    stock.push({ item: 'elixir', price: PRICES.elixir!, stock: 1 });
  }
  if (depth >= 1 && depth <= 3 && rng.chance(0.5)) {
    stock.push({ item: 'sword2', price: PRICES.sword2!, stock: 1 });
  } else if (depth >= 5 && rng.chance(0.4)) {
    stock.push({ item: 'sword3', price: PRICES.sword3!, stock: 1 });
  }
  return stock;
}

/** The castle merchant: freed when the bandits fall, sells the good steel. */
export function castleStock(rng: Rng): ShopEntry[] {
  return [
    { item: 'sword2', price: Math.round(PRICES.sword2! * 0.75), stock: 1 },
    { item: 'sword3', price: PRICES.sword3!, stock: 1 },
    { item: 'elixir', price: PRICES.elixir!, stock: 1 },
    { item: 'arrows', price: PRICES.arrows!, stock: rng.int(3, 5) },
    { item: 'bomb', price: PRICES.bomb!, stock: rng.int(2, 4) },
  ];
}

// --- priests: paid corruption cleansing ---

export const PRIEST_PRICE = 30;
export const PRIEST_CLEANSE = 20;

// --- the captain's quest chain ---

export interface QuestDef {
  id: string;
  description: string;
  targetKills: number; // kills counted from acceptance
  rewardGold: number;
  rewardItem: ItemId | null;
}

export const QUESTS: QuestDef[] = [
  {
    id: 'cull1', description: 'Slay 8 monsters',
    targetKills: 8, rewardGold: 40, rewardItem: null,
  },
  {
    id: 'cull2', description: 'Slay 15 more monsters',
    targetKills: 15, rewardGold: 90, rewardItem: 'healPotion',
  },
  {
    id: 'cull3', description: 'Slay 25 more monsters',
    targetKills: 25, rewardGold: 180, rewardItem: 'elixir',
  },
];

/** Progress on the active quest, tracked by the scene. */
export interface QuestProgress {
  def: QuestDef;
  killsAtAccept: number;
}

// --- hermits ---

export const HERMIT_HINTS: string[] = [
  'The corruption never sleeps. Neither should your feet.',
  'Purity potions are worth more than gold, deeper down.',
  'The Herald stumbles after it charges. Strike then.',
  'Chaos seals guard the stairs. The keys never lie far off.',
  'Bats care nothing for shadow. Listen for wings.',
  'A dodge well-timed passes through arrows like mist.',
  'The deeper you go, the faster the rot takes hold.',
  'Bandits hold the castle. Their captive trades in fine steel.',
];

export function hermitHint(rng: Rng): string {
  return rng.pick(HERMIT_HINTS);
}

export function hermitGift(rng: Rng): number {
  return rng.int(8, 18);
}

// --- gold drops ---

export function goldDropFor(depth: number, rng: Rng): number {
  return rng.int(1, 3) + Math.max(0, depth);
}

export function goldPileFor(depth: number, rng: Rng): number {
  return rng.int(4, 6 + 2 * Math.max(1, depth));
}
