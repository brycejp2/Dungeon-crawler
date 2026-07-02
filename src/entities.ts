// Actors: Player, Enemy FSMs (chaser, archer, bat, boss), projectiles, pickups.
// Entities talk to the level only through the small World interface — no import cycles.

import {
  TILE, PLAYER_SPEED, PLAYER_W, PLAYER_H, PLAYER_START_HP, PLAYER_IFRAMES,
  DODGE_DIST, DODGE_TIME, DODGE_COOLDOWN,
  SWING_WINDUP, SWING_ACTIVE, SWING_RECOVERY,
  KNOCKBACK_DECAY, KNOCKBACK_INPUT_LOCK, ENEMY_HITSTUN,
  AGGRO_RADIUS, AGGRO_LOSE_TIME, PROJECTILE_SPEED, DEPTH_SCALE,
  CORRUPT_TIER_SPAWN_SCALE,
} from './config';
import type { Rect, Facing } from './combat';
import { swingHitbox } from './combat';
import type { EnemyKind } from './dungeon';
import type { InputState } from './input';
import type { Rng } from './rng';
import type { AudioPort } from './audio';
import type { ItemId } from './items';
import type { MutationEffects } from './corruption';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  damage: number;
  corrupted: boolean;
  dead: boolean;
}

export interface Pickup {
  item: ItemId;
  x: number; // top-left, px
  y: number;
  dead: boolean;
}

/** What entities may ask of the level. Implemented by PlayScene. */
export interface World {
  isSolidTile(tx: number, ty: number): boolean;
  hasLOS(tx0: number, ty0: number, tx1: number, ty1: number): boolean;
  readonly player: Player;
  readonly rng: Rng;
  readonly audio: AudioPort;
  readonly aggroBonus: number; // tiles, from Bulging Eyes
  spawnProjectile(p: Projectile): void;
  spawnBat(x: number, y: number): void; // boss phase-3 summons
}

export abstract class Actor {
  kx = 0; // knockback velocity px/s
  ky = 0;
  facing: Facing = 'down';
  iframes = 0;
  dead = false;

  constructor(
    public x: number, // top-left px
    public y: number,
    public w: number,
    public h: number,
    public hp: number,
    public maxHp: number,
  ) {}

  get cx(): number {
    return this.x + this.w / 2;
  }

  get cy(): number {
    return this.y + this.h / 2;
  }

  rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get inKnockback(): boolean {
    return Math.hypot(this.kx, this.ky) > KNOCKBACK_INPUT_LOCK;
  }

  applyKnockback(vx: number, vy: number): void {
    this.kx = vx;
    this.ky = vy;
  }

  protected stepKnockback(dt: number, world: World): void {
    if (this.kx !== 0 || this.ky !== 0) {
      moveAndCollide(this, this.kx * dt, this.ky * dt, world);
      const decay = Math.pow(KNOCKBACK_DECAY, dt);
      this.kx *= decay;
      this.ky *= decay;
      if (Math.hypot(this.kx, this.ky) < 4) {
        this.kx = 0;
        this.ky = 0;
      }
    }
    if (this.iframes > 0) this.iframes -= dt;
  }
}

/** Per-axis AABB movement vs solid tiles, sliding along walls. */
export function moveAndCollide(a: Actor, dx: number, dy: number, world: World): void {
  if (dx !== 0) {
    a.x += dx;
    const top = Math.floor(a.y / TILE);
    const bottom = Math.floor((a.y + a.h - 0.001) / TILE);
    if (dx > 0) {
      const tx = Math.floor((a.x + a.w - 0.001) / TILE);
      for (let ty = top; ty <= bottom; ty++) {
        if (world.isSolidTile(tx, ty)) {
          a.x = tx * TILE - a.w;
          break;
        }
      }
    } else {
      const tx = Math.floor(a.x / TILE);
      for (let ty = top; ty <= bottom; ty++) {
        if (world.isSolidTile(tx, ty)) {
          a.x = (tx + 1) * TILE;
          break;
        }
      }
    }
  }
  if (dy !== 0) {
    a.y += dy;
    const left = Math.floor(a.x / TILE);
    const right = Math.floor((a.x + a.w - 0.001) / TILE);
    if (dy > 0) {
      const ty = Math.floor((a.y + a.h - 0.001) / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (world.isSolidTile(tx, ty)) {
          a.y = ty * TILE - a.h;
          break;
        }
      }
    } else {
      const ty = Math.floor(a.y / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (world.isSolidTile(tx, ty)) {
          a.y = (ty + 1) * TILE;
          break;
        }
      }
    }
  }
}

