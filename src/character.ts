// Character creation data: races, classes, blessings, and the pure build step
// that turns a chosen character into starting stats. Fully unit-testable.

import { neutralEffects, mergeEffects } from './corruption';
import type { MutationEffects } from './corruption';
import type { SpellId } from './spells';
import type { ItemId } from './items';
import type { Rng } from './rng';

export type GenderId = 'female' | 'male' | 'unspoken';
export type RaceId = 'human' | 'elf' | 'dwarf' | 'orc' | 'halfling';
export type ClassId = 'knight' | 'ranger' | 'mage' | 'priest' | 'rogue';
export type BlessingId =
  | 'vigor' | 'clarity' | 'swiftness' | 'fortune'
  | 'purity' | 'hunt' | 'order' | 'echoes';

export interface CharacterDef {
  name: string;
  gender: GenderId;
  race: RaceId;
  clazz: ClassId;
  blessing: BlessingId;
}

/** One race/class/blessing's contribution to the final build. */
interface Modifier {
  fx?: Partial<MutationEffects>;
  maxManaDelta?: number;
  manaRegenMult?: number;
  spellCostReduction?: number;
  spells?: SpellId[];
  items?: ItemId[];
  bow?: boolean;
  arrows?: number;
  graces?: number;
}

export interface RaceDef {
  id: RaceId;
  name: string;
  description: string;
  mod: Modifier;
  skin: string; // sprite palette
  hair: string;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  description: string;
  mod: Modifier;
}

export interface BlessingDef {
  id: BlessingId;
  name: string;
  description: string;
  mod: Modifier;
}

export const GENDERS: { id: GenderId; name: string }[] = [
  { id: 'female', name: 'Female' },
  { id: 'male', name: 'Male' },
  { id: 'unspoken', name: 'Unspoken' },
];

export const RACES: Record<RaceId, RaceDef> = {
  human: {
    id: 'human', name: 'Human',
    description: 'Adaptable. Packs an extra heal potion.',
    mod: { items: ['healPotion'] },
    skin: '#f0c890', hair: '#7a4a20',
  },
  elf: {
    id: 'elf', name: 'Elf',
    description: '+3 mana, +8% speed, one heart fewer.',
    mod: { fx: { maxHpDelta: -2, speedMult: 1.08 }, maxManaDelta: 3 },
    skin: '#f0d8a8', hair: '#e8d060',
  },
  dwarf: {
    id: 'dwarf', name: 'Dwarf',
    description: '+1 heart, corruption 10% slower, a bit slow.',
    mod: { fx: { maxHpDelta: 2, speedMult: 0.92, corruptionRateMult: 0.9 } },
    skin: '#e8b888', hair: '#b04020',
  },
  orc: {
    id: 'orc', name: 'Orc',
    description: '+1 sword damage, but chaos-tainted (+15% corruption).',
    mod: { fx: { damageBonus: 1, corruptionRateMult: 1.15 } },
    skin: '#98b060', hair: '#3a4a2a',
  },
  halfling: {
    id: 'halfling', name: 'Halfling',
    description: 'Quick dodge, +5% speed, one heart fewer. Loves bombs.',
    mod: { fx: { maxHpDelta: -2, dodgeCooldownMult: 0.7, speedMult: 1.05 }, items: ['bomb', 'bomb'] },
    skin: '#f0c890', hair: '#6a3a10',
  },
};

export const CLASSES: Record<ClassId, ClassDef> = {
  knight: {
    id: 'knight', name: 'Knight',
    description: '+1 heart, knows Stoneskin. -2 mana.',
    mod: { fx: { maxHpDelta: 2 }, maxManaDelta: -2, spells: ['stoneskin'] },
  },
  ranger: {
    id: 'ranger', name: 'Ranger',
    description: 'Starts with a bow and 10 arrows. Knows Haste.',
    mod: { bow: true, arrows: 10, spells: ['haste'] },
  },
  mage: {
    id: 'mage', name: 'Mage',
    description: '+4 mana, faster regen, knows Nova. One heart fewer.',
    mod: { fx: { maxHpDelta: -2 }, maxManaDelta: 4, manaRegenMult: 1.4, spells: ['nova'] },
  },
  priest: {
    id: 'priest', name: 'Priest',
    description: 'Potions & cleansing 25% stronger. Starts with a purity potion.',
    mod: { fx: { healMult: 1.25, purityMult: 1.25 }, items: ['purityPotion'] },
  },
  rogue: {
    id: 'rogue', name: 'Rogue',
    description: 'Fast dodge, +5% speed, knows Blink. Starts with a bomb.',
    mod: { fx: { dodgeCooldownMult: 0.75, speedMult: 1.05 }, spells: ['blink'], items: ['bomb'] },
  },
};

