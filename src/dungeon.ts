// Procedural floor generation: rooms + L-corridors, ADOM flavor.
// generateFloor(seed, depth) is pure and deterministic — fully unit-testable.

import {
  MAP_W, MAP_H, FINAL_DEPTH, ROOM_ATTEMPTS, ROOM_MIN, ROOM_MAX,
  ROOM_KEEP_MIN, ROOM_KEEP_MAX, KEY_FLOORS, SPAWN_SAFE_DIST,
  ENEMY_BASE_COUNT, ENEMY_PER_DEPTH,
} from './config';
import { Rng } from './rng';
import type { ItemId } from './items';
import { goldPileFor, type FriendlyKind } from './friendly';

export enum Tile {
  Wall = 0,
  Floor = 1,
  DoorLocked = 2,
  StairsDown = 3,
  StairsUp = 4,
  Rubble = 5,
  CorruptFloor = 6, // visual variant, walkable
  // Overworld terrain
  Grass = 7,
  Forest = 8, // walkable, does not block sight
  Water = 9, // solid
  Mountain = 10, // solid, blocks sight
  Road = 11,
  CorruptLand = 12, // walkable, chaos-touched terrain
  // Overworld structures
  HutWall = 13, // solid, blocks sight
  HutFloor = 14,
  Shrine = 15, // solid; interact while adjacent to pray
  Healer = 16, // solid; interact while adjacent to be healed
  GateEntrance = 17, // step on to enter the Chaos Gate
  CaveEntrance = 18, // the Haunted Barrow
  MineEntrance = 19, // the Old Mine
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EnemyKind = 'chaser' | 'archer' | 'bat' | 'boss';

export interface Pt {
  x: number;
  y: number;
}

export interface FloorData {
  tiles: Uint8Array;
  w: number;
  h: number;
  depth: number;
  rooms: Room[];
  spawn: Pt; // tile coords of up-stairs / player start
  downStairs: Pt | null; // null on the boss floor
  doors: Pt[];
  keyPos: Pt | null;
  enemySpawns: { kind: EnemyKind; x: number; y: number }[];
  itemSpawns: { item: ItemId; x: number; y: number }[];
  goldSpawns: { x: number; y: number; amount: number }[];
  friendlySpawns: { kind: FriendlyKind; x: number; y: number }[];
}

export function roomCenter(r: Room): Pt {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

export function inRoom(r: Room, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

const SOLID_TILES = new Set<Tile>([
  Tile.Wall, Tile.DoorLocked, Tile.Rubble,
  Tile.Water, Tile.Mountain, Tile.HutWall, Tile.Shrine, Tile.Healer,
]);

const SIGHT_BLOCKING_TILES = new Set<Tile>([
  Tile.Wall, Tile.DoorLocked, Tile.Rubble, Tile.Mountain, Tile.HutWall,
]);

/** Solid for movement. Locked doors and rubble block until removed. */
export function isSolid(t: Tile): boolean {
  return SOLID_TILES.has(t);
}

/** Walkable for connectivity checks; doorsSolid treats locked doors as walls. */
export function isPassable(t: Tile, doorsSolid: boolean): boolean {
  if (t === Tile.DoorLocked) return !doorsSolid;
  return !SOLID_TILES.has(t);
}

/**
 * BFS from start; returns per-tile step distance (-1 = unreachable).
 * Exported for tests and for spawn-distance logic.
 */
export function bfsDistances(tiles: Uint8Array, w: number, h: number, start: Pt, doorsSolid = false): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  const queue: number[] = [start.y * w + start.x];
  dist[start.y * w + start.x] = 0;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const x = i % w;
    const y = Math.floor(i / w);
    const d = dist[i]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1) continue;
      if (!isPassable(tiles[ni] as Tile, doorsSolid)) continue;
      dist[ni] = d + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/** True if every passable tile is reachable from start. */
export function isFullyConnected(tiles: Uint8Array, w: number, h: number, start: Pt): boolean {
  const dist = bfsDistances(tiles, w, h, start, false);
  for (let i = 0; i < tiles.length; i++) {
    if (isPassable(tiles[i] as Tile, false) && dist[i] === -1) return false;
  }
  return true;
}

/** Bresenham line-of-sight between tile coords; walls, doors and rubble block sight. */
export function hasLineOfSight(
  tiles: Uint8Array, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
): boolean {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (x !== x1 || y !== y1) {
    if (x !== x0 || y !== y0) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      if (SIGHT_BLOCKING_TILES.has(tiles[y * w + x] as Tile)) return false;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return true;
}

function carveRoom(tiles: Uint8Array, w: number, r: Room): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      tiles[y * w + x] = Tile.Floor;
    }
  }
}