interface Swing {
  t: number;
  facing: Facing;
  hitIds: Set<Enemy>;
}

export class Player extends Actor {
  swing: Swing | null = null;
  dodgeT = 0; // remaining dodge time
  dodgeDirX = 0;
  dodgeDirY = 0;
  dodgeCooldown = 0;
  attackHeld = false;

  constructor(x: number, y: number) {
    super(x, y, PLAYER_W, PLAYER_H, PLAYER_START_HP, PLAYER_START_HP);
  }

  get dodging(): boolean {
    return this.dodgeT > 0;
  }

  get invulnerable(): boolean {
    return this.iframes > 0 || this.dodging;
  }

  /** Live sword hitbox this tick, or null when not in the active swing phase. */
  activeSwingHitbox(extraReach: number): Rect | null {
    if (!this.swing) return null;
    const t = this.swing.t;
    if (t < SWING_WINDUP || t >= SWING_WINDUP + SWING_ACTIVE) return null;
    return swingHitbox(this.cx, this.cy, this.swing.facing, extraReach);
  }

  update(dt: number, input: InputState, world: World, fx: MutationEffects): void {
    this.stepKnockback(dt, world);
    if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;

    // Swing lifecycle
    if (this.swing) {
      this.swing.t += dt;
      if (this.swing.t >= SWING_WINDUP + SWING_ACTIVE + SWING_RECOVERY) this.swing = null;
    }

    // Dodge in progress: fixed-velocity dash with full i-frames
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const speed = DODGE_DIST / DODGE_TIME;
      moveAndCollide(this, this.dodgeDirX * speed * dt, this.dodgeDirY * speed * dt, world);
      return;
    }

    const canAct = !this.inKnockback;

    // Movement (locked during the active swing window for commitment)
    const swingLock = this.swing !== null && this.swing.t < SWING_WINDUP + SWING_ACTIVE;
    if (canAct && !swingLock && (input.moveX !== 0 || input.moveY !== 0)) {
      let mx = input.moveX;
      let my = input.moveY;
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
      const speed = PLAYER_SPEED * fx.speedMult;
      moveAndCollide(this, mx * speed * dt, my * speed * dt, world);
      // Facing follows dominant axis
      if (Math.abs(input.moveX) > Math.abs(input.moveY)) {
        this.facing = input.moveX > 0 ? 'right' : 'left';
      } else if (input.moveY !== 0) {
        this.facing = input.moveY > 0 ? 'down' : 'up';
      }
    }

    // Start attack
    if (canAct && input.attack && !this.swing) {
      this.swing = { t: 0, facing: this.facing, hitIds: new Set() };
      world.audio.play('swing');
    }

    // Start dodge
    if (canAct && input.dodge && this.dodgeCooldown <= 0) {
      let dx = input.moveX;
      let dy = input.moveY;
      if (dx === 0 && dy === 0) {
        const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.facing];
        dx = v[0]!;
        dy = v[1]!;
      }
      const len = Math.hypot(dx, dy);
      this.dodgeDirX = dx / len;
      this.dodgeDirY = dy / len;
      this.dodgeT = DODGE_TIME;
      this.dodgeCooldown = DODGE_COOLDOWN * fx.dodgeCooldownMult;
      this.swing = null;
    }
  }

  /** Returns true if damage was applied (not invulnerable). */
  takeDamage(dmg: number): boolean {
    if (this.invulnerable || this.dead) return false;
    this.hp -= dmg;
    this.iframes = PLAYER_IFRAMES;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
    return true;
  }
}

type EnemyState = 'idle' | 'chase' | 'windup' | 'lunge' | 'recover' | 'aim' | 'stunned' | 'charge';

