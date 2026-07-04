// The overworld: an ADOM-style wilderness with villages, a castle, and dungeon
// entrances, generated deterministically from the run seed. Chaos events mutate
// it as corruption crosses thresholds. generateWorld(seed) is pure and testable.

import { WORLD_W, WORLD_H } from './config';
import { Rng } from './rng';
import { Tile, bfsDistances, isPassable, type FloorData, type Pt, type Room } from './dungeon';
import type { ItemId } from './items';

export interface Village {
  name: string;
  bounds: Room;
  shrine: Pt;
  healer: Pt;
}

export type WorldNpcKind = 'villager' | 'merchant' | 'questgiver';

export interface NpcSpawn extends Pt {
  village: 'home' | 'far' | 'castle';
  kind: WorldNpcKind;
  line: string;
}

export interface WorldData extends FloorData {
  gate: Pt; // Chaos Gate entrance
  barrow: Pt; // Haunted Barrow entrance
  mine: Pt; // Old Mine entrance
  castle: Room;
  homeVillage: Village;
  farVillage: Village;
  npcSpawns: NpcSpawn[];
}

export const HOME_LINES = [
  'The Gate glows brighter every night...',
  'The elder says only you can seal it.',
  'Take bread for the road, hero.',
  'My cousin in Ashford has gone quiet.',
  'Pray at the shrine before you go.',
];

export const FAR_LINES = [
  'The mine folk dug too deep, they say.',
  'Chaos beasts prowl the old barrow.',
  'You look pale, friend. See our healer.',
  'The castle lord fled. Bandits hold it now.',
];

const idx = (x: number, y: number): number => y * WORLD_W + x;

function fillRect(tiles: Uint8Array, x: number, y: number, w: number, h: number, t: Tile): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= WORLD_W || yy >= WORLD_H) continue;
      tiles[idx(xx, yy)] = t;
    }
  }
}

/** Random-walk terrain blob (forest patches, lakes, mountain clusters). */
function blob(rng: Rng, tiles: Uint8Array, cx: number, cy: number, size: number, t: Tile, over: Tile[]): void {
  let x = cx;
  let y = cy;
  for (let i = 0; i < size; i++) {
    if (x >= 1 && y >= 1 && x < WORLD_W - 1 && y < WORLD_H - 1) {
      if (over.includes(tiles[idx(x, y)] as Tile)) tiles[idx(x, y)] = t;
      // thicken: also paint one neighbor
      const nx = x + rng.int(-1, 1);
      const ny = y + rng.int(-1, 1);
      if (nx >= 1 && ny >= 1 && nx < WORLD_W - 1 && ny < WORLD_H - 1 && over.includes(tiles[idx(nx, ny)] as Tile)) {
        tiles[idx(nx, ny)] = t;
      }
    }
    x = Math.max(1, Math.min(WORLD_W - 2, x + rng.int(-1, 1)));
    y = Math.max(1, Math.min(WORLD_H - 2, y + rng.int(-1, 1)));
  }
}

/** Carve an L-shaped road; bulldozes forest/water/mountain (fords and passes). */
function carveRoad(rng: Rng, tiles: Uint8Array, a: Pt, b: Pt): void {
  const put = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x >= WORLD_W - 1 || y >= WORLD_H - 1) return;
    const t = tiles[idx(x, y)] as Tile;
    if (t === Tile.Grass || t === Tile.Forest || t === Tile.Water || t === Tile.Mountain) {
      tiles[idx(x, y)] = Tile.Road;
    }
  };
  if (rng.chance(0.5)) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) put(x, a.y);
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) put(b.x, y);
  } else {
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) put(a.x, y);
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) put(x, b.y);
  }
}