export const BLESSINGS: Record<BlessingId, BlessingDef> = {
  vigor: {
    id: 'vigor', name: 'Blessing of Vigor',
    description: '+1 max heart.',
    mod: { fx: { maxHpDelta: 2 } },
  },
  clarity: {
    id: 'clarity', name: 'Blessing of Clarity',
    description: '+3 max mana.',
    mod: { maxManaDelta: 3 },
  },
  swiftness: {
    id: 'swiftness', name: 'Blessing of Swiftness',
    description: '+10% move speed.',
    mod: { fx: { speedMult: 1.1 } },
  },
  fortune: {
    id: 'fortune', name: 'Blessing of Fortune',
    description: 'Start with two extra heal potions.',
    mod: { items: ['healPotion', 'healPotion'] },
  },
  purity: {
    id: 'purity', name: 'Blessing of Purity',
    description: 'Corruption spreads 15% slower.',
    mod: { fx: { corruptionRateMult: 0.85 } },
  },
  hunt: {
    id: 'hunt', name: 'Blessing of the Hunt',
    description: 'Start with a bow and 5 arrows.',
    mod: { bow: true, arrows: 5 },
  },
  order: {
    id: 'order', name: 'Blessing of Order',
    description: 'Your first mutation is absorbed harmlessly.',
    mod: { graces: 1 },
  },
  echoes: {
    id: 'echoes', name: 'Blessing of Echoes',
    description: 'All spells cost 1 less mana (min 1).',
    mod: { spellCostReduction: 1 },
  },
};

export const ALL_RACES = Object.keys(RACES) as RaceId[];
export const ALL_CLASSES = Object.keys(CLASSES) as ClassId[];
export const ALL_BLESSINGS = Object.keys(BLESSINGS) as BlessingId[];
export const UNIVERSAL_SPELLS: SpellId[] = ['chaosBolt', 'cleanse'];

/** The final, resolved starting package for a run. */
export interface CharacterBuild {
  fx: MutationEffects; // permanent base effects (merged with mutations later)
  maxManaDelta: number;
  manaRegenMult: number;
  spellCostReduction: number;
  spells: SpellId[]; // includes universal spells
  items: ItemId[];
  bow: boolean;
  arrows: number;
  graces: number;
}

export function buildCharacter(def: CharacterDef): CharacterBuild {
  const build: CharacterBuild = {
    fx: neutralEffects(),
    maxManaDelta: 0,
    manaRegenMult: 1,
    spellCostReduction: 0,
    spells: [...UNIVERSAL_SPELLS],
    items: [],
    bow: false,
    arrows: 0,
    graces: 0,
  };
  for (const mod of [RACES[def.race].mod, CLASSES[def.clazz].mod, BLESSINGS[def.blessing].mod]) {
    if (mod.fx) build.fx = mergeEffects(build.fx, { ...neutralEffects(), ...mod.fx });
    build.maxManaDelta += mod.maxManaDelta ?? 0;
    build.manaRegenMult *= mod.manaRegenMult ?? 1;
    build.spellCostReduction += mod.spellCostReduction ?? 0;
    for (const s of mod.spells ?? []) {
      if (!build.spells.includes(s)) build.spells.push(s);
    }
    build.items.push(...(mod.items ?? []));
    build.bow = build.bow || (mod.bow ?? false);
    build.arrows += mod.arrows ?? 0;
    build.graces += mod.graces ?? 0;
  }
  return build;
}

export function identityOf(def: CharacterDef): string {
  return `${def.name} the ${RACES[def.race].name} ${CLASSES[def.clazz].name}`;
}

/** Roll the 4 distinct blessing options offered on the creation screen. */
export function rollBlessingOptions(rng: Rng): BlessingId[] {
  return rng.shuffle([...ALL_BLESSINGS]).slice(0, 4);
}

const NAME_STARTS = ['Al', 'Ka', 'Tho', 'Ly', 'Gru', 'Bra', 'El', 'Mi', 'Dor', 'Syl', 'Ru', 'Nes', 'Va', 'Fen', 'Isa', 'Or'];
const NAME_ENDS = ['dric', 'ra', 'rin', 'na', 'm', 'n', 'ric', 'la', 'dor', 'wyn', 'gar', 'lis', 'bel', 'mund'];

export function randomName(rng: Rng): string {
  return rng.pick(NAME_STARTS) + rng.pick(NAME_ENDS);
}

export function randomCharacter(rng: Rng, blessingOptions?: BlessingId[]): CharacterDef {
  const options = blessingOptions ?? rollBlessingOptions(rng);
  return {
    name: randomName(rng),
    gender: rng.pick(GENDERS).id,
    race: rng.pick(ALL_RACES),
    clazz: rng.pick(ALL_CLASSES),
    blessing: rng.pick(options),
  };
}