interface EnemyStats {
  w: number;
  h: number;
  hp: number;
  speed: number;
  touchDamage: number; // half-hearts
}

const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  chaser: { w: 11, h: 12, hp: 3, speed: 42, touchDamage: 1 },
  archer: { w: 10, h: 12, hp: 2, speed: 36, touchDamage: 1 },
  bat: { w: 9, h: 8, hp: 1, speed: 82, touchDamage: 1 },
  boss: { w: 26, h: 26, hp: 40, speed: 26, touchDamage: 2 },
};

export class Enemy extends Actor {
  state: EnemyState = 'idle';
  stateTime = 0;
  speed: number;
  touchDamage: number;
  lostLosTime = 0;
  wanderX = 0;
  wanderY = 0;
  wanderTimer = 0;
  lungeDirX = 0;
  lungeDirY = 0;
  attackCooldown = 0;
  wobblePhase = 0;
  poisonTicks = 0;
  poisonTimer = 0;
  // boss only
  burstTimer = 0;
  summonTimer = 0;
  roared2 = false;
  roared3 = false;

  constructor(
    public readonly kind: EnemyKind,
    x: number,
    y: number,
    public readonly corrupted: boolean,
    depth: number,
    corruptionTier: number,
  ) {
    const s = ENEMY_STATS[kind];
    const scale = (1 + DEPTH_SCALE * (depth - 1)) * (1 + CORRUPT_TIER_SPAWN_SCALE * corruptionTier);
    const hpScale = corrupted ? scale * 1.5 : scale;
    super(x, y, s.w, s.h, Math.max(1, Math.round(s.hp * hpScale)), Math.max(1, Math.round(s.hp * hpScale)));
    this.speed = corrupted ? s.speed * 1.5 : s.speed;
    this.touchDamage = Math.min(4, Math.round(s.touchDamage * scale));
    this.wobblePhase = x * 0.37 + y * 0.19;
  }

  applyPoison(): void {
    this.poisonTicks = 3;
    this.poisonTimer = 0.5;
  }

  takeDamage(dmg: number): boolean {
    if (this.iframes > 0 || this.dead) return false;
    this.hp -= dmg;
    this.iframes = ENEMY_HITSTUN;
    if (this.hp <= 0) this.dead = true;
    return true;
  }

  private distToPlayerTiles(world: World): number {
    return Math.hypot(world.player.cx - this.cx, world.player.cy - this.cy) / TILE;
  }

  private losToPlayer(world: World): boolean {
    return world.hasLOS(
      Math.floor(this.cx / TILE), Math.floor(this.cy / TILE),
      Math.floor(world.player.cx / TILE), Math.floor(world.player.cy / TILE),
    );
  }

  private moveToward(tx: number, ty: number, speed: number, dt: number, world: World): void {
    let dx = tx - this.cx;
    let dy = ty - this.cy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    dx /= len;
    dy /= len;
    moveAndCollide(this, dx * speed * dt, dy * speed * dt, world);
    this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  update(dt: number, world: World): void {
    this.stepKnockback(dt, world);
    this.stateTime += dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Poison DoT (Venomous Touch)
    if (this.poisonTicks > 0) {
      this.poisonTimer -= dt;
      if (this.poisonTimer <= 0) {
        this.poisonTicks--;
        this.poisonTimer = 0.5;
        this.hp -= 1;
        if (this.hp <= 0) {
          this.dead = true;
          return;
        }
      }
    }

    if (this.inKnockback) return;

    switch (this.kind) {
      case 'chaser':
        this.updateChaser(dt, world);
        break;
      case 'archer':
        this.updateArcher(dt, world);
        break;
      case 'bat':
        this.updateBat(dt, world);
        break;
      case 'boss':
        this.updateBoss(dt, world);
        break;
    }
  }

  private setState(s: EnemyState): void {
    this.state = s;
    this.stateTime = 0;
  }

  private wander(dt: number, world: World, speed: number): void {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = world.rng.range(0.8, 2.2);
      const ang = world.rng.range(0, Math.PI * 2);
      this.wanderX = this.cx + Math.cos(ang) * TILE * 3;
      this.wanderY = this.cy + Math.sin(ang) * TILE * 3;
    }
    this.moveToward(this.wanderX, this.wanderY, speed, dt, world);
  }

