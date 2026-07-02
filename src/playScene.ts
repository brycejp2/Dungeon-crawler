// The gameplay orchestrator: owns the current floor, all entities, corruption,
// inventory, fog of war. Implements the World interface entities talk to.

import {
  TILE, FINAL_DEPTH, VISION_RADIUS, FOG_RECOMPUTE_HZ,
  STAIRS_CLEANSE, PURITY_POTION_CLEANSE, ELIXIR_CLEANSE,
  CORRUPT_VARIANT_TIER, CORRUPT_VARIANT_CHANCE, CORRUPT_HIT_POINTS,
  PLAYER_MAX_HP_CAP, VIEW_W, VIEW_H,
  ARROW_SPEED, ARROW_DAMAGE, BOW_COOLDOWN, BOMB_THROW_DIST,
} from './config';
import type { Game, Scene, SceneFlow, RunStats } from './game';
import type { InputState } from './input';
import { Rng } from './rng';
import {
  Tile, generateFloor, isSolid, hasLineOfSight, inRoom,
} from './dungeon';
import type { FloorData } from './dungeon';
import { Player, Enemy, moveAndCollide } from './entities';
import type { World, Projectile, Pickup } from './entities';
import { aabbOverlap, knockbackVector, swingDamage, resolveAimDir, castThrow } from './combat';
import {
  newCorruptionState, tickCorruption, addCorruption, cleanse,
  computeMutationEffects, MUTATIONS,
} from './corruption';
import type { CorruptionState, MutationEffects } from './corruption';
import { Inventory, ITEMS } from './items';
import { Renderer, FOG_HIDDEN, FOG_EXPLORED, FOG_VISIBLE } from './render';
import { Hud } from './hud';
import type { AudioPort } from './audio';

interface Bomb {
  x: number;
  y: number;
  fuse: number;
}

interface BoomFx {
  x: number;
  y: number;
  age: number;
}

const BOMB_RADIUS = 30;

export class PlayScene implements Scene, World {
  readonly rng: Rng;
  audio!: AudioPort;
  player: Player;
  aggroBonus = 0;

  private floor: FloorData;
  private depth: number;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private bombs: Bomb[] = [];
  private booms: BoomFx[] = [];
  private fog: Uint8Array;
  private corruption: CorruptionState = newCorruptionState();
  private inventory = new Inventory();
  private fx: MutationEffects = computeMutationEffects([]);
  private hud = new Hud();
  private renderer: Renderer | null = null;
  private time = 0;
  private fogTimer = 0;
  private kills = 0;
  private flashT = 0;
  private flashColor = '#fff';
  private ending = false;
  // aim state (recomputed every tick, read by render)
  private aimDirX = 0;
  private aimDirY = 1;
  private aimIsPointer = false;
  private aimPointerWorldX = 0;
  private aimPointerWorldY = 0;

  constructor(
    private readonly flow: SceneFlow,
    seed: number,
    startDepth = 1,
  ) {
    this.rng = new Rng(seed);
    this.depth = startDepth;
    this.floor = generateFloor(seed, this.depth);
    this.fog = new Uint8Array(this.floor.w * this.floor.h).fill(FOG_HIDDEN);
    this.player = new Player(
      this.floor.spawn.x * TILE + 3,
      this.floor.spawn.y * TILE + 2,
    );
    this.populateFloor();
  }

  enter(game: Game): void {
    this.audio = game.audio;
    this.hud.push('The dungeon seethes with chaos. Hurry.');
    this.recomputeFog();
  }

  // --- World interface ---

  isSolidTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.floor.w || ty >= this.floor.h) return true;
    return isSolid(this.floor.tiles[ty * this.floor.w + tx] as Tile);
  }

  hasLOS(tx0: number, ty0: number, tx1: number, ty1: number): boolean {
    return hasLineOfSight(this.floor.tiles, this.floor.w, this.floor.h, tx0, ty0, tx1, ty1);
  }

  spawnProjectile(p: Projectile): void {
    this.projectiles.push(p);
  }

  spawnBat(x: number, y: number): void {
    const bat = new Enemy('bat', 0, 0, true, this.depth, this.corruption.tierReached);
    bat.x = x - bat.w / 2;
    bat.y = y - bat.h / 2;
    this.enemies.push(bat);
  }

  // --- setup ---

  private populateFloor(): void {
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.bombs = [];
    this.booms = [];
    const tier = this.corruption.tierReached;
    for (const s of this.floor.enemySpawns) {
      const corrupted =
        s.kind !== 'boss' && tier >= CORRUPT_VARIANT_TIER && this.rng.chance(CORRUPT_VARIANT_CHANCE);
      const e = new Enemy(s.kind, 0, 0, corrupted, this.depth, tier);
      e.x = s.x * TILE + (TILE - e.w) / 2;
      e.y = s.y * TILE + (TILE - e.h) / 2;
      this.enemies.push(e);
    }
    for (const s of this.floor.itemSpawns) {
      this.pickups.push({ item: s.item, x: s.x * TILE + 3, y: s.y * TILE + 3, dead: false });
    }
  }

  private descend(game: Game): void {
    this.depth++;
    this.audio.play('stairs');
    cleanse(this.corruption, STAIRS_CLEANSE);
    this.floor = generateFloor(this.rng.subSeed(), this.depth);
    this.fog = new Uint8Array(this.floor.w * this.floor.h).fill(FOG_HIDDEN);
    this.player.x = this.floor.spawn.x * TILE + 3;
    this.player.y = this.floor.spawn.y * TILE + 2;
    this.player.kx = 0;
    this.player.ky = 0;
    this.populateFloor();
    this.recomputeFog();
    this.renderer?.camera.snapTo(this.player.cx, this.player.cy);
    this.hud.push(
      this.depth >= FINAL_DEPTH
        ? 'A dread presence stirs below. This is the last floor.'
        : `You descend to floor ${this.depth}. The air grows fouler.`,
    );
    if (this.depth >= FINAL_DEPTH) this.audio.play('bossRoar');
    void game;
  }

  private endRun(game: Game, cause: string, victory: boolean): void {
    if (this.ending) return;
    this.ending = true;
    const stats: RunStats = {
      depth: this.depth,
      kills: this.kills,
      corruptionPoints: Math.round(this.corruption.points),
      mutationCount: this.corruption.mutations.length,
      timeSec: Math.round(this.time),
      cause,
    };
    game.switchScene(victory ? this.flow.victory(stats) : this.flow.gameOver(stats));
  }

  // --- update ---

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;
    this.hud.update(dt);
    if (this.flashT > 0) this.flashT -= dt;

    // Corruption is the clock: always ticking
    const events = tickCorruption(this.corruption, dt, this.depth, this.fx.corruptionRateMult, this.rng);
    this.handleCorruptionEvents(events, game);
    if (this.ending) return;

    this.player.update(dt, input, this, this.fx);
    this.aggroBonus = this.fx.aggroDelta;

    // Aim: right stick > mouse pointer > facing
    const cam = this.cameraPos();
    this.aimPointerWorldX = input.pointerX + cam.x;
    this.aimPointerWorldY = input.pointerY + cam.y;
    this.aimIsPointer = !input.hasStick && input.hasPointer;
    const aim = resolveAimDir(
      input.hasStick, input.stickX, input.stickY,
      input.hasPointer, this.aimPointerWorldX, this.aimPointerWorldY,
      this.player.cx, this.player.cy,
      this.player.facing,
    );
    this.aimDirX = aim.x;
    this.aimDirY = aim.y;

    if (input.cycleItem) this.inventory.cycle();
    if (input.useItem) this.useSelectedItem(game);
    if (input.fire) this.tryFireBow();

    // Enemies
    for (const e of this.enemies) e.update(dt, this);

    // Player sword vs enemies
    const hitbox = this.player.activeSwingHitbox(this.inventory.weaponStats.reach);
    if (hitbox && this.player.swing) {
      const dmg = swingDamage(this.inventory.weaponStats.damage, this.fx.damageBonus);
      for (const e of this.enemies) {
        if (e.dead || this.player.swing.hitIds.has(e)) continue;
        if (!aabbOverlap(hitbox, e.rect())) continue;
        this.player.swing.hitIds.add(e);
        if (e.takeDamage(dmg)) {
          const kb = knockbackVector(this.player.cx, this.player.cy, e.cx, e.cy, this.fx.knockbackDealtMult);
          e.applyKnockback(kb.x, kb.y);
          if (this.fx.poisonOnHit) e.applyPoison();
          this.audio.play('hit');
        }
      }
    }

    // Enemy contact damage
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (aabbOverlap(e.rect(), this.player.rect())) {
        this.damagePlayer(e.touchDamage, e.cx, e.cy, e.corrupted, game);
      }
    }

    // Projectiles
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      const tx = Math.floor(pr.x / TILE);
      const ty = Math.floor(pr.y / TILE);
      if (this.isSolidTile(tx, ty)) {
        pr.dead = true;
        continue;
      }
      const rect = { x: pr.x - pr.size / 2, y: pr.y - pr.size / 2, w: pr.size, h: pr.size };
      if (pr.friendly) {
        for (const e of this.enemies) {
          if (e.dead || !aabbOverlap(rect, e.rect())) continue;
          e.iframes = 0; // arrows always land; hit-stun only gates the sword
          if (e.takeDamage(pr.damage)) {
            const kb = knockbackVector(pr.x - pr.vx, pr.y - pr.vy, e.cx, e.cy, this.fx.knockbackDealtMult * 0.6);
            e.applyKnockback(kb.x, kb.y);
            this.audio.play('hit');
          }
          pr.dead = true;
          break;
        }
      } else if (aabbOverlap(rect, this.player.rect())) {
        if (this.damagePlayer(pr.damage, pr.x, pr.y, pr.corrupted, game)) pr.dead = true;
      }
    }

    // Bombs
    for (const b of this.bombs) {
      b.fuse -= dt;
      if (b.fuse <= 0) this.explodeBomb(b, game);
    }
    this.bombs = this.bombs.filter((b) => b.fuse > 0);
    for (const fx of this.booms) fx.age += dt;
    this.booms = this.booms.filter((f) => f.age < 0.35);

    // Pickups
    for (const p of this.pickups) {
      const rect = { x: p.x, y: p.y, w: 10, h: 10 };
      if (!aabbOverlap(rect, this.player.rect())) continue;
      if (this.inventory.add(p.item)) {
        p.dead = true;
        this.hud.push(ITEMS[p.item].pickupMessage);
        this.audio.play('pickup');
      }
    }

    // Locked doors: open on contact while holding the key
    if (this.inventory.hasKey && this.floor.doors.length > 0) {
      const ptx = Math.floor(this.player.cx / TILE);
      const pty = Math.floor(this.player.cy / TILE);
      for (const d of this.floor.doors) {
        if (Math.abs(d.x - ptx) + Math.abs(d.y - pty) === 1) {
          this.inventory.useKey();
          for (const dd of this.floor.doors) {
            this.floor.tiles[dd.y * this.floor.w + dd.x] = Tile.Floor;
          }
          this.floor.doors.length = 0;
          this.hud.push('The chaos seal shatters. The way is open.');
          this.audio.play('unlock');
          break;
        }
      }
    }

    // Reap the dead
    for (const e of this.enemies) {
      if (e.dead) {
        this.kills++;
        if (e.kind === 'boss') {
          this.audio.play('victory');
          this.endRun(game, 'Slew the Herald of Decay', true);
          return;
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.pickups = this.pickups.filter((p) => !p.dead);

    // Stairs
    const ptile = this.floor.tiles[
      Math.floor(this.player.cy / TILE) * this.floor.w + Math.floor(this.player.cx / TILE)
    ];
    if (ptile === Tile.StairsDown) {
      this.descend(game);
      return;
    }

    // Player death
    if (this.player.dead) {
      this.audio.play('die');
      this.endRun(game, 'Slain in the depths', false);
      return;
    }

    // Fog of war (throttled)
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 1 / FOG_RECOMPUTE_HZ;
      this.recomputeFog();
    }
  }

  private handleCorruptionEvents(
    events: ReturnType<typeof addCorruption>,
    game: Game,
  ): void {
    for (const ev of events) {
      if (ev.type === 'death') {
        this.audio.play('die');
        this.endRun(game, 'Consumed by Chaos', false);
        return;
      }
      // mutation
      const def = MUTATIONS[ev.mutation];
      this.hud.push(def.message);
      this.audio.play('mutation');
      this.flashT = 0.35;
      this.flashColor = '#ff20d0';
      this.fx = computeMutationEffects(this.corruption.mutations);
      // apply max-hp change, clamping current hp
      const newMax = Math.min(PLAYER_MAX_HP_CAP, Math.max(2, 6 + this.fx.maxHpDelta));
      this.player.maxHp = newMax;
      this.player.hp = Math.min(this.player.hp, newMax);
    }
  }

  private damagePlayer(dmg: number, srcX: number, srcY: number, corrupted: boolean, game: Game): boolean {
    if (!this.player.takeDamage(dmg)) return false;
    const kb = knockbackVector(srcX, srcY, this.player.cx, this.player.cy, this.fx.knockbackTakenMult);
    this.player.applyKnockback(kb.x, kb.y);
    this.audio.play('hurt');
    this.flashT = 0.15;
    this.flashColor = '#ff3030';
    if (corrupted) {
      const events = addCorruption(this.corruption, CORRUPT_HIT_POINTS, this.rng);
      this.handleCorruptionEvents(events, game);
    }
    return true;
  }

  private useSelectedItem(game: Game): void {
    const id = this.inventory.useSelected();
    if (!id) return;
    switch (id) {
      case 'healPotion': {
        const heal = Math.max(1, Math.round(4 * this.fx.healMult));
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
        this.hud.push(this.fx.healMult < 1 ? 'The potion fights your venom. Some health returns.' : 'You feel much better.');
        this.audio.play('potion');
        break;
      }
      case 'purityPotion':
        cleanse(this.corruption, PURITY_POTION_CLEANSE * this.fx.purityMult);
        this.hud.push('Order washes through you. Corruption recedes.');
        this.audio.play('potion');
        break;
      case 'elixir':
        cleanse(this.corruption, ELIXIR_CLEANSE * this.fx.purityMult);
        this.hud.push('The Elixir of Order burns the chaos away!');
        this.audio.play('potion');
        break;
      case 'bomb': {
        // lob toward the aim point, stopping at walls
        const target = castThrow(
          (tx, ty) => this.isSolidTile(tx, ty),
          this.player.cx, this.player.cy,
          this.aimDirX, this.aimDirY,
          this.throwDistance(),
          TILE,
        );
        this.bombs.push({ x: target.x, y: target.y, fuse: 1.2 });
        this.hud.push('The fuse hisses...');
        break;
      }
      default:
        break;
    }
    void game;
  }

  /** Camera top-left in world coords; approximated before the first render. */
  private cameraPos(): { x: number; y: number } {
    if (this.renderer) return { x: this.renderer.camera.x, y: this.renderer.camera.y };
    return {
      x: Math.max(0, Math.min(this.floor.w * TILE - VIEW_W, this.player.cx - VIEW_W / 2)),
      y: Math.max(0, Math.min(this.floor.h * TILE - VIEW_H, this.player.cy - VIEW_H / 2)),
    };
  }

  /** Mouse throws up to the cursor (capped); stick/facing throws full distance. */
  private throwDistance(): number {
    if (!this.aimIsPointer) return BOMB_THROW_DIST;
    const d = Math.hypot(this.aimPointerWorldX - this.player.cx, this.aimPointerWorldY - this.player.cy);
    return Math.min(BOMB_THROW_DIST, d);
  }

  private tryFireBow(): void {
    if (!this.inventory.hasBow) {
      this.hud.push('You have no bow.');
      return;
    }
    if (this.inventory.arrows <= 0) {
      this.hud.push('Out of arrows!');
      return;
    }
    if (this.player.bowCooldown > 0 || this.player.dodging) return;
    this.player.bowCooldown = BOW_COOLDOWN;
    this.inventory.arrows--;
    this.spawnProjectile({
      x: this.player.cx + this.aimDirX * 6,
      y: this.player.cy + this.aimDirY * 6,
      vx: this.aimDirX * ARROW_SPEED,
      vy: this.aimDirY * ARROW_SPEED,
      size: 4,
      damage: ARROW_DAMAGE,
      corrupted: false,
      friendly: true,
      dead: false,
    });
    // face the shot
    this.player.facing =
      Math.abs(this.aimDirX) > Math.abs(this.aimDirY)
        ? this.aimDirX > 0 ? 'right' : 'left'
        : this.aimDirY > 0 ? 'down' : 'up';
    this.audio.play('shoot');
  }

  private explodeBomb(b: Bomb, game: Game): void {
    this.audio.play('boom');
    this.booms.push({ x: b.x, y: b.y, age: 0 });
    // damage entities in radius
    for (const e of this.enemies) {
      if (Math.hypot(e.cx - b.x, e.cy - b.y) <= BOMB_RADIUS + 4) {
        e.iframes = 0;
        e.takeDamage(3);
        const kb = knockbackVector(b.x, b.y, e.cx, e.cy, 1.2);
        e.applyKnockback(kb.x, kb.y);
      }
    }
    if (Math.hypot(this.player.cx - b.x, this.player.cy - b.y) <= BOMB_RADIUS) {
      this.damagePlayer(2, b.x, b.y, false, game);
    }
    // clear rubble
    const btx = Math.floor(b.x / TILE);
    const bty = Math.floor(b.y / TILE);
    const r = Math.ceil(BOMB_RADIUS / TILE);
    for (let ty = bty - r; ty <= bty + r; ty++) {
      for (let tx = btx - r; tx <= btx + r; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.floor.w || ty >= this.floor.h) continue;
        if (this.floor.tiles[ty * this.floor.w + tx] === Tile.Rubble) {
          this.floor.tiles[ty * this.floor.w + tx] = Tile.Floor;
        }
      }
    }
  }

  private recomputeFog(): void {
    const { w, h, tiles } = this.floor;
    // downgrade currently-visible to explored
    for (let i = 0; i < this.fog.length; i++) {
      if (this.fog[i] === FOG_VISIBLE) this.fog[i] = FOG_EXPLORED;
    }
    const ptx = Math.floor(this.player.cx / TILE);
    const pty = Math.floor(this.player.cy / TILE);
    const radius = VISION_RADIUS + this.fx.visionDelta;
    for (let ty = Math.max(0, pty - radius); ty <= Math.min(h - 1, pty + radius); ty++) {
      for (let tx = Math.max(0, ptx - radius); tx <= Math.min(w - 1, ptx + radius); tx++) {
        if (Math.hypot(tx - ptx, ty - pty) > radius) continue;
        if (hasLineOfSight(tiles, w, h, ptx, pty, tx, ty)) {
          this.fog[ty * w + tx] = FOG_VISIBLE;
        }
      }
    }
    // reveal the whole room the player stands in (Zelda room feel)
    for (const room of this.floor.rooms) {
      if (!inRoom(room, ptx, pty)) continue;
      for (let ty = room.y - 1; ty <= room.y + room.h; ty++) {
        for (let tx = room.x - 1; tx <= room.x + room.w; tx++) {
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          this.fog[ty * w + tx] = FOG_VISIBLE;
        }
      }
      break;
    }
  }

  // --- render ---

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.renderer) {
      this.renderer = new Renderer(ctx);
      this.renderer.camera.snapTo(this.player.cx, this.player.cy);
    }
    const r = this.renderer;
    r.camera.follow(this.player.cx, this.player.cy, 1 / 60);

    r.begin();
    r.drawTiles(this.floor, this.fog, this.corruption.points, this.time);

    for (const p of this.pickups) r.drawPickup(p, this.fog, this.floor.w, this.time);

    // bombs on the ground
    for (const b of this.bombs) {
      const sprite = r.atlas.items.get('bomb')!;
      const blink = b.fuse < 0.4 && Math.floor(this.time * 12) % 2 === 0;
      if (!blink) ctx.drawImage(sprite, Math.round(b.x - 5 - r.camera.x), Math.round(b.y - 5 - r.camera.y));
    }

    // entities y-sorted
    const drawables: (Enemy | Player)[] = [...this.enemies, this.player];
    drawables.sort((a, b) => a.y + a.h - (b.y + b.h));
    for (const d of drawables) {
      if (d instanceof Enemy) {
        r.drawEnemy(d, this.fog, this.floor.w, this.time);
        if (d.state === 'aim') r.drawAimLine(d, this.player.cx, this.player.cy);
      } else {
        r.drawPlayer(this.player, this.time);
      }
    }

    for (const pr of this.projectiles) r.drawProjectile(pr);

    const hitbox = this.player.activeSwingHitbox(this.inventory.weaponStats.reach);
    if (hitbox) r.drawSwingArc(hitbox);

    for (const fx of this.booms) {
      r.drawBombFx(fx.x, fx.y, BOMB_RADIUS * (0.5 + fx.age * 2), 0.6 - fx.age * 1.5);
    }

    // aim indicator (only useful once you have something to aim)
    if (this.inventory.hasBow || this.inventory.count('bomb') > 0) {
      if (this.aimIsPointer) {
        r.drawCrosshair(this.aimPointerWorldX, this.aimPointerWorldY);
      } else {
        r.drawAimArrow(this.player.cx, this.player.cy, this.aimDirX, this.aimDirY);
      }
    }

    r.drawCorruptionVignette(this.corruption.points, this.time);
    if (this.flashT > 0) r.flashScreen(this.flashColor, Math.min(0.5, this.flashT * 2));

    this.hud.render(ctx, r.atlas, this.player, this.corruption, this.depth, this.inventory, this.time);
  }
}

// re-export for main.ts dev tooling
export { moveAndCollide };