/** Stamp a village: cleared ground, huts, a shrine and a healer. */
function stampVillage(rng: Rng, tiles: Uint8Array, bounds: Room): { shrine: Pt; healer: Pt } {
  fillRect(tiles, bounds.x - 1, bounds.y - 1, bounds.w + 2, bounds.h + 2, Tile.Grass);
  // huts in the corners of the village plot
  const hutSpots: Pt[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w - 6, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.h - 5 },
    { x: bounds.x + bounds.w - 6, y: bounds.y + bounds.h - 5 },
  ];
  const hutCount = rng.int(3, 4);
  for (let i = 0; i < hutCount; i++) {
    const s = hutSpots[i]!;
    fillRect(tiles, s.x, s.y, 6, 5, Tile.HutWall);
    fillRect(tiles, s.x + 1, s.y + 1, 4, 3, Tile.HutFloor);
    // door gap facing the village center
    const doorX = s.x + (s.x < bounds.x + bounds.w / 2 ? 5 : 0);
    tiles[idx(doorX, s.y + 2)] = Tile.HutFloor;
  }
  // shrine and healer flank the village square
  const cx = Math.floor(bounds.x + bounds.w / 2);
  const cy = Math.floor(bounds.y + bounds.h / 2);
  const shrine = { x: cx - 2, y: cy };
  const healer = { x: cx + 2, y: cy };
  tiles[idx(shrine.x, shrine.y)] = Tile.Shrine;
  tiles[idx(healer.x, healer.y)] = Tile.Healer;
  return { shrine, healer };
}

/** Stamp the bandit castle: stone walls, a gate gap, loot inside. */
function stampCastle(tiles: Uint8Array, bounds: Room): void {
  fillRect(tiles, bounds.x - 1, bounds.y - 1, bounds.w + 2, bounds.h + 2, Tile.Grass);
  fillRect(tiles, bounds.x, bounds.y, bounds.w, bounds.h, Tile.Wall);
  fillRect(tiles, bounds.x + 1, bounds.y + 1, bounds.w - 2, bounds.h - 2, Tile.Floor);
  // gate gap at the south wall center
  const gx = Math.floor(bounds.x + bounds.w / 2);
  tiles[idx(gx, bounds.y + bounds.h - 1)] = Tile.Floor;
  // inner keep corner
  fillRect(tiles, bounds.x + 2, bounds.y + 2, 5, 4, Tile.Wall);
  fillRect(tiles, bounds.x + 3, bounds.y + 3, 3, 2, Tile.Floor);
  tiles[idx(bounds.x + 6, bounds.y + 4)] = Tile.Floor; // keep doorway
}

function clearGround(tiles: Uint8Array, p: Pt, radius: number): void {
  fillRect(tiles, p.x - radius, p.y - radius, radius * 2 + 1, radius * 2 + 1, Tile.Grass);
}

export function generateWorld(seed: number): WorldData {
  const master = new Rng((seed ^ 0x517cc1b7) >>> 0);
  for (let attempt = 0; attempt < 50; attempt++) {
    const world = tryGenerateWorld(master.subSeed());
    if (world) return world;
  }
  throw new Error(`world generation failed for seed=${seed}`);
}