  private updateChaser(dt: number, world: World): void {
    const p = world.player;
    const distTiles = this.distToPlayerTiles(world);
    const los = this.losToPlayer(world);
    const aggro = AGGRO_RADIUS + world.aggroBonus;

    switch (this.state) {
      case 'idle':
        this.wander(dt, world, this.speed * 0.4);
        if (distTiles <= aggro && los) this.setState('chase');
        break;
      case 'chase':
        this.lostLosTime = los ? 0 : this.lostLosTime + dt;
        if (this.lostLosTime > AGGRO_LOSE_TIME) {
          this.setState('idle');
          break;
        }
        this.moveToward(p.cx, p.cy, this.speed, dt, world);
        if (distTiles < 1.6 && this.attackCooldown <= 0) this.setState('windup');
        break;
      case 'windup':
        // telegraphed pause before the lunge (rendered as a flash)
        if (this.stateTime >= 0.4) {
          const dx = p.cx - this.cx;
          const dy = p.cy - this.cy;
          const len = Math.hypot(dx, dy) || 1;
          this.lungeDirX = dx / len;
          this.lungeDirY = dy / len;
          this.setState('lunge');
        }
        break;
      case 'lunge':
        moveAndCollide(this, this.lungeDirX * this.speed * 3.2 * dt, this.lungeDirY * this.speed * 3.2 * dt, world);
        if (this.stateTime >= 0.28) {
          this.attackCooldown = 0.9;
          this.setState('recover');
        }
        break;
      case 'recover':
        if (this.stateTime >= 0.45) this.setState('chase');
        break;
      default:
        this.setState('idle');
    }
  }

  private updateArcher(dt: number, world: World): void {
    const p = world.player;
    const distTiles = this.distToPlayerTiles(world);
    const los = this.losToPlayer(world);
    const aggro = AGGRO_RADIUS + world.aggroBonus;

    switch (this.state) {
      case 'idle':
        this.wander(dt, world, this.speed * 0.4);
        if (distTiles <= aggro && los) this.setState('chase');
        break;
      case 'chase': {
        this.lostLosTime = los ? 0 : this.lostLosTime + dt;
        if (this.lostLosTime > AGGRO_LOSE_TIME) {
          this.setState('idle');
          break;
        }
        // Kite: hold a 4-7 tile band
        if (distTiles < 4) {
          this.moveToward(this.cx * 2 - p.cx, this.cy * 2 - p.cy, this.speed, dt, world);
        } else if (distTiles > 7) {
          this.moveToward(p.cx, p.cy, this.speed, dt, world);
        }
        if (los && distTiles >= 3 && distTiles <= 8 && this.attackCooldown <= 0) this.setState('aim');
        break;
      }
      case 'aim':
        // stands still, telegraph line rendered toward player
        if (this.stateTime >= 0.6) {
          this.fireAtPlayer(world);
          this.attackCooldown = world.rng.range(1.4, 2.2);
          this.setState('chase');
        }
        break;
      default:
        this.setState('idle');
    }
  }

  private fireAtPlayer(world: World): void {
    const p = world.player;
    const dx = p.cx - this.cx;
    const dy = p.cy - this.cy;
    const len = Math.hypot(dx, dy) || 1;
    const fire = (angleOffset: number) => {
      const baseAng = Math.atan2(dy / len, dx / len);
      const ang = baseAng + angleOffset;
      world.spawnProjectile({
        x: this.cx,
        y: this.cy,
        vx: Math.cos(ang) * PROJECTILE_SPEED,
        vy: Math.sin(ang) * PROJECTILE_SPEED,
        size: 4,
        damage: this.touchDamage,
        corrupted: this.corrupted,
        dead: false,
      });
    };
    fire(0);
    if (this.corrupted) {
      // corrupted archers fire a 3-shot spread
      fire(0.28);
      fire(-0.28);
    }
    world.audio.play('shoot');
  }