function carveCorridor(tiles: Uint8Array, w: number, a: Pt, b: Pt, horizontalFirst: boolean): void {
  const carve = (x: number, y: number) => {
    if (tiles[y * w + x] === Tile.Wall) tiles[y * w + x] = Tile.Floor;
  };
  if (horizontalFirst) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) carve(x, a.y);
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) carve(b.x, y);
  } else {
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) carve(a.x, y);
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) carve(x, b.y);
  }
}

function overlapsWithMargin(r: Room, rooms: Room[]): boolean {
  for (const o of rooms) {
    if (
      r.x - 1 < o.x + o.w + 1 && r.x + r.w + 1 > o.x - 1 &&
      r.y - 1 < o.y + o.h + 1 && r.y + r.h + 1 > o.y - 1
    ) return true;
  }
  return false;
}

/** All walkable tiles orthogonally adjacent to the room but outside it (its entrances). */
function roomEntrances(tiles: Uint8Array, w: number, h: number, room: Room): Pt[] {
  const out: Pt[] = [];
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (inRoom(room, x, y)) continue;
      if (!isPassable(tiles[y * w + x] as Tile, false)) continue;
      // must touch a tile inside the room
      const touches =
        (inRoom(room, x + 1, y)) || (inRoom(room, x - 1, y)) ||
        (inRoom(room, x, y + 1)) || (inRoom(room, x, y - 1));
      if (touches) out.push({ x, y });
    }
  }
  return out;
}

/** Random floor tile inside a room, avoiding taken positions. */
function randomRoomTile(rng: Rng, room: Room, taken: Set<number>, w: number, tiles: Uint8Array): Pt | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = rng.int(room.x, room.x + room.w - 1);
    const y = rng.int(room.y, room.y + room.h - 1);
    const i = y * w + x;
    if (taken.has(i)) continue;
    if (tiles[i] !== Tile.Floor) continue;
    taken.add(i);
    return { x, y };
  }
  return null;
}

function enemyWeights(depth: number): { kinds: EnemyKind[]; weights: number[] } {
  const kinds: EnemyKind[] = ['chaser'];
  const weights: number[] = [6];
  if (depth >= 2) {
    kinds.push('archer');
    weights.push(1.5 + depth * 0.5);
    kinds.push('bat');
    weights.push(1 + depth * 0.35);
  }
  return { kinds, weights };
}

export interface FloorOpts {
  /** Place the boss on this floor. Default: depth >= FINAL_DEPTH (the Chaos Gate). */
  bossFloor?: boolean;
  /** No stairs down (dungeon bottom) even without a boss. Default: same as boss floor. */
  lastFloor?: boolean;
  /** Use the main-dungeon fixed loot schedule (tomes, swords, bow). Default true. */
  schedule?: boolean;
  /** Extra guaranteed loot dropped in the far room (side-dungeon treasure). */
  extraLoot?: ItemId[];
}

export function generateFloor(seed: number, depth: number, opts: FloorOpts = {}): FloorData {
  // Regenerate with derived sub-seeds until valid (validation failures are rare).
  const master = new Rng((seed ^ (depth * 0x9e3779b9)) >>> 0);
  for (let attempt = 0; attempt < 50; attempt++) {
    const floor = tryGenerate(master.subSeed(), depth, opts);
    if (floor) return floor;
  }
  throw new Error(`floor generation failed for seed=${seed} depth=${depth}`);
}