function tryGenerateWorld(seed: number): WorldData | null {
  const rng = new Rng(seed);
  const w = WORLD_W;
  const h = WORLD_H;
  const tiles = new Uint8Array(w * h).fill(Tile.Grass);

  // 1. Terrain: mountain border, forests, lakes, inner ridges
  for (let x = 0; x < w; x++) {
    tiles[idx(x, 0)] = Tile.Mountain;
    tiles[idx(x, h - 1)] = Tile.Mountain;
  }
  for (let y = 0; y < h; y++) {
    tiles[idx(0, y)] = Tile.Mountain;
    tiles[idx(w - 1, y)] = Tile.Mountain;
  }
  for (let i = 0; i < 14; i++) {
    blob(rng, tiles, rng.int(4, w - 5), rng.int(4, h - 5), rng.int(40, 120), Tile.Forest, [Tile.Grass]);
  }
  for (let i = 0; i < 3; i++) {
    blob(rng, tiles, rng.int(10, w - 11), rng.int(10, h - 11), rng.int(30, 70), Tile.Water, [Tile.Grass, Tile.Forest]);
  }
  for (let i = 0; i < 4; i++) {
    blob(rng, tiles, rng.int(6, w - 7), rng.int(6, h - 7), rng.int(20, 50), Tile.Mountain, [Tile.Grass, Tile.Forest]);
  }

  // 2. Points of interest, one per region so they spread out
  const homeBounds: Room = { x: rng.int(6, 16), y: rng.int(h - 26, h - 16), w: 16, h: 12 };
  const farBounds: Room = { x: rng.int(w - 30, w - 22), y: rng.int(6, 16), w: 16, h: 12 };
  const castle: Room = { x: rng.int(8, 18), y: rng.int(8, 16), w: 14, h: 10 };
  const gate: Pt = { x: rng.int(w - 18, w - 8), y: rng.int(h - 20, h - 10) };
  const barrow: Pt = { x: rng.int(Math.floor(w / 2) - 8, Math.floor(w / 2) + 8), y: rng.int(8, 18) };
  const mine: Pt = { x: rng.int(Math.floor(w / 2) - 10, Math.floor(w / 2) + 6), y: rng.int(h - 22, h - 10) };

  // entrances need breathing room
  clearGround(tiles, gate, 2);
  clearGround(tiles, barrow, 2);
  clearGround(tiles, mine, 2);

  const home = stampVillage(rng, tiles, homeBounds);
  const far = stampVillage(rng, tiles, farBounds);
  stampCastle(tiles, castle);

  // 3. Roads from the home village square outward
  const homeCenter = { x: Math.floor(homeBounds.x + homeBounds.w / 2), y: Math.floor(homeBounds.y + homeBounds.h / 2) };
  const farCenter = { x: Math.floor(farBounds.x + farBounds.w / 2), y: Math.floor(farBounds.y + farBounds.h / 2) };
  const castleGate = { x: Math.floor(castle.x + castle.w / 2), y: castle.y + castle.h };
  carveRoad(rng, tiles, { x: homeCenter.x + 1, y: homeCenter.y }, gate);
  carveRoad(rng, tiles, { x: homeCenter.x, y: homeCenter.y - 1 }, farCenter);
  carveRoad(rng, tiles, { x: homeCenter.x - 1, y: homeCenter.y }, castleGate);
  carveRoad(rng, tiles, farCenter, barrow);

  // 4. Entrances (after roads so they are never paved over)
  tiles[idx(gate.x, gate.y)] = Tile.GateEntrance;
  tiles[idx(barrow.x, barrow.y)] = Tile.CaveEntrance;
  tiles[idx(mine.x, mine.y)] = Tile.MineEntrance;
  // shrine/healer survived roads? (roads only replace terrain, but be safe)
  tiles[idx(home.shrine.x, home.shrine.y)] = Tile.Shrine;
  tiles[idx(home.healer.x, home.healer.y)] = Tile.Healer;
  tiles[idx(far.shrine.x, far.shrine.y)] = Tile.Shrine;
  tiles[idx(far.healer.x, far.healer.y)] = Tile.Healer;
  // foreboding chaos ring around the Gate
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = gate.x + dx;
      const y = gate.y + dy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      if (Math.abs(dx) + Math.abs(dy) > 3) continue;
      const t = tiles[idx(x, y)] as Tile;
      if (t === Tile.Grass || t === Tile.Forest) tiles[idx(x, y)] = Tile.CorruptLand;
    }
  }

  // 5. Player spawn: home village square
  const spawn: Pt = { x: homeCenter.x, y: homeCenter.y + 2 };
  tiles[idx(spawn.x, spawn.y)] = Tile.Grass;

  // 6. Validate: every POI reachable from the spawn
  const dist = bfsDistances(tiles, w, h, spawn, false);
  const reachable = (p: Pt): boolean => dist[idx(p.x, p.y)]! >= 0;
  const adjacentReachable = (p: Pt): boolean =>
    [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].some((d) => {
      const x = p.x + d.x;
      const y = p.y + d.y;
      return x >= 0 && y >= 0 && x < w && y < h && dist[idx(x, y)]! >= 0;
    });
  const castleInside = { x: Math.floor(castle.x + castle.w / 2), y: Math.floor(castle.y + castle.h / 2) };
  if (!reachable(gate) || !reachable(barrow) || !reachable(mine)) return null;
  if (!reachable(castleInside)) return null;
  if (!adjacentReachable(home.shrine) || !adjacentReachable(home.healer)) return null;
  if (!adjacentReachable(far.shrine) || !adjacentReachable(far.healer)) return null;

  // 7. Villagers, merchants, and the quest captain
  const npcSpawns: NpcSpawn[] = [];
  const placeNpc = (
    bounds: Room, village: 'home' | 'far' | 'castle', kind: WorldNpcKind, line: string,
  ): boolean => {
    for (let tries = 0; tries < 40; tries++) {
      const x = rng.int(bounds.x, bounds.x + bounds.w - 1);
      const y = rng.int(bounds.y, bounds.y + bounds.h - 1);
      if (isPassable(tiles[idx(x, y)] as Tile, false) && dist[idx(x, y)]! >= 0) {
        npcSpawns.push({ x, y, village, kind, line });
        return true;
      }
    }
    return false;
  };
  const placeNpcs = (bounds: Room, village: 'home' | 'far', lines: string[], count: number): void => {
    for (let i = 0; i < count; i++) placeNpc(bounds, village, 'villager', lines[i % lines.length]!);
  };
  placeNpcs(homeBounds, 'home', rng.shuffle([...HOME_LINES]), 4);
  placeNpcs(farBounds, 'far', rng.shuffle([...FAR_LINES]), 3);
  // every village keeps a merchant; the home village hosts Captain Aldric
  if (!placeNpc(homeBounds, 'home', 'merchant', 'Fine wares for a doomed land.')) return null;
  if (!placeNpc(farBounds, 'far', 'merchant', 'Buy now. Coin spends poorly in graves.')) return null;
  if (!placeNpc(homeBounds, 'home', 'questgiver', 'The land bleeds. Help us cull the beasts.')) return null;
  // the bandits' captive trader, deep inside the castle keep
  const keepRoom: Room = { x: castle.x + 3, y: castle.y + 3, w: 3, h: 2 };
  placeNpc(keepRoom, 'castle', 'merchant', 'They took my cart. My stock, though...');

  // 8. Wilderness monsters + castle bandits and their loot
  const enemySpawns: WorldData['enemySpawns'] = [];
  for (let i = 0; i < 6; i++) {
    for (let tries = 0; tries < 40; tries++) {
      const x = rng.int(2, w - 3);
      const y = rng.int(2, h - 3);
      const d = dist[idx(x, y)]!;
      if (d >= 20 && isPassable(tiles[idx(x, y)] as Tile, false)) {
        enemySpawns.push({ kind: rng.chance(0.6) ? 'chaser' : 'bat', x, y });
        break;
      }
    }
  }
  const itemSpawns: WorldData['itemSpawns'] = [];
  const goldSpawns: WorldData['goldSpawns'] = [];
  const castleLoot: ItemId[] = ['sword2', 'elixir', 'arrows', 'arrows', 'bomb', 'healPotion'];
  let lootI = 0;
  for (const item of castleLoot) {
    const x = castle.x + 2 + (lootI % Math.max(1, castle.w - 4));
    const y = castle.y + castle.h - 3 - Math.floor(lootI / Math.max(1, castle.w - 4));
    if (isPassable(tiles[idx(x, y)] as Tile, false)) itemSpawns.push({ item, x, y });
    lootI += 2;
  }
  // the bandits' plundered gold, piled beside their loot
  for (let i = 0; i < 3; i++) {
    const x = castle.x + 2 + ((i * 2 + 1) % Math.max(1, castle.w - 4));
    const y = castle.y + castle.h - 2;
    if (isPassable(tiles[idx(x, y)] as Tile, false)) {
      goldSpawns.push({ x, y, amount: rng.int(15, 30) });
    }
  }
  // bandit garrison
  for (let i = 0; i < 4; i++) {
    const x = castle.x + 2 + ((i * 3) % (castle.w - 4));
    const y = castle.y + 2 + (i % (castle.h - 4));
    if (isPassable(tiles[idx(x, y)] as Tile, false)) {
      enemySpawns.push({ kind: i % 2 === 0 ? 'chaser' : 'archer', x, y });
    }
  }

  return {
    tiles, w, h, depth: 0, rooms: [], spawn,
    downStairs: null, doors: [], keyPos: null,
    enemySpawns, itemSpawns, goldSpawns, friendlySpawns: [],
    gate, barrow, mine, castle,
    homeVillage: { name: 'Thornvale', bounds: homeBounds, shrine: home.shrine, healer: home.healer },
    farVillage: { name: 'Ashford', bounds: farBounds, shrine: far.shrine, healer: far.healer },
    npcSpawns,
  };
}

