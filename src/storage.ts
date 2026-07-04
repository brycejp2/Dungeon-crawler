// Persistence: settings, high scores, and a suspended-run save for Continue.
// localStorage access is guarded (private mode / SSR safe). The pure helpers
// (scoring, insertion, settings merge) are separated out so they unit-test
// without a DOM.

import type { RunStats } from './game';
import type { CharacterDef } from './character';
import type { MutationId } from './corruption';
import type { SpellId, HotbarEntry } from './spells';
import type { ItemId } from './items';
import type { ShopEntry } from './friendly';

const KEY_SETTINGS = 'cc.settings.v1';
const KEY_SCORES = 'cc.scores.v1';
const KEY_SAVE = 'cc.save.v1';

// --- settings ---

export interface Settings {
  sound: boolean;
  volume: number; // 0..100
  reduceFlashing: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 70,
  reduceFlashing: false,
};

/** Merge a possibly-partial/unknown stored blob onto the defaults, clamped. */
export function mergeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.sound === 'boolean') s.sound = r.sound;
    if (typeof r.volume === 'number' && Number.isFinite(r.volume)) {
      s.volume = Math.max(0, Math.min(100, Math.round(r.volume)));
    }
    if (typeof r.reduceFlashing === 'boolean') s.reduceFlashing = r.reduceFlashing;
  }
  return s;
}

// live singleton so gameplay (flash suppression) and audio can read settings
let liveSettings: Settings = { ...DEFAULT_SETTINGS };

export function getSettings(): Settings {
  return liveSettings;
}

// --- high scores ---

export interface HighScore {
  name: string; // character identity, e.g. "Kara the Elf Mage"
  score: number;
  depth: number;
  level: number;
  kills: number;
  timeSec: number;
  won: boolean;
  date: number; // epoch ms
}

export const MAX_SCORES = 10;

/** A single number ranking a run: depth and victory dominate, then kills/level. */
export function computeScore(stats: RunStats, won: boolean): number {
  return (
    stats.depth * 250 +
    stats.kills * 10 +
    stats.level * 40 +
    (won ? 5000 : 0)
  );
}

export function makeHighScore(stats: RunStats, won: boolean, now = Date.now()): HighScore {
  return {
    name: stats.identity,
    score: computeScore(stats, won),
    depth: stats.depth,
    level: stats.level,
    kills: stats.kills,
    timeSec: stats.timeSec,
    won,
    date: now,
  };
}

/** Insert a score, keep the list sorted high-to-low, capped at MAX_SCORES. */
export function insertHighScore(list: HighScore[], entry: HighScore): HighScore[] {
  const next = [...list, entry].sort((a, b) => b.score - a.score || b.date - a.date);
  return next.slice(0, MAX_SCORES);
}

// --- suspended run save (Continue) ---

/**
 * Per-map deltas so a resumed run keeps cleared floors cleared. Maps still
 * regenerate deterministically from the seed; these record only what the
 * player changed: which base enemies/pickups survive, opened doors, blown
 * rubble, and merchant/hermit state. Transient entities (kill drops, wild
 * spawns, chaos reinforcements, summoned bats) are intentionally dropped.
 */
export interface SiteSave {
  key: string; // 'world' or `${dungeonId}:${depth}`
  enemies: { idx: number; hp: number; corrupted: boolean }[]; // surviving base enemies
  takenPickups: number[]; // spawn indices already collected
  doorsOpen: boolean;
  rubbleCleared: [number, number][];
  npcs: { key: string; giftGiven: boolean; stock: ShopEntry[] | null }[];
}

/** Indices in [0, total) not present in `present` — e.g. collected pickups. */
export function missingIndices(total: number, present: readonly number[]): number[] {
  const set = new Set(present);
  const out: number[] = [];
  for (let i = 0; i < total; i++) if (!set.has(i)) out.push(i);
  return out;
}

export interface RunSave {
  version: 1;
  savedAt: number;
  seed: number;
  character: CharacterDef;
  site: { kind: 'world' } | { kind: 'dungeon'; id: string; depth: number };
  player: {
    x: number; y: number; hp: number; maxHp: number; facing: string;
    hasteT: number; stoneskinT: number; poisoned: boolean;
  };
  inventory: {
    weapon: ItemId; hasKey: boolean; hasBow: boolean; arrows: number; gold: number;
    counts: [ItemId, number][];
  };
  spellbook: { known: SpellId[]; mana: number; maxMana: number };
  hotbar: { slots: (HotbarEntry | null)[]; selected: number };
  corruption: { points: number; tierReached: number; mutations: MutationId[]; graces: number };
  progression: { level: number; xp: number };
  levelHpBonus: number;
  levelDamageBonus: number;
  kills: number;
  time: number;
  deepestGate: number;
  appliedChaosTier: number;
  shrineUses: [string, number][];
  healerTimes: [string, number][];
  quest: { idx: number; activeId: string | null; killsAtAccept: number; notified: boolean };
  sites: SiteSave[];
}

// --- localStorage plumbing (guarded) ---

function ls(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const store = ls();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode: silently ignore */
  }
}

function remove(key: string): void {
  const store = ls();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  liveSettings = mergeSettings(readJson<unknown>(KEY_SETTINGS));
  return liveSettings;
}

export function saveSettings(s: Settings): void {
  liveSettings = mergeSettings(s);
  writeJson(KEY_SETTINGS, liveSettings);
}

export function loadHighScores(): HighScore[] {
  const list = readJson<HighScore[]>(KEY_SCORES);
  return Array.isArray(list) ? list : [];
}

/** Record a finished run; returns the new table and whether it made the cut. */
export function submitScore(stats: RunStats, won: boolean): { scores: HighScore[]; qualified: boolean } {
  const entry = makeHighScore(stats, won);
  const scores = insertHighScore(loadHighScores(), entry);
  writeJson(KEY_SCORES, scores);
  return { scores, qualified: scores.includes(entry) };
}

export function loadSave(): RunSave | null {
  const save = readJson<RunSave>(KEY_SAVE);
  return save && save.version === 1 ? save : null;
}

export function hasSave(): boolean {
  return loadSave() !== null;
}

export function writeSave(save: RunSave): void {
  writeJson(KEY_SAVE, save);
}

export function clearSave(): void {
  remove(KEY_SAVE);
}
