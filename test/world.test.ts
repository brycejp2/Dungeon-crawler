import { describe, it, expect } from 'vitest';
import { generateWorld, CHAOS_EVENTS, villageIntact } from '../src/world';
import type { WorldData } from '../src/world';
import { Tile, bfsDistances, isPassable } from '../src/dungeon';
import { WORLD_W, WORLD_H } from '../src/config';
import { Rng } from '../src/rng';

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 15485863 + 7);

function reachableFrom(world: WorldData): Int32Array {
  return bfsDistances(world.tiles, world.w, world.h, world.spawn, false);
}

function at(world: WorldData, x: number, y: number): Tile {
  return world.tiles[y * world.w + x] as Tile;
}

describe('generateWorld across 20 seeds', () => {
  const worlds = SEEDS.map((s) => generateWorld(s));

  it('is deterministic for the same seed', () => {
    const a = generateWorld(777);
    const b = generateWorld(777);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.npcSpawns).toEqual(b.npcSpawns);
    expect(a.gate).toEqual(b.gate);
  });

  it('has the right size and a walkable spawn', () => {
    for (const w of worlds) {
      expect(w.w).toBe(WORLD_W);
      expect(w.h).toBe(WORLD_H);
      expect(isPassable(at(w, w.spawn.x, w.spawn.y), false)).toBe(true);
    }
  });

  it('all three dungeon entrances exist and are reachable from spawn', () => {
    for (const w of worlds) {
      const dist = reachableFrom(w);
      expect(at(w, w.gate.x, w.gate.y)).toBe(Tile.GateEntrance);
      expect(at(w, w.barrow.x, w.barrow.y)).toBe(Tile.CaveEntrance);
      expect(at(w, w.mine.x, w.mine.y)).toBe(Tile.MineEntrance);
      expect(dist[w.gate.y * w.w + w.gate.x]).toBeGreaterThan(0);
      expect(dist[w.barrow.y * w.w + w.barrow.x]).toBeGreaterThan(0);
      expect(dist[w.mine.y * w.w + w.mine.x]).toBeGreaterThan(0);
    }
  });

  it('the castle interior is reachable and holds loot', () => {
    for (const w of worlds) {
      const dist = reachableFrom(w);
      const cx = Math.floor(w.castle.x + w.castle.w / 2);
      const cy = Math.floor(w.castle.y + w.castle.h / 2);
      expect(dist[cy * w.w + cx]).toBeGreaterThan(0);
      expect(w.itemSpawns.length).toBeGreaterThan(0);
    }
  });

  it('both villages have adjacent-reachable shrines and healers', () => {
    for (const w of worlds) {
      const dist = reachableFrom(w);
      for (const v of [w.homeVillage, w.farVillage]) {
        expect(at(w, v.shrine.x, v.shrine.y)).toBe(Tile.Shrine);
        expect(at(w, v.healer.x, v.healer.y)).toBe(Tile.Healer);
        for (const p of [v.shrine, v.healer]) {
          const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const i = (p.y + dy!) * w.w + (p.x + dx!);
            return dist[i]! >= 0;
          });
          expect(adjacent).toBe(true);
        }
      }
    }
  });

  it('villages are populated and named differently', () => {
    for (const w of worlds) {
      expect(w.npcSpawns.filter((n) => n.village === 'home').length).toBeGreaterThanOrEqual(3);
      expect(w.npcSpawns.filter((n) => n.village === 'far').length).toBeGreaterThanOrEqual(2);
      expect(w.homeVillage.name).not.toBe(w.farVillage.name);
    }
  });

  it('the Gate is ringed by chaos-touched land', () => {
    for (const w of worlds) {
      let corrupt = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (at(w, w.gate.x + dx, w.gate.y + dy) === Tile.CorruptLand) corrupt++;
        }
      }
      expect(corrupt).toBeGreaterThan(3);
    }
  });

  it('wilderness monsters start far from the home village spawn', () => {
    for (const w of worlds) {
      const dist = reachableFrom(w);
      for (const e of w.enemySpawns) {
        // castle bandits are exempt (behind walls); wilderness beasts keep distance
        const inCastle =
          e.x >= w.castle.x && e.x < w.castle.x + w.castle.w &&
          e.y >= w.castle.y && e.y < w.castle.y + w.castle.h;
        if (!inCastle) expect(dist[e.y * w.w + e.x]).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe('chaos events', () => {
  it('cover tiers 1 through 4 in order', () => {
    expect(CHAOS_EVENTS.map((e) => e.tier)).toEqual([1, 2, 3, 4]);
  });

  it('tier 3 empties the far village and spawns corrupted attackers', () => {
    const world = generateWorld(42);
    const before = world.npcSpawns.filter((n) => n.village === 'far').length;
    expect(before).toBeGreaterThan(0);
    const spawns = CHAOS_EVENTS[2]!.apply(world, new Rng(1));
    expect(world.npcSpawns.filter((n) => n.village === 'far')).toHaveLength(0);
    expect(spawns.length).toBeGreaterThan(0);
    expect(spawns.every((s) => s.corrupted)).toBe(true);
  });

  it('events corrupt terrain around their targets', () => {
    const world = generateWorld(42);
    const countCorrupt = (): number => {
      let n = 0;
      for (let i = 0; i < world.tiles.length; i++) if (world.tiles[i] === Tile.CorruptLand) n++;
      return n;
    };
    const before = countCorrupt();
    CHAOS_EVENTS[0]!.apply(world, new Rng(2));
    const after1 = countCorrupt();
    expect(after1).toBeGreaterThan(before);
    CHAOS_EVENTS[3]!.apply(world, new Rng(3));
    expect(countCorrupt()).toBeGreaterThan(after1);
  });

  it('villageIntact tracks the fall of Ashford but not Thornvale', () => {
    expect(villageIntact('far', 2)).toBe(true);
    expect(villageIntact('far', 3)).toBe(false);
    expect(villageIntact('home', 4)).toBe(true);
  });
});