// --- Chaos events: the world decays as corruption crosses thresholds ---

export interface ChaosEvent {
  tier: number;
  message: string;
  /** Mutates the world map. Returns extra enemy spawns to add if the world is live. */
  apply(world: WorldData, rng: Rng): { kind: 'chaser' | 'archer' | 'bat'; corrupted: boolean; x: number; y: number }[];
}

/** Convert grass/forest/road near a point into chaos-touched land. */
function corruptArea(world: WorldData, center: Pt, radius: number, rng: Rng): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 1 || y < 1 || x >= world.w - 1 || y >= world.h - 1) continue;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (!rng.chance(0.75)) continue;
      const t = world.tiles[idx(x, y)] as Tile;
      if (t === Tile.Grass || t === Tile.Forest || t === Tile.Road || t === Tile.HutFloor) {
        world.tiles[idx(x, y)] = Tile.CorruptLand;
      }
    }
  }
}

function villageCenter(v: Village): Pt {
  return { x: Math.floor(v.bounds.x + v.bounds.w / 2), y: Math.floor(v.bounds.y + v.bounds.h / 2) };
}

export const CHAOS_EVENTS: ChaosEvent[] = [
  {
    tier: 1,
    message: 'A bruise-colored glow rises over the Chaos Gate.',
    apply(world, rng) {
      corruptArea(world, world.gate, 7, rng);
      return [];
    },
  },
  {
    tier: 2,
    message: 'Chaos beasts prowl the wilderness. Travel wary.',
    apply(world, rng) {
      corruptArea(world, world.gate, 13, rng);
      corruptArea(world, world.mine, 5, rng);
      return [];
    },
  },
  {
    tier: 3,
    message: 'Ashford has gone silent. The chaos took it.',
    apply(world, rng) {
      const v = world.farVillage;
      corruptArea(world, villageCenter(v), 10, rng);
      // the village's blessings die with it
      world.npcSpawns = world.npcSpawns.filter((n) => n.village !== 'far');
      const c = villageCenter(v);
      const spawns: ReturnType<ChaosEvent['apply']> = [];
      for (let i = 0; i < 3; i++) {
        spawns.push({ kind: i === 2 ? 'archer' : 'chaser', corrupted: true, x: c.x - 2 + i * 2, y: c.y + 1 });
      }
      return spawns;
    },
  },
  {
    tier: 4,
    message: 'Chaos storms scour the land. THORNVALE IS UNDER ATTACK!',
    apply(world, rng) {
      corruptArea(world, world.gate, 22, rng);
      const v = world.homeVillage;
      corruptArea(world, villageCenter(v), 6, rng);
      const c = villageCenter(v);
      const spawns: ReturnType<ChaosEvent['apply']> = [];
      for (let i = 0; i < 4; i++) {
        spawns.push({
          kind: i % 2 === 0 ? 'chaser' : 'bat',
          corrupted: true,
          x: v.bounds.x - 2 + (i % 2) * (v.bounds.w + 4),
          y: c.y - 1 + i,
        });
      }
      return spawns;
    },
  },
];

/** Whether a village's shrine/healer still function (dead once its tier event hit). */
export function villageIntact(village: 'home' | 'far', tierReached: number): boolean {
  if (village === 'far') return tierReached < 3;
  return true; // Thornvale is attacked but its folk hold the square
}
