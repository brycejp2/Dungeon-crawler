import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, mergeSettings, computeScore, makeHighScore,
  insertHighScore, missingIndices, MAX_SCORES, type HighScore,
} from '../src/storage';
import type { RunStats } from '../src/game';

function stats(over: Partial<RunStats> = {}): RunStats {
  return {
    identity: 'Kara the Elf Mage',
    depth: 3, level: 4, kills: 20,
    corruptionPoints: 40, mutationCount: 2, timeSec: 300, cause: 'Slain',
    ...over,
  };
}

describe('mergeSettings', () => {
  it('returns defaults for junk / missing input', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('applies known fields and ignores unknown ones', () => {
    const s = mergeSettings({ sound: false, volume: 30, reduceFlashing: true, bogus: 1 });
    expect(s).toEqual({ sound: false, volume: 30, reduceFlashing: true });
  });

  it('clamps and rounds volume; ignores wrong types', () => {
    expect(mergeSettings({ volume: 250 }).volume).toBe(100);
    expect(mergeSettings({ volume: -5 }).volume).toBe(0);
    expect(mergeSettings({ volume: 33.7 }).volume).toBe(34);
    expect(mergeSettings({ volume: 'loud' }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(mergeSettings({ volume: NaN }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(mergeSettings({ sound: 'yes' }).sound).toBe(DEFAULT_SETTINGS.sound);
  });

  it('does not mutate the DEFAULT_SETTINGS singleton', () => {
    const s = mergeSettings({ volume: 10 });
    s.volume = 99;
    expect(DEFAULT_SETTINGS.volume).toBe(70);
  });
});

describe('computeScore', () => {
  it('rewards depth, kills, level and a big victory bonus', () => {
    const base = computeScore(stats(), false);
    expect(computeScore(stats({ depth: 4 }), false)).toBeGreaterThan(base);
    expect(computeScore(stats({ kills: 21 }), false)).toBeGreaterThan(base);
    expect(computeScore(stats({ level: 5 }), false)).toBeGreaterThan(base);
    expect(computeScore(stats(), true)).toBeGreaterThan(base + 4000);
  });

  it('a victory always outranks an otherwise-equal death', () => {
    expect(computeScore(stats(), true)).toBeGreaterThan(computeScore(stats(), false));
  });
});

describe('insertHighScore', () => {
  const mk = (score: number, date = 1): HighScore => ({
    name: 'Hero', score, depth: 1, level: 1, kills: 0, timeSec: 0, won: false, date,
  });

  it('keeps the list sorted high-to-low', () => {
    let list: HighScore[] = [];
    for (const v of [30, 10, 50, 20, 40]) list = insertHighScore(list, mk(v));
    expect(list.map((s) => s.score)).toEqual([50, 40, 30, 20, 10]);
  });

  it('caps the list at MAX_SCORES, dropping the lowest', () => {
    let list: HighScore[] = [];
    for (let i = 0; i < MAX_SCORES + 5; i++) list = insertHighScore(list, mk(i));
    expect(list).toHaveLength(MAX_SCORES);
    expect(list[0]!.score).toBe(MAX_SCORES + 4);
    expect(Math.min(...list.map((s) => s.score))).toBe(5);
  });

  it('a too-low score does not displace a full board', () => {
    let list: HighScore[] = [];
    for (let i = 10; i < 10 + MAX_SCORES; i++) list = insertHighScore(list, mk(i));
    const before = list.map((s) => s.score);
    list = insertHighScore(list, mk(1));
    expect(list.map((s) => s.score)).toEqual(before);
  });

  it('breaks score ties by most recent', () => {
    let list = insertHighScore([], mk(20, 100));
    list = insertHighScore(list, mk(20, 200));
    expect(list[0]!.date).toBe(200);
  });

  it('returns the same entry reference when it qualifies (used for "new high score")', () => {
    const entry = makeHighScore(stats(), true);
    const list = insertHighScore([], entry);
    expect(list.includes(entry)).toBe(true);
  });
});

describe('missingIndices (per-map save deltas)', () => {
  it('returns the collected/dead indices absent from the survivor list', () => {
    expect(missingIndices(5, [0, 2, 4])).toEqual([1, 3]);
    expect(missingIndices(3, [])).toEqual([0, 1, 2]); // everything gone
    expect(missingIndices(3, [0, 1, 2])).toEqual([]); // nothing gone
    expect(missingIndices(0, [])).toEqual([]);
  });

  it('ignores out-of-range and duplicate survivor ids', () => {
    expect(missingIndices(4, [1, 1, 9, -2])).toEqual([0, 2, 3]);
  });

  it('round-trips: survivors + missing reconstruct the full index set', () => {
    const total = 8;
    const survivors = [1, 4, 7];
    const missing = missingIndices(total, survivors);
    const all = [...survivors, ...missing].sort((a, b) => a - b);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('makeHighScore', () => {
  it('captures the run summary and outcome', () => {
    const hs = makeHighScore(stats({ depth: 8 }), true, 12345);
    expect(hs.name).toBe('Kara the Elf Mage');
    expect(hs.depth).toBe(8);
    expect(hs.won).toBe(true);
    expect(hs.date).toBe(12345);
    expect(hs.score).toBe(computeScore(stats({ depth: 8 }), true));
  });
});