function tryGenerate(seed: number, depth: number, opts: FloorOpts): FloorData | null {
  const rng = new Rng(seed);
  const w = MAP_W;
  const h = MAP_H;
  const tiles = new Uint8Array(w * h).fill(Tile.Wall);

  // 1. Place rooms
  const rooms: Room[] = [];
  const maxRooms = rng.int(ROOM_KEEP_MIN, ROOM_KEEP_MAX);
  for (let i = 0; i < ROOM_ATTEMPTS && rooms.length < maxRooms; i++) {
    const rw = rng.int(ROOM_MIN, ROOM_MAX);
    const rh = rng.int(ROOM_MIN, ROOM_MAX);
    const rx = rng.int(1, w - rw - 2);
    const ry = rng.int(1, h - rh - 2);
    const room = { x: rx, y: ry, w: rw, h: rh };
    if (!overlapsWithMargin(room, rooms)) rooms.push(room);
  }
  if (rooms.length < ROOM_KEEP_MIN) return null;
  for (const r of rooms) carveRoom(tiles, w, r);

  // 2. Connect: path through rooms sorted by center-x, plus 1-2 loop chords
  const sorted = [...rooms].sort((a, b) => roomCenter(a).x - roomCenter(b).x);
  for (let i = 0; i < sorted.length - 1; i++) {
    carveCorridor(tiles, w, roomCenter(sorted[i]!), roomCenter(sorted[i + 1]!), rng.chance(0.5));
  }
  const chords = rng.int(1, 2);
  for (let i = 0; i < chords; i++) {
    const a = rng.pick(rooms);
    const b = rng.pick(rooms);
    if (a !== b) carveCorridor(tiles, w, roomCenter(a), roomCenter(b), rng.chance(0.5));
  }

  // 3. Spawn room: nearest to a random map edge; up-stairs at its center
  const edgeTarget: Pt = rng.pick([
    { x: 0, y: Math.floor(h / 2) },
    { x: w - 1, y: Math.floor(h / 2) },
    { x: Math.floor(w / 2), y: 0 },
    { x: Math.floor(w / 2), y: h - 1 },
  ]);
  let spawnRoom = rooms[0]!;
  let bestEdgeDist = Infinity;
  for (const r of rooms) {
    const c = roomCenter(r);
    const d = Math.abs(c.x - edgeTarget.x) + Math.abs(c.y - edgeTarget.y);
    if (d < bestEdgeDist) {
      bestEdgeDist = d;
      spawnRoom = r;
    }
  }
  const spawn = roomCenter(spawnRoom);

  // 4. Connectivity check (before placements that depend on BFS)
  if (!isFullyConnected(tiles, w, h, spawn)) return null;
  const dist = bfsDistances(tiles, w, h, spawn, false);

  // 5. Stairs room: max BFS distance from spawn
  let stairsRoom: Room | null = null;
  let bestDist = -1;
  for (const r of rooms) {
    if (r === spawnRoom) continue;
    const c = roomCenter(r);
    const d = dist[c.y * w + c.x]!;
    if (d > bestDist) {
      bestDist = d;
      stairsRoom = r;
    }
  }
  if (!stairsRoom) return null;

  const isBossFloor = opts.bossFloor ?? depth >= FINAL_DEPTH;
  const isLastFloor = opts.lastFloor ?? isBossFloor;
  // Boss floor: fight happens in the largest room instead of descending further
  if (isBossFloor) {
    let biggest = rooms[0]!;
    for (const r of rooms) {
      if (r !== spawnRoom && r.w * r.h > biggest.w * biggest.h) biggest = r;
    }
    if (biggest !== spawnRoom) stairsRoom = biggest;
  }

  const stairsCenter = roomCenter(stairsRoom);
  const taken = new Set<number>([spawn.y * w + spawn.x, stairsCenter.y * w + stairsCenter.x]);
  tiles[spawn.y * w + spawn.x] = Tile.StairsUp;
  let downStairs: Pt | null = null;
  if (!isLastFloor) {
    downStairs = stairsCenter;
    tiles[stairsCenter.y * w + stairsCenter.x] = Tile.StairsDown;
  }

  // 6. Locked door + key on designated floors
  const doors: Pt[] = [];
  let keyPos: Pt | null = null;
  if (KEY_FLOORS.includes(depth)) {
    const entrances = roomEntrances(tiles, w, h, stairsRoom);
    if (entrances.length === 0 || entrances.length > 4) return null; // degenerate layout
    for (const e of entrances) {
      tiles[e.y * w + e.x] = Tile.DoorLocked;
      doors.push(e);
    }
    // Key must be reachable with doors treated as solid, outside the stairs room
    const lockedDist = bfsDistances(tiles, w, h, spawn, true);
    // stairs must NOT be reachable while locked
    if (lockedDist[stairsCenter.y * w + stairsCenter.x] !== -1) return null;
    const keyRooms = rooms.filter((r) => {
      if (r === stairsRoom) return false;
      const c = roomCenter(r);
      return lockedDist[c.y * w + c.x]! >= 0;
    });
    if (keyRooms.length === 0) return null;
    // Prefer a far-away room for the key so the floor must be explored
    keyRooms.sort((a, b) => lockedDist[roomCenter(b).y * w + roomCenter(b).x]! - lockedDist[roomCenter(a).y * w + roomCenter(a).x]!);
    const keyRoom = keyRooms[rng.int(0, Math.min(1, keyRooms.length - 1))]!;
    keyPos = randomRoomTile(rng, keyRoom, taken, w, tiles);
    if (!keyPos) return null;
    // Double-check the exact key tile is reachable while locked
    if (lockedDist[keyPos.y * w + keyPos.x] === -1) return null;
  }

  // 7. Rubble decor (solid, bombable) — sparse, then verify it broke nothing
  for (const r of rooms) {
    if (r.w < 5 || r.h < 5) continue;
    const count = rng.int(0, 2);
    for (let i = 0; i < count; i++) {
      const x = rng.int(r.x + 1, r.x + r.w - 2);
      const y = rng.int(r.y + 1, r.y + r.h - 2);
      const idx = y * w + x;
      if (tiles[idx] === Tile.Floor && !taken.has(idx)) tiles[idx] = Tile.Rubble;
    }
  }
  if (!isFullyConnected(tiles, w, h, spawn)) {
    // rubble pinched something off — strip it all rather than regenerate
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === Tile.Rubble) tiles[i] = Tile.Floor;
    }
  }

  // 8. Friendly encounters: trapped merchants, priests, hermits get their own
  // safe rooms (no enemies spawn there) so meeting them is a breather.
  const friendlySpawns: FloorData['friendlySpawns'] = [];
  const friendlyRooms = new Set<Room>();
  const placeFriendly = (kind: FriendlyKind): void => {
    const candidates = rooms.filter(
      (r) => r !== spawnRoom && r !== stairsRoom && !friendlyRooms.has(r),
    );
    if (candidates.length === 0) return;
    const room = rng.pick(candidates);
    const pos = randomRoomTile(rng, room, taken, w, tiles);
    if (pos) {
      friendlySpawns.push({ kind, x: pos.x, y: pos.y });
      friendlyRooms.add(room);
    }
  };
  if (opts.schedule ?? true) {
    // the Chaos Gate: scheduled encounters on the long crawl down
    if (depth === 2 || depth === 5) placeFriendly('merchant');
    if (depth === 3 || depth === 6) placeFriendly('priest');
    if (!isBossFloor && rng.chance(0.35)) placeFriendly('hermit');
  } else {
    // side caves: a hermit midway, sometimes a trader by the treasure
    if (depth === 2) placeFriendly('hermit');
    if (isLastFloor && rng.chance(0.5)) placeFriendly('merchant');
  }

  // 9. Enemies: only in rooms far enough from spawn, never in friendly rooms
  const enemySpawns: FloorData['enemySpawns'] = [];
  const { kinds, weights } = enemyWeights(depth);
  const enemyCount = isBossFloor ? 4 : ENEMY_BASE_COUNT + ENEMY_PER_DEPTH * depth;
  const farRooms = rooms.filter((r) => {
    if (r === spawnRoom || friendlyRooms.has(r)) return false;
    const c = roomCenter(r);
    return dist[c.y * w + c.x]! >= SPAWN_SAFE_DIST;
  });
  if (farRooms.length === 0) return null;
  for (let i = 0; i < enemyCount; i++) {
    // room centers are far, but a random tile inside can still be close — verify the tile
    for (let retry = 0; retry < 8; retry++) {
      const room = rng.pick(farRooms);
      const pos = randomRoomTile(rng, room, taken, w, tiles);
      if (pos && dist[pos.y * w + pos.x]! >= SPAWN_SAFE_DIST) {
        enemySpawns.push({ kind: rng.weighted(kinds, weights), x: pos.x, y: pos.y });
        break;
      }
    }
  }
  if (isBossFloor) {
    enemySpawns.push({ kind: 'boss', x: stairsCenter.x, y: stairsCenter.y });
  }

  // 10. Items
  const itemSpawns: FloorData['itemSpawns'] = [];
  const dropRooms = rooms.filter((r) => r !== spawnRoom);
  const placeItem = (item: ItemId): void => {
    const room = rng.pick(dropRooms.length > 0 ? dropRooms : rooms);
    const pos = randomRoomTile(rng, room, taken, w, tiles);
    if (pos) itemSpawns.push({ item, x: pos.x, y: pos.y });
  };
  const healCount = rng.int(1, 2);
  for (let i = 0; i < healCount; i++) placeItem('healPotion');
  if (depth >= 2 && rng.chance(0.65)) placeItem('purityPotion');
  if (opts.schedule ?? true) {
    if (depth >= 4 && rng.chance(0.3)) placeItem('elixir');
    if (depth === 3) placeItem('sword2');
    if (depth === 6) placeItem('sword3');
    if (depth === 2 || depth === 5) placeItem('bow'); // floor 5 is the catch-up copy
    // spell tomes: one new school roughly every other floor
    if (depth === 2) placeItem('tomeHaste');
    if (depth === 3) placeItem('tomeNova');
    if (depth === 4) placeItem('tomeStoneskin');
    if (depth === 5) placeItem('tomeBlink');
  }
  if (depth >= 2) {
    const arrowBundles = rng.int(1, 2);
    for (let i = 0; i < arrowBundles; i++) placeItem('arrows');
  }
  const bombCount = rng.int(0, 2);
  for (let i = 0; i < bombCount; i++) placeItem('bomb');
  // Side-dungeon treasure: pile the promised loot in the far (stairs) room
  if (opts.extraLoot) {
    for (const item of opts.extraLoot) {
      const pos = randomRoomTile(rng, stairsRoom, taken, w, tiles);
      if (pos) itemSpawns.push({ item, x: pos.x, y: pos.y });
      else placeItem(item);
    }
  }
  if (keyPos) itemSpawns.push({ item: 'key', x: keyPos.x, y: keyPos.y });

  // 11. Gold piles: loose coin scattered through the rooms
  const goldSpawns: FloorData['goldSpawns'] = [];
  const pileCount = rng.int(2, 4);
  for (let i = 0; i < pileCount; i++) {
    const room = rng.pick(dropRooms.length > 0 ? dropRooms : rooms);
    const pos = randomRoomTile(rng, room, taken, w, tiles);
    if (pos) goldSpawns.push({ x: pos.x, y: pos.y, amount: goldPileFor(depth, rng) });
  }

  return {
    tiles, w, h, depth, rooms, spawn, downStairs, doors, keyPos,
    enemySpawns, itemSpawns, goldSpawns, friendlySpawns,
  };
}
