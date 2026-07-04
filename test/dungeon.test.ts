import { describe, it, expect } from 'vitest';
import {
  generateFloor, bfsDistances, isFullyConnected, Tile, inRoom, roomCenter,
} from '../src/dungeon';
import type { FloorData } from '../src/dungeon';
import { KEY_FLOORS, FINAL_DEPTH, SPAWN_SAFE_DIST, ROOM_KEEP_MIN } from '../src/config';

const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 13);
const DEPTHS = Array.from({ length: FINAL_DEPTH }, (_, i) => i + 1);

function allFloors(): { floor: FloorData; seed: number; depth: number }[] {
  const out: { floor: FloorData; seed: number; depth: number }[] = [];
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      out.push({ floor: generateFloor(seed, depth), seed, depth });
    }
  }
  return out;
}

describe('generateFloor', () => {
  const floors = allFloors(); // 200 floor instances

  it('is deterministic for the same seed and depth', () => {
    const a = generateFloor(4242, 3);
    const b = generateFloor(4242, 3);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.enemySpawns).toEqual(b.enemySpawns);
    expect(a.itemSpawns).toEqual(b.itemSpawns);
  });

  it('every walkable tile is reachable from spawn (connectivity)', () => {
    for (const { floor, seed, depth } of floors) {
      expect(isFullyConnected(floor.tiles, floor.w, floor.h, floor.spawn), `seed=${seed} depth=${depth}`).toBe(true);
    }
  });

  it('keeps at least the minimum number of rooms', () => {
    for (const { floor } of floors) {
      expect(floor.rooms.length).toBeGreaterThanOrEqual(ROOM_KEEP_MIN);
    }
  });

  it('rooms never overlap', () => {
    for (const { floor } of floors) {
      for (let i = 0; i < floor.rooms.length; i++) {
        for (let j = i + 1; j < floor.rooms.length; j++) {
          const a = floor.rooms[i]!;
          const b = floor.rooms[j]!;
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('spawn tile is up-stairs; non-final floors have reachable down-stairs', () => {
    for (const { floor, seed, depth } of floors) {
      expect(floor.tiles[floor.spawn.y * floor.w + floor.spawn.x]).toBe(Tile.StairsUp);
      if (depth < FINAL_DEPTH) {
        expect(floor.downStairs, `seed=${seed} depth=${depth}`).not.toBeNull();
        const d = floor.downStairs!;
        expect(floor.tiles[d.y * floor.w + d.x]).toBe(Tile.StairsDown);
        const dist = bfsDistances(floor.tiles, floor.w, floor.h, floor.spawn, false);
        expect(dist[d.y * floor.w + d.x]).toBeGreaterThan(0);
      } else {
        expect(floor.downStairs).toBeNull();
        expect(floor.enemySpawns.some((e) => e.kind === 'boss')).toBe(true);
      }
    }
  });

  it('key floors: key reachable without the door, stairs gated until unlocked', () => {
    for (const { floor, seed, depth } of floors) {
      if (!KEY_FLOORS.includes(depth)) {
        expect(floor.doors.length).toBe(0);
        continue;
      }
      const label = `seed=${seed} depth=${depth}`;
      expect(floor.doors.length, label).toBeGreaterThan(0);
      expect(floor.keyPos, label).not.toBeNull();
      expect(floor.itemSpawns.some((s) => s.item === 'key'), label).toBe(true);

      const lockedDist = bfsDistances(floor.tiles, floor.w, floor.h, floor.spawn, true);
      // key reachable while locked
      expect(lockedDist[floor.keyPos!.y * floor.w + floor.keyPos!.x], label).toBeGreaterThanOrEqual(0);
      // stairs NOT reachable while locked
      const d = floor.downStairs!;
      expect(lockedDist[d.y * floor.w + d.x], label).toBe(-1);
      // stairs reachable once doors open
      const openDist = bfsDistances(floor.tiles, floor.w, floor.h, floor.spawn, false);
      expect(openDist[d.y * floor.w + d.x], label).toBeGreaterThan(0);
    }
  });

  it('enemies never spawn too close to the player spawn', () => {
    for (const { floor, seed, depth } of floors) {
      const dist = bfsDistances(floor.tiles, floor.w, floor.h, floor.spawn, false);
      for (const e of floor.enemySpawns) {
        if (e.kind === 'boss') continue;
        expect(dist[e.y * floor.w + e.x]!, `seed=${seed} depth=${depth}`).toBeGreaterThanOrEqual(SPAWN_SAFE_DIST);
      }
    }
  });

  it('enemy count scales with depth', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const shallow = generateFloor(seed, 1).enemySpawns.length;
      const deep = generateFloor(seed, 7).enemySpawns.length;
      expect(deep).toBeGreaterThan(shallow);
    }
  });

  it('all enemy and item spawns are on walkable tiles inside rooms', () => {
    for (const { floor } of floors) {
      for (const s of [...floor.enemySpawns, ...floor.itemSpawns]) {
        const t = floor.tiles[s.y * floor.w + s.x] as Tile;
        expect([Tile.Floor, Tile.StairsDown].includes(t)).toBe(true);
        expect(floor.rooms.some((r) => inRoom(r, s.x, s.y))).toBe(true);
      }
    }
  });

  it('weapon upgrades appear on schedule', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      expect(generateFloor(seed, 3).itemSpawns.some((s) => s.item === 'sword2')).toBe(true);
      expect(generateFloor(seed, 6).itemSpawns.some((s) => s.item === 'sword3')).toBe(true);
    }
  });

  it('friendly encounters appear on schedule in the Chaos Gate', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      expect(generateFloor(seed, 2).friendlySpawns.some((s) => s.kind === 'merchant')).toBe(true);
      expect(generateFloor(seed, 5).friendlySpawns.some((s) => s.kind === 'merchant')).toBe(true);
      expect(generateFloor(seed, 3).friendlySpawns.some((s) => s.kind === 'priest')).toBe(true);
      expect(generateFloor(seed, 6).friendlySpawns.some((s) => s.kind === 'priest')).toBe(true);
      // the boss floor offers no comforts
      expect(generateFloor(seed, FINAL_DEPTH).friendlySpawns).toHaveLength(0);
    }
  });

  it('side dungeons shelter a hermit on their middle floor', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const floor = generateFloor(seed, 2, { bossFloor: false, schedule: false });
      expect(floor.friendlySpawns.some((s) => s.kind === 'hermit')).toBe(true);
    }
  });

  it('no enemies spawn in a friendly NPC\'s room', () => {
    for (const { floor, seed, depth } of floors) {
      for (const f of floor.friendlySpawns) {
        const room = floor.rooms.find((r) => inRoom(r, f.x, f.y))!;
        expect(room, `friendly in a room seed=${seed} depth=${depth}`).toBeDefined();
        for (const e of floor.enemySpawns) {
          expect(inRoom(room, e.x, e.y), `enemy shares friendly room seed=${seed} depth=${depth}`).toBe(false);
        }
      }
    }
  });

  it('every floor scatters reachable gold piles', () => {
    for (const { floor, seed, depth } of floors) {
      expect(floor.goldSpawns.length, `seed=${seed} depth=${depth}`).toBeGreaterThanOrEqual(2);
      const dist = bfsDistances(floor.tiles, floor.w, floor.h, floor.spawn, false);
      for (const g of floor.goldSpawns) {
        expect(g.amount).toBeGreaterThan(0);
        expect(dist[g.y * floor.w + g.x]!, `gold reachable seed=${seed} depth=${depth}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('down-stairs sits far from spawn (max-distance room)', () => {
    for (const { floor, depth } of floors) {
      if (depth >= FINAL_DEPTH || !floor.downStairs) continue;
      const dist = bfsDistances(floor.tiles, floor.w, floor.h, floor.spawn, false);
      const stairsDist = dist[floor.downStairs.y * floor.w + floor.downStairs.x]!;
      // must be at least as far as the median room center
      const roomDists = floor.rooms
        .map((r) => dist[roomCenter(r).y * floor.w + roomCenter(r).x]!)
        .filter((d) => d >= 0)
        .sort((a, b) => a - b);
      const median = roomDists[Math.floor(roomDists.length / 2)]!;
      expect(stairsDist).toBeGreaterThanOrEqual(median);
    }
  });
});
