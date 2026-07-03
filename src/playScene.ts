// The gameplay orchestrator: owns the current floor, all entities, corruption,
// inventory, fog of war. Implements the World interface entities talk to.

import {
  TILE, FINAL_DEPTH, VISION_RADIUS, FOG_RECOMPUTE_HZ,
  STAIRS_CLEANSE, PURITY_POTION_CLEANSE, ELIXIR_CLEANSE,
  CORRUPT_VARIANT_TIER, CORRUPT_VARIANT_CHANCE, CORRUPT_HIT_POINTS,
  PLAYER_MAX_HP_CAP, PLAYER_START_HP, VIEW_W, VIEW_H,
  ARROW_SPEED, ARROW_DAMAGE, BOW_COOLDOWN, BOMB_THROW_DIST,
  BOLT_DAMAGE, BOLT_SPEED, NOVA_RADIUS, NOVA_DAMAGE,
  HASTE_DURATION, STONESKIN_DURATION, BLINK_DIST, CLEANSE_CORRUPTION,
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
import { aabbOverlap, knockbackVector, swingDamage, swingArcHits, resolveAimDir, castThrow } from './combat';
import {
  newCorruptionState, tickCorruption, addCorruption, cleanse,
  computeMutationEffects, mergeEffects, neutralEffects, MUTATIONS,
} from './corruption';
import type { CorruptionState, MutationEffects } from './corruption';
import { buildCharacter, identityOf, randomCharacter, RACES } from './character';
import type { CharacterDef } from './character';
import { Inventory, ITEMS } from './items';
import type { ItemId } from './items';
import { Renderer, FOG_HIDDEN, FOG_EXPLORED, FOG_VISIBLE } from './render';
import { Hud } from './hud';
import type { AudioPort } from './audio';
import { SPELLS, Spellbook, Hotbar } from './spells';
import type { SpellId, HotbarEntry } from './spells';
import { InventoryWindow } from './inventoryUi';

interface Bomb {
  x: number;
  y: number;
  fuse: number;
}

interface BoomFx {
  x: number;
  y: number;
  age: number;
  radius: number;
  color: string; // 'r, g, b'
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
  private corruption: CorruptionState;
  private inventory = new Inventory();
  private spellbook = new Spellbook();
  private hotbar = new Hotbar();
  private window = new InventoryWindow();
  private character: CharacterDef;
  private baseFx: MutationEffects = neutralEffects();
  private baseMaxHp: number;
  private fx: MutationEffects;
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
    character?: CharacterDef,
  ) {
    this.rng = new Rng(seed);
    this.depth = startDepth;
    this.character = character ?? randomCharacter(this.rng);
    this.floor = generateFloor(seed, this.depth);
    this.fog = new Uint8Array(this.floor.w * this.floor.h).fill(FOG_HIDDEN);
    this.player = new Player(
      this.floor.spawn.x * TILE + 3,
      this.floor.spawn.y * TILE + 2,
    );

    // apply the character build
    const build = buildCharacter(this.character);
    this.baseFx = build.fx;
    this.fx = this.baseFx;
    this.baseMaxHp = Math.max(2, Math.min(PLAYER_MAX_HP_CAP, this.player.maxHp + build.fx.maxHpDelta));
    this.player.maxHp = this.baseMaxHp;
    this.player.hp = this.baseMaxHp;
    this.spellbook.maxMana = Math.max(2, this.spellbook.maxMana + build.maxManaDelta);
    this.spellbook.mana = this.spellbook.maxMana;
    this.spellbook.regenMult = build.manaRegenMult;
    this.spellbook.costReduction = build.spellCostReduction;
    this.corruption = newCorruptionState(build.graces);
    for (const spell of build.spells) {
      this.spellbook.learn(spell);
      this.hotbar.autoAssign({ kind: 'spell', id: spell });
    }
    for (const item of build.items) {
      this.inventory.add(item);
      if (ITEMS[item].kind === 'consumable') this.hotbar.autoAssign({ kind: 'item', id: item });
    }
    if (build.bow) this.inventory.hasBow = true;
    this.inventory.arrows += build.arrows;

    this.populateFloor();
  }

  enter(game: Game): void {
    this.audio = game.audio;
    this.hud.push(`${identityOf(this.character)} descends.`);
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
      identity: identityOf(this.character),
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
    // Inventory/spellbook window pauses the world (the corruption clock included)
    if (input.inventory || (this.window.open && input.pause)) this.window.toggle();
    if (this.window.open) {
      this.hud.update(dt);
      const action = this.window.update(input, this.inventory, this.spellbook, this.hotbar);
      if (action) {
        this.window.toggle(); // close so the effect (throw/bolt aim) reads naturally
        this.activateEntry(action.entry, game);
      }
      return;
    }

    this.time += dt;
    this.hud.update(dt);
    this.spellbook.regen(dt);
    if (this.flashT > 0) this.flashT -= dt;

    // Corruption is the clock: always ticking
    const events = tickCorruption(this.corruption, dt, this.depth, this.fx.corruptionRateMult, this.rng);
    this.handleCorruptionEvents(events, game);
    if (this.ending) return;

    // Aim: right stick > mouse pointer > facing. Resolved before the player
    // update so melee swings started this tick sweep toward the cursor.
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

    this.player.update(dt, input, this, this.fx, aim.x, aim.y);
    this.aggroBonus = this.fx.aggroDelta;

    // Hotbar: 1-9 direct, Q cycles the gamepad cursor, E activates it
    if (input.cycleItem) this.hotbar.cycle();
    if (input.hotkey !== null) {
      const entry = this.hotbar.get(input.hotkey - 1);
      if (entry) {
        this.hotbar.selected = input.hotkey - 1;
        this.activateEntry(entry, game);
      }
    } else if (input.useItem) {
      const entry = this.hotbar.get(this.hotbar.selected);
      if (entry) this.activateEntry(entry, game);
    }
    if (input.fire) this.tryFireBow();

    // Enemies
    for (const e of this.enemies) e.update(dt, this);

    // Player sword vs enemies: sector test around the aimed swing direction
    const arc = this.player.activeSwing();
    if (arc && this.player.swing) {
      const reach = this.inventory.weaponStats.reach;
      const dmg = swingDamage(this.inventory.weaponStats.damage, this.fx.damageBonus);
      for (const e of this.enemies) {
        if (e.dead || this.player.swing.hitIds.has(e)) continue;
        if (!swingArcHits(arc.cx, arc.cy, arc.dirX, arc.dirY, reach, e.rect())) continue;
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
      const def = ITEMS[p.item];
      if (def.kind === 'tome') {
        p.dead = true;
        this.hud.push(def.pickupMessage);
        if (def.spell && this.spellbook.learn(def.spell)) {
          this.hotbar.autoAssign({ kind: 'spell', id: def.spell });
          this.hud.push(SPELLS[def.spell].learnMessage);
        }
        this.audio.play('mutation');
        continue;
      }
      if (this.inventory.add(p.item)) {
        p.dead = true;
        this.hud.push(def.pickupMessage);
        if (def.kind === 'consumable') this.hotbar.autoAssign({ kind: 'item', id: p.item });
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
      if (ev.type === 'grace') {
        this.hud.push('Your blessing holds the chaos at bay!');
        this.audio.play('unlock');
        this.flashT = 0.25;
        this.flashColor = '#ffd040';
        continue;
      }
      // mutation
      const def = MUTATIONS[ev.mutation];
      this.hud.push(def.message);
      this.audio.play('mutation');
      this.flashT = 0.35;
      this.flashColor = '#ff20d0';
      this.fx = mergeEffects(this.baseFx, computeMutationEffects(this.corruption.mutations));
      // apply max-hp change, clamping current hp
      const newMax = Math.min(PLAYER_MAX_HP_CAP, Math.max(2, PLAYER_START_HP + this.fx.maxHpDelta));
      this.player.maxHp = newMax;
      this.player.hp = Math.min(this.player.hp, newMax);
    }
  }

  private damagePlayer(dmg: number, srcX: number, srcY: number, corrupted: boolean, game: Game): boolean {
    // Stoneskin absorbs 1 damage per hit
    if (this.player.stoneskinT > 0) dmg = Math.max(0, dmg - 1);
    if (dmg === 0) {
      if (this.player.invulnerable) return false;
      // hit was fully absorbed: brief i-frames, no hurt state
      this.player.iframes = 0.4;
      this.audio.play('hit');
      return true;
    }
    if (!this.player.takeDamage(dmg)) return false;
    const kb = knockbackVector(srcX, srcY, this.player.cx, this.player.cy, this.fx.knockbackTakenMult);
    this.player.applyKnockback(kb.x, kb.y);
    this.audio.play('hurt');
    this.flashT = 0.15;
    this.flashColor = '#ff3030';
    if (corrupted) {
      const events = addCorruption(this.corruption, CORRUPT_HIT_POINTS, this.rng);
      this.handleCorruptionEvents(events, game);
      if (!this.player.poisoned) {
        this.player.applyPoison();
        this.hud.push('Corruption burns in the wound. You are poisoned!');
      }
    }
    return true;
  }

  private activateEntry(entry: HotbarEntry, game: Game): void {
    if (entry.kind === 'item') this.useItem(entry.id, game);
    else this.castSpell(entry.id, game);
  }

  private useItem(id: ItemId, game: Game): void {
    if (!this.inventory.use(id)) return;
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

  private castSpell(id: SpellId, game: Game): void {
    if (!this.spellbook.knows(id)) return;
    if (!this.spellbook.spend(id)) {
      this.hud.push('Not enough mana.');
      return;
    }
    switch (id) {
      case 'chaosBolt':
        this.spawnProjectile({
          x: this.player.cx + this.aimDirX * 6,
          y: this.player.cy + this.aimDirY * 6,
          vx: this.aimDirX * BOLT_SPEED,
          vy: this.aimDirY * BOLT_SPEED,
          size: 5,
          damage: BOLT_DAMAGE,
          corrupted: false,
          friendly: true,
          bolt: true,
          dead: false,
        });
        this.audio.play('shoot');
        break;
      case 'nova': {
        this.booms.push({ x: this.player.cx, y: this.player.cy, age: 0, radius: NOVA_RADIUS, color: '255, 208, 96' });
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.cx - this.player.cx, e.cy - this.player.cy) <= NOVA_RADIUS + 4) {
            e.iframes = 0;
            e.takeDamage(NOVA_DAMAGE);
            const kb = knockbackVector(this.player.cx, this.player.cy, e.cx, e.cy, this.fx.knockbackDealtMult * 1.3);
            e.applyKnockback(kb.x, kb.y);
          }
        }
        this.audio.play('boom');
        break;
      }
      case 'haste':
        this.player.hasteT = HASTE_DURATION;
        this.hud.push('The world slows around you.');
        this.audio.play('potion');
        break;
      case 'stoneskin':
        this.player.stoneskinT = STONESKIN_DURATION;
        this.hud.push('Your skin turns to living granite.');
        this.audio.play('potion');
        break;
      case 'cleanse':
        this.player.curePoison();
        cleanse(this.corruption, CLEANSE_CORRUPTION * this.fx.purityMult);
        this.hud.push('Cool light washes the venom from your veins.');
        this.audio.play('potion');
        break;
      case 'blink': {
        this.booms.push({ x: this.player.cx, y: this.player.cy, age: 0.15, radius: 12, color: '64, 192, 208' });
        // step the full distance through moveAndCollide so the hitbox can never clip a wall
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          moveAndCollide(this.player, (this.aimDirX * BLINK_DIST) / steps, (this.aimDirY * BLINK_DIST) / steps, this);
        }
        this.player.iframes = Math.max(this.player.iframes, 0.2);
        this.booms.push({ x: this.player.cx, y: this.player.cy, age: 0.1, radius: 12, color: '64, 192, 208' });
        this.audio.play('stairs');
        break;
      }
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
    this.booms.push({ x: b.x, y: b.y, age: 0, radius: BOMB_RADIUS, color: '255, 160, 40' });
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
      const race = RACES[this.character.race];
      this.renderer = new Renderer(ctx, {
        skin: race.skin,
        hair: race.hair,
        longHair: this.character.gender === 'female',
      });
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

    const swingArc = this.player.activeSwing();
    if (swingArc) {
      r.drawSwingArc(swingArc.cx, swingArc.cy, swingArc.dirX, swingArc.dirY, this.inventory.weaponStats.reach);
    }

    for (const fx of this.booms) {
      r.drawBombFx(fx.x, fx.y, fx.radius * (0.5 + fx.age * 2), 0.6 - fx.age * 1.5, fx.color);
    }

    // aim indicator (bow, bombs, and aimed spells all use it)
    if (this.aimIsPointer) {
      r.drawCrosshair(this.aimPointerWorldX, this.aimPointerWorldY);
    } else {
      r.drawAimArrow(this.player.cx, this.player.cy, this.aimDirX, this.aimDirY);
    }

    r.drawCorruptionVignette(this.corruption.points, this.time);
    if (this.flashT > 0) r.flashScreen(this.flashColor, Math.min(0.5, this.flashT * 2));

    this.hud.render(
      ctx, r.atlas, this.player, this.corruption, this.depth,
      this.inventory, this.spellbook, this.hotbar, this.time,
    );

    if (this.window.open) {
      this.window.render(ctx, r.atlas, this.inventory, this.spellbook, this.hotbar);
    }
  }
}

// re-export for main.ts dev tooling
export { moveAndCollide };
