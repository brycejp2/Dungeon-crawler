// Rendering: procedural sprite atlas (no art assets), camera, tilemap, fog of war,
// corruption visuals. Draws to the 400x240 virtual canvas; main.ts scales it up.

import { TILE, VIEW_W, VIEW_H, MAP_W, MAP_H, EXPLORED_BRIGHTNESS, CORRUPTION_MAX } from './config';
import { Tile } from './dungeon';
import type { FloorData, EnemyKind } from './dungeon';
import type { Facing, Rect } from './combat';
import type { Player, Enemy, Projectile, Pickup } from './entities';
import type { ItemId } from './items';

export const FOG_HIDDEN = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

function mkCanvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  draw(c);
  return canvas;
}

function tintMagenta(base: HTMLCanvasElement): HTMLCanvasElement {
  return mkCanvas(base.width, base.height, (c) => {
    c.drawImage(base, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(255, 0, 220, 0.45)';
    c.fillRect(0, 0, base.width, base.height);
  });
}

// --- sprite painters ---

function paintPlayer(c: CanvasRenderingContext2D, facing: Facing): void {
  // 12x14: boots, green tunic, head, facing hint
  c.fillStyle = '#5a3a1e';
  c.fillRect(2, 12, 3, 2);
  c.fillRect(7, 12, 3, 2);
  c.fillStyle = '#2e9e46';
  c.fillRect(1, 6, 10, 6);
  c.fillStyle = '#f0c890';
  c.fillRect(3, 1, 6, 6);
  c.fillStyle = '#7a4a20';
  c.fillRect(3, 0, 6, 2); // hair
  c.fillStyle = '#1a1a2e';
  if (facing === 'down') {
    c.fillRect(4, 4, 1, 2);
    c.fillRect(7, 4, 1, 2);
  } else if (facing === 'left') {
    c.fillRect(3, 4, 1, 2);
  } else if (facing === 'right') {
    c.fillRect(8, 4, 1, 2);
  }
  // facing 'up': back of head, no eyes
}

function paintChaser(c: CanvasRenderingContext2D): void {
  // 11x12 goblin
  c.fillStyle = '#6a8a2a';
  c.fillRect(1, 3, 9, 8);
  c.fillRect(0, 1, 3, 4); // ears
  c.fillRect(8, 1, 3, 4);
  c.fillStyle = '#3a5a10';
  c.fillRect(2, 11, 3, 1);
  c.fillRect(6, 11, 3, 1);
  c.fillStyle = '#ffdd30';
  c.fillRect(3, 5, 2, 2);
  c.fillRect(7, 5, 2, 2);
  c.fillStyle = '#902020';
  c.fillRect(4, 8, 3, 1); // mouth
}

function paintArcher(c: CanvasRenderingContext2D): void {
  // 10x12 hooded cultist
  c.fillStyle = '#5a2a6a';
  c.fillRect(1, 2, 8, 10);
  c.fillStyle = '#3a1a4a';
  c.fillRect(1, 2, 8, 4); // hood
  c.fillStyle = '#ff4040';
  c.fillRect(3, 4, 1, 1);
  c.fillRect(6, 4, 1, 1);
  c.fillStyle = '#8a6a2a';
  c.fillRect(0, 6, 2, 5); // bow arm
}

function paintBat(c: CanvasRenderingContext2D): void {
  // 9x8
  c.fillStyle = '#4a4a6a';
  c.fillRect(0, 2, 3, 3);
  c.fillRect(6, 2, 3, 3);
  c.fillStyle = '#2a2a3e';
  c.fillRect(3, 1, 3, 5);
  c.fillStyle = '#ff3030';
  c.fillRect(3, 2, 1, 1);
  c.fillRect(5, 2, 1, 1);
}

function paintBoss(c: CanvasRenderingContext2D): void {
  // 26x26 Herald of Decay
  c.fillStyle = '#5a1a4a';
  c.fillRect(3, 6, 20, 18);
  c.fillStyle = '#7a2a5a';
  c.fillRect(5, 8, 16, 12);
  c.fillStyle = '#2a0a1e';
  c.fillRect(0, 0, 5, 8); // horns
  c.fillRect(21, 0, 5, 8);
  c.fillRect(2, 0, 3, 4);
  c.fillStyle = '#ff20a0';
  c.fillRect(8, 11, 3, 3); // eyes
  c.fillRect(15, 11, 3, 3);
  c.fillStyle = '#1a0a12';
  c.fillRect(9, 17, 8, 3); // maw
  c.fillStyle = '#ff20a0';
  c.fillRect(10, 17, 1, 1);
  c.fillRect(13, 17, 1, 1);
  c.fillRect(15, 17, 1, 1);
}

function paintTileWall(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#3a3a52';
  c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#4a4a66';
  c.fillRect(0, 0, TILE, 4); // top face highlight
  c.fillStyle = '#2a2a3e';
  c.fillRect(0, TILE - 2, TILE, 2);
  c.fillStyle = '#32324a';
  c.fillRect(2, 6, 5, 3);
  c.fillRect(9, 10, 5, 3);
}

function paintTileFloor(c: CanvasRenderingContext2D, seedHash: number): void {
  c.fillStyle = '#1c1c28';
  c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#232332';
  // deterministic speckle from tile hash
  let s = seedHash;
  for (let i = 0; i < 4; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    c.fillRect(s % TILE, (s >> 4) % TILE, 1, 1);
  }
}

function paintTileCorrupt(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#241428';
  c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#58185e';
  c.fillRect(3, 3, 2, 2);
  c.fillRect(10, 7, 2, 2);
  c.fillRect(6, 12, 2, 2);
  c.fillStyle = '#8a20a0';
  c.fillRect(11, 12, 1, 1);
  c.fillRect(4, 9, 1, 1);
}

function paintStairsDown(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#05050a';
  c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#2a2a3e';
  c.fillRect(0, 0, TILE, 4);
  c.fillStyle = '#1c1c28';
  c.fillRect(2, 4, 12, 3);
  c.fillStyle = '#12121c';
  c.fillRect(4, 7, 8, 3);
}

function paintStairsUp(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#1c1c28';
  c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#3c3c56';
  c.fillRect(2, 10, 12, 4);
  c.fillStyle = '#4c4c6a';
  c.fillRect(4, 6, 8, 4);
  c.fillStyle = '#5c5c7e';
  c.fillRect(6, 2, 4, 4);
}

function paintDoor(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#5a3a1e';
  c.fillRect(1, 0, TILE - 2, TILE);
  c.fillStyle = '#6e4a28';
  c.fillRect(3, 2, TILE - 6, TILE - 4);
  c.fillStyle = '#ffd040';
  c.fillRect(7, 7, 3, 2); // keyhole plate
  c.fillStyle = '#1a1a1a';
  c.fillRect(8, 7, 1, 2);
}

function paintRubble(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#1c1c28';
  c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#55556e';
  c.fillRect(2, 6, 6, 6);
  c.fillRect(8, 3, 5, 5);
  c.fillRect(9, 9, 5, 5);
  c.fillStyle = '#3c3c52';
  c.fillRect(3, 7, 3, 3);
  c.fillRect(10, 10, 3, 3);
}

function paintItem(c: CanvasRenderingContext2D, item: ItemId): void {
  // 10x10 icons
  switch (item) {
    case 'healPotion':
      c.fillStyle = '#d02040';
      c.fillRect(3, 3, 4, 6);
      c.fillRect(2, 5, 6, 4);
      c.fillStyle = '#e8e8f0';
      c.fillRect(4, 1, 2, 2);
      break;
    case 'purityPotion':
      c.fillStyle = '#30c0e0';
      c.fillRect(3, 3, 4, 6);
      c.fillRect(2, 5, 6, 4);
      c.fillStyle = '#e8e8f0';
      c.fillRect(4, 1, 2, 2);
      break;
    case 'elixir':
      c.fillStyle = '#ffe060';
      c.fillRect(3, 2, 4, 7);
      c.fillRect(2, 4, 6, 5);
      c.fillStyle = '#fffdf0';
      c.fillRect(4, 0, 2, 2);
      break;
    case 'bomb':
      c.fillStyle = '#20202e';
      c.fillRect(2, 4, 6, 6);
      c.fillRect(3, 3, 4, 8);
      c.fillStyle = '#c08030';
      c.fillRect(5, 1, 1, 3);
      c.fillStyle = '#ff6020';
      c.fillRect(5, 0, 2, 2);
      break;
    case 'key':
      c.fillStyle = '#ffd040';
      c.fillRect(2, 2, 4, 4);
      c.fillRect(4, 5, 2, 5);
      c.fillRect(6, 7, 2, 1);
      c.fillRect(6, 9, 2, 1);
      c.fillStyle = '#1a1a1a';
      c.fillRect(3, 3, 2, 2);
      break;
    case 'sword1':
    case 'sword2':
    case 'sword3': {
      const blade = item === 'sword1' ? '#9a9aa8' : item === 'sword2' ? '#c8d0e0' : '#80ffd0';
      c.fillStyle = blade;
      c.fillRect(4, 0, 2, 7);
      c.fillStyle = '#7a5a20';
      c.fillRect(2, 6, 6, 2);
      c.fillRect(4, 8, 2, 2);
      break;
    }
  }
}

export class SpriteAtlas {
  player: Record<Facing, HTMLCanvasElement>;
  enemies: Record<Exclude<EnemyKind, 'boss'>, HTMLCanvasElement>;
  enemiesCorrupt: Record<Exclude<EnemyKind, 'boss'>, HTMLCanvasElement>;
  boss: HTMLCanvasElement;
  tiles: Map<Tile, HTMLCanvasElement>;
  floorVariants: HTMLCanvasElement[];
  items: Map<ItemId, HTMLCanvasElement>;

  constructor() {
    this.player = {
      up: mkCanvas(12, 14, (c) => paintPlayer(c, 'up')),
      down: mkCanvas(12, 14, (c) => paintPlayer(c, 'down')),
      left: mkCanvas(12, 14, (c) => paintPlayer(c, 'left')),
      right: mkCanvas(12, 14, (c) => paintPlayer(c, 'right')),
    };
    this.enemies = {
      chaser: mkCanvas(11, 12, paintChaser),
      archer: mkCanvas(10, 12, paintArcher),
      bat: mkCanvas(9, 8, paintBat),
    };
    this.enemiesCorrupt = {
      chaser: tintMagenta(this.enemies.chaser),
      archer: tintMagenta(this.enemies.archer),
      bat: tintMagenta(this.enemies.bat),
    };
    this.boss = mkCanvas(26, 26, paintBoss);
    this.tiles = new Map<Tile, HTMLCanvasElement>([
      [Tile.Wall, mkCanvas(TILE, TILE, paintTileWall)],
      [Tile.CorruptFloor, mkCanvas(TILE, TILE, paintTileCorrupt)],
      [Tile.StairsDown, mkCanvas(TILE, TILE, paintStairsDown)],
      [Tile.StairsUp, mkCanvas(TILE, TILE, paintStairsUp)],
      [Tile.DoorLocked, mkCanvas(TILE, TILE, paintDoor)],
      [Tile.Rubble, mkCanvas(TILE, TILE, paintRubble)],
    ]);
    this.floorVariants = [0, 1, 2, 3].map((i) =>
      mkCanvas(TILE, TILE, (c) => paintTileFloor(c, 0x9e3779 + i * 7919)),
    );
    const itemIds: ItemId[] = ['healPotion', 'purityPotion', 'elixir', 'bomb', 'key', 'sword1', 'sword2', 'sword3'];
    this.items = new Map(itemIds.map((id) => [id, mkCanvas(10, 10, (c) => paintItem(c, id))]));
  }
}

export class Camera {
  x = 0;
  y = 0;

  snapTo(px: number, py: number): void {
    this.x = px - VIEW_W / 2;
    this.y = py - VIEW_H / 2;
    this.clamp();
  }

  follow(px: number, py: number, dt: number): void {
    const tx = px - VIEW_W / 2;
    const ty = py - VIEW_H / 2;
    const k = Math.min(1, 8 * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clamp();
  }

  private clamp(): void {
    this.x = Math.max(0, Math.min(MAP_W * TILE - VIEW_W, this.x));
    this.y = Math.max(0, Math.min(MAP_H * TILE - VIEW_H, this.y));
  }
}

/** Stable per-tile hash for corruption tile decay + floor variants. */
function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return (h ^ (h >> 16)) >>> 0;
}

export class Renderer {
  readonly atlas = new SpriteAtlas();
  readonly camera = new Camera();

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  begin(): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawTiles(floor: FloorData, fog: Uint8Array, corruptionPoints: number, time: number): void {
    const { ctx, camera, atlas } = this;
    const x0 = Math.floor(camera.x / TILE);
    const y0 = Math.floor(camera.y / TILE);
    const x1 = Math.min(floor.w - 1, Math.ceil((camera.x + VIEW_W) / TILE));
    const y1 = Math.min(floor.h - 1, Math.ceil((camera.y + VIEW_H) / TILE));
    const decayFrac = (corruptionPoints / CORRUPTION_MAX) * 0.4;

    for (let ty = Math.max(0, y0); ty <= y1; ty++) {
      for (let tx = Math.max(0, x0); tx <= x1; tx++) {
        const f = fog[ty * floor.w + tx]!;
        if (f === FOG_HIDDEN) continue;
        let t = floor.tiles[ty * floor.w + tx] as Tile;
        const hash = tileHash(tx, ty);
        // corruption visually eats the floor
        if (t === Tile.Floor && (hash % 1000) / 1000 < decayFrac) t = Tile.CorruptFloor;
        const sprite = t === Tile.Floor ? atlas.floorVariants[hash % 4]! : atlas.tiles.get(t)!;
        const sx = Math.round(tx * TILE - camera.x);
        const sy = Math.round(ty * TILE - camera.y);
        ctx.drawImage(sprite, sx, sy);
        if (t === Tile.CorruptFloor) {
          // pulse
          const pulse = 0.1 + 0.08 * Math.sin(time * 3 + hash);
          ctx.fillStyle = `rgba(255, 0, 220, ${pulse.toFixed(3)})`;
          ctx.fillRect(sx, sy, TILE, TILE);
        }
        if (f === FOG_EXPLORED) {
          ctx.fillStyle = `rgba(0, 0, 0, ${1 - EXPLORED_BRIGHTNESS})`;
          ctx.fillRect(sx, sy, TILE, TILE);
        }
      }
    }
  }

  private visibleAt(fog: Uint8Array, floorW: number, wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    return fog[ty * floorW + tx] === FOG_VISIBLE;
  }

  drawPickup(p: Pickup, fog: Uint8Array, floorW: number, time: number): void {
    if (!this.visibleAt(fog, floorW, p.x + 5, p.y + 5)) return;
    const bob = Math.sin(time * 4 + p.x) * 1.5;
    const sprite = this.atlas.items.get(p.item)!;
    this.ctx.drawImage(sprite, Math.round(p.x - this.camera.x), Math.round(p.y - this.camera.y + bob));
  }

  drawEnemy(e: Enemy, fog: Uint8Array, floorW: number, time: number): void {
    if (!this.visibleAt(fog, floorW, e.cx, e.cy)) return;
    const { ctx, camera } = this;
    const sx = Math.round(e.x - camera.x);
    const sy = Math.round(e.y - camera.y);
    // hit flash
    if (e.iframes > 0 && Math.floor(time * 30) % 2 === 0) return;
    const sprite =
      e.kind === 'boss'
        ? this.atlas.boss
        : (e.corrupted ? this.atlas.enemiesCorrupt : this.atlas.enemies)[e.kind];
    ctx.drawImage(sprite, sx, sy);
    // telegraphs
    if (e.state === 'windup') {
      const blink = Math.floor(time * 12) % 2 === 0;
      if (blink) {
        ctx.fillStyle = 'rgba(255, 60, 60, 0.45)';
        ctx.fillRect(sx - 1, sy - 1, e.w + 2, e.h + 2);
      }
    } else if (e.state === 'aim') {
      ctx.strokeStyle = 'rgba(255, 60, 60, 0.5)';
      ctx.beginPath();
      ctx.moveTo(e.cx - camera.x, e.cy - camera.y);
      // aim line toward player is drawn by playScene (knows player pos)
      ctx.stroke();
    } else if (e.state === 'stunned') {
      ctx.fillStyle = '#ffe060';
      const wob = Math.sin(time * 10) * 3;
      ctx.fillRect(sx + e.w / 2 + wob, sy - 5, 2, 2);
      ctx.fillRect(sx + e.w / 2 - wob, sy - 4, 2, 2);
    }
  }

  drawAimLine(e: Enemy, px: number, py: number): void {
    const { ctx, camera } = this;
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(e.cx - camera.x, e.cy - camera.y);
    ctx.lineTo(px - camera.x, py - camera.y);
    ctx.stroke();
  }

  drawPlayer(p: Player, time: number): void {
    // i-frame flicker
    if (p.iframes > 0 && Math.floor(time * 15) % 2 === 0) return;
    const sprite = this.atlas.player[p.facing];
    this.ctx.drawImage(
      sprite,
      Math.round(p.cx - sprite.width / 2 - this.camera.x),
      Math.round(p.y + p.h - sprite.height - this.camera.y),
    );
  }

  drawSwingArc(hitbox: Rect): void {
    const { ctx, camera } = this;
    ctx.fillStyle = 'rgba(240, 240, 255, 0.5)';
    ctx.fillRect(
      Math.round(hitbox.x - camera.x),
      Math.round(hitbox.y - camera.y),
      Math.round(hitbox.w),
      Math.round(hitbox.h),
    );
  }

  drawProjectile(pr: Projectile): void {
    const { ctx, camera } = this;
    ctx.fillStyle = pr.corrupted ? '#ff30d0' : '#ffd060';
    const s = pr.size;
    ctx.fillRect(Math.round(pr.x - s / 2 - camera.x), Math.round(pr.y - s / 2 - camera.y), s, s);
  }

  drawBombFx(x: number, y: number, radius: number, alpha: number): void {
    const { ctx, camera } = this;
    ctx.fillStyle = `rgba(255, 160, 40, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x - camera.x, y - camera.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Magenta corruption vignette; alpha scales with corruption points. */
  drawCorruptionVignette(points: number, time: number): void {
    if (points <= 0) return;
    const { ctx } = this;
    const strength = (points / CORRUPTION_MAX) * 0.55 + 0.04 * Math.sin(time * 2);
    const grad = ctx.createRadialGradient(
      VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.45,
      VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85,
    );
    grad.addColorStop(0, 'rgba(120, 0, 100, 0)');
    grad.addColorStop(1, `rgba(120, 0, 100, ${Math.max(0, strength).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  flashScreen(color: string, alpha: number): void {
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.ctx.globalAlpha = 1;
  }
}