  private updateBat(dt: number, world: World): void {
    const p = world.player;
    const distTiles = this.distToPlayerTiles(world);
    this.wobblePhase += dt * 9;
    const aggro = AGGRO_RADIUS + world.aggroBonus + 2; // bats "hear" through walls

    if (distTiles <= aggro) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 0.8;
        this.wanderX = p.cx + world.rng.range(-TILE * 1.5, TILE * 1.5);
        this.wanderY = p.cy + world.rng.range(-TILE * 1.5, TILE * 1.5);
      }
      // sine wobble perpendicular to travel
      const dx = this.wanderX - this.cx;
      const dy = this.wanderY - this.cy;
      const len = Math.hypot(dx, dy) || 1;
      const wob = Math.sin(this.wobblePhase) * 30;
      moveAndCollide(
        this,
        ((dx / len) * this.speed + (-dy / len) * wob) * dt,
        ((dy / len) * this.speed + (dx / len) * wob) * dt,
        world,
      );
    } else {
      this.wander(dt, world, this.speed * 0.5);
    }
  }

  private updateBoss(dt: number, world: World): void {
    const p = world.player;
    const frac = this.hp / this.maxHp;
    const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;

    if (phase >= 2 && !this.roared2) {
      this.roared2 = true;
      world.audio.play('bossRoar');
    }
    if (phase === 3 && !this.roared3) {
      this.roared3 = true;
      world.audio.play('bossRoar');
    }

    // Radial bursts in all phases, faster and denser late
    this.burstTimer -= dt;
    if (this.burstTimer <= 0 && this.state !== 'stunned') {
      this.burstTimer = phase === 3 ? 1.8 : 2.6;
      const count = phase === 3 ? 8 : 6;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + world.rng.range(0, 0.4);
        world.spawnProjectile({
          x: this.cx,
          y: this.cy,
          vx: Math.cos(ang) * PROJECTILE_SPEED * 0.85,
          vy: Math.sin(ang) * PROJECTILE_SPEED * 0.85,
          size: 5,
          damage: 1,
          corrupted: true,
          dead: false,
        });
      }
      world.audio.play('shoot');
    }

    // Phase 3: summon bats
    if (phase === 3) {
      this.summonTimer -= dt;
      if (this.summonTimer <= 0) {
        this.summonTimer = 8;
        world.spawnBat(this.cx - TILE * 2, this.cy);
        world.spawnBat(this.cx + TILE * 2, this.cy);
      }
    }

    switch (this.state) {
      case 'idle':
      case 'chase': {
        const speed = phase === 3 ? this.speed * 1.7 : this.speed;
        this.moveToward(p.cx, p.cy, speed, dt, world);
        // Phase 2+: periodic telegraphed charge
        if (phase >= 2 && this.attackCooldown <= 0) this.setState('windup');
        break;
      }
      case 'windup':
        if (this.stateTime >= 0.6) {
          const dx = p.cx - this.cx;
          const dy = p.cy - this.cy;
          const len = Math.hypot(dx, dy) || 1;
          this.lungeDirX = dx / len;
          this.lungeDirY = dy / len;
          this.setState('charge');
        }
        break;
      case 'charge': {
        const beforeX = this.x;
        const beforeY = this.y;
        moveAndCollide(this, this.lungeDirX * 200 * dt, this.lungeDirY * 200 * dt, world);
        const expX = Math.abs(this.lungeDirX * 200 * dt);
        const expY = Math.abs(this.lungeDirY * 200 * dt);
        const hitWall =
          (expX > 0.01 && Math.abs(this.x - beforeX) < expX * 0.5) ||
          (expY > 0.01 && Math.abs(this.y - beforeY) < expY * 0.5);
        if (hitWall || this.stateTime > 1.5) {
          // slammed into a wall: stunned — this is the punish window
          this.setState('stunned');
          world.audio.play('boom');
        }
        break;
      }
      case 'stunned':
        if (this.stateTime >= 1.2) {
          this.attackCooldown = 3.5;
          this.setState('chase');
        }
        break;
      default:
        this.setState('chase');
    }
  }
}
