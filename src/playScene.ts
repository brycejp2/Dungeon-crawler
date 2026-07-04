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
  WORLD_VISION_RADIUS, WILD_SPAWN_INTERVAL, WILD_SPAWN_CAP,
  SHRINE_CLEANSE, SHRINE_USES, HEALER_COOLDOWN,
} from './config';
import type { Game, Scene, SceneFlow, RunStats } from './game';
import type { InputState } from './input';
import { Rng } from './rng';
import {
  Tile, generateFloor, isSolid, hasLineOfSight, inRoom,
} from './dungeon';
import type { FloorData, FloorOpts, Pt } from './dungeon';
import { generateWorld, CHAOS_EVENTS, villageIntact } from './world';
import type { WorldData, Village } from './world';
import { Player, Enemy, moveAndCollide } from './entities';
import type { World, Projectile, Pickup } from './entities';
import { aabbOverlap, knockbackVector, swingDamage, swingArcHits, resolveAimDir, castThrow } from './combat';
import {
  newCorruptionState, tickCorruption, addCorruption, cleanse,
  computeMutationEffects, mergeEffects, neutralEffects, MUTATIONS,
} from './corruption';
import type { CorruptionState, MutationEffects } from './corruption';
import { buildCharacter, identityOf, randomCharacter, RACES } from './character';
import { newProgression, grantXp, xpForKill, type LevelUpBoon } from './progression';
import type { CharacterDef } from './character';
import { Inventory, ITEMS } from './items';
import type { ItemId } from './items';
import {
  FRIENDLY_NAMES, PRIEST_CLEANSE, PRIEST_PRICE, QUESTS,
  castleStock, goldDropFor, hermitGift, hermitHint, merchantStock,
} from './friendly';
import type { FriendlyKind, QuestProgress, ShopEntry } from './friendly';
import { Renderer, FOG_HIDDEN, FOG_EXPLORED, FOG_VISIBLE } from './render';
import { Hud, drawDialogPanel } from './hud';
import type { AudioPort } from './audio';
import { SPELLS, Spellbook, Hotbar } from './spells';
import type { SpellId, HotbarEntry } from './spells';
import { InventoryWindow } from './inventoryUi';
import { writeSave, clearSave, getSettings, missingIndices } from './storage';
import type { RunSave, SiteSave } from './storage';

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

type DungeonId = 'gate' | 'barrow' | 'mine';

interface DungeonDef {
  name: string;
  floors: number;
  seedSalt: number;
  opts(depth: number): FloorOpts;
}

const DUNGEONS: Record<DungeonId, DungeonDef> = {
  gate: {
    name: 'Chaos Gate', floors: FINAL_DEPTH, seedSalt: 0,
    opts: () => ({}),
  },
  barrow: {
    name: 'Haunted Barrow', floors: 3, seedSalt: 0x9d2c5680,
    opts: (depth) => ({
      bossFloor: false, schedule: false, lastFloor: depth >= 3,
      extraLoot: depth >= 3 ? ['sword2', 'elixir', 'purityPotion'] : undefined,
    }),
  },
  mine: {
    name: 'Old Mine', floors: 3, seedSalt: 0x2545f491,
    opts: (depth) => ({
      bossFloor: false, schedule: false, lastFloor: depth >= 3,
      extraLoot: depth >= 3 ? ['bomb', 'bomb', 'arrows', 'arrows', 'healPotion'] : undefined,
    }),
  },
};

interface Npc {
  x: number;
  y: number;
  w: number;
  h: number;
  wanderX: number;
  wanderY: number;
  wanderTimer: number;
  village: 'home' | 'far' | 'castle' | null; // null = lives in a dungeon
  kind: 'villager' | FriendlyKind;
  line: string;
  stock?: ShopEntry[]; // merchants
  hint?: string; // hermits
  giftGiven?: boolean; // hermits hand over a little gold once
  spawnId?: number; // index into the floor's friendly spawns (dungeon NPCs)
}

/** A modal talk/trade menu; the world (and corruption clock) pauses under it. */
interface NpcDialog {
  title: string;
  lines: string[];
  choices: { label: string; dim?: boolean; pick: (() => void) | null }[]; // null pick = leave
  cursor: number;
}

/** A visited map with its live contents; sites persist for the whole run. */
interface SiteState {
  floor: FloorData;
  fog: Uint8Array;
  enemies: Enemy[];
  pickups: Pickup[];
  npcs: Npc[];
  doorsOpen: boolean; // key already used on this floor
  rubbleCleared: Pt[]; // rubble tiles blown open by bombs
}

type SiteRef = { kind: 'world' } | { kind: 'dungeon'; id: DungeonId; depth: number };

const TRANSITION_TILES = new Set<Tile>([
  Tile.StairsUp, Tile.StairsDown, Tile.GateEntrance, Tile.CaveEntrance, Tile.MineEntrance,
]);

export class PlayScene implements Scene, World {
  readonly rng: Rng;
  audio!: AudioPort;
  player: Player;
  aggroBonus = 0;

  private floor!: FloorData;
  private depth = 0; // 0 = overworld; otherwise current dungeon floor
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private bombs: Bomb[] = [];
  private booms: BoomFx[] = [];
  private fog!: Uint8Array;
  // --- overworld / site registry ---
  private readonly baseSeed: number;
  private world!: WorldData;
  private sites = new Map<string, SiteState>();
  private site: SiteRef = { kind: 'world' };
  private cur!: SiteState;
  private npcs: Npc[] = [];
  private deepestGate = 0;
  private appliedChaosTier = 0;
  private shrineUses = new Map<string, number>();
  private healerTimes = new Map<string, number>();
  private wildTimer = WILD_SPAWN_INTERVAL;
  private contextHint = '';
  private dialog: NpcDialog | null = null;
  private questIdx = 0; // next quest in the captain's chain
  private questActive: QuestProgress | null = null;
  private questNotified = false;
  private corruption: CorruptionState;
  private inventory = new Inventory();
  private spellbook = new Spellbook();
  private hotbar = new Hotbar();
  private window = new InventoryWindow();
  private character: CharacterDef;
  private baseFx: MutationEffects = neutralEffects();
  private baseMaxHp: number;
  private fx: MutationEffects;
  private progression = newProgression();
  private levelHpBonus = 0; // half-hearts from level-ups
  private levelDamageBonus = 0; // permanent melee bonus from level-ups
  private hud = new Hud();
  private renderer: Renderer | null = null;
  private time = 0;
  private fogTimer = 0;
  private kills = 0;
  private flashT = 0;
  private flashColor = '#fff';
  private ending = false;
  private restoring = false; // suppresses first-descent cleanse during resume
  private paused = false;
  private pauseCursor = 0;
  // aim state (recomputed every tick, read by render)
  private aimDirX = 0;
  private aimDirY = 1;
  private aimIsPointer = false;
  private aimPointerWorldX = 0;
  private aimPointerWorldY = 0;

  constructor(
    private readonly flow: SceneFlow,
    seed: number,
    startDepth = 0,
    character?: CharacterDef,
    save?: RunSave,
  ) {
    const effectiveSeed = save ? save.seed : seed;
    this.rng = new Rng(effectiveSeed);
    this.baseSeed = effectiveSeed;
    this.character = save ? save.character : (character ?? randomCharacter(this.rng));
    this.player = new Player(0, 0);

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

    // The overworld always exists (chaos events land on it even from below)
    this.createWorldSite();
    if (save) {
      this.restoreFrom(save);
    } else if (startDepth >= 1) {
      // dev shortcut: start inside the Chaos Gate
      this.activateSite(
        { kind: 'dungeon', id: 'gate', depth: Math.min(startDepth, DUNGEONS.gate.floors) },
        null,
      );
    } else {
      this.activateSite({ kind: 'world' }, this.world.spawn);
    }
  }

  enter(game: Game): void {
    this.audio = game.audio;
    this.hud.push(`${identityOf(this.character)} takes up the quest.`);
    this.hud.push(
      this.site.kind === 'world'
        ? 'Seal the Chaos Gate before the corruption consumes the land.'
        : 'The dungeon seethes with chaos. Hurry.',
    );
    this.recomputeFog();
  }

  // --- save / resume (Continue) ---

  private readonly pauseOptions = ['Resume', 'Save & Quit', 'Abandon Run'];

  /** Snapshot the live run for Continue, or null if the run has already ended. */
  serialize(): RunSave | null {
    if (this.ending) return null;
    const site: RunSave['site'] =
      this.site.kind === 'world'
        ? { kind: 'world' }
        : { kind: 'dungeon', id: this.site.id, depth: this.site.depth };
    return {
      version: 1,
      savedAt: Date.now(),
      seed: this.baseSeed,
      character: this.character,
      site,
      player: {
        x: this.player.x, y: this.player.y, hp: this.player.hp, maxHp: this.player.maxHp,
        facing: this.player.facing, hasteT: this.player.hasteT, stoneskinT: this.player.stoneskinT,
        poisoned: this.player.poisoned,
      },
      inventory: {
        weapon: this.inventory.weapon, hasKey: this.inventory.hasKey, hasBow: this.inventory.hasBow,
        arrows: this.inventory.arrows, gold: this.inventory.gold,
        counts: this.inventory.snapshotCounts(),
      },
      spellbook: {
        known: [...this.spellbook.known], mana: this.spellbook.mana, maxMana: this.spellbook.maxMana,
      },
      hotbar: {
        slots: this.hotbar.slots.map((s) => (s ? { ...s } : null)),
        selected: this.hotbar.selected,
      },
      corruption: {
        points: this.corruption.points, tierReached: this.corruption.tierReached,
        mutations: [...this.corruption.mutations], graces: this.corruption.graces,
      },
      progression: { level: this.progression.level, xp: this.progression.xp },
      levelHpBonus: this.levelHpBonus,
      levelDamageBonus: this.levelDamageBonus,
      kills: this.kills,
      time: this.time,
      deepestGate: this.deepestGate,
      appliedChaosTier: this.appliedChaosTier,
      shrineUses: [...this.shrineUses.entries()],
      healerTimes: [...this.healerTimes.entries()],
      quest: {
        idx: this.questIdx,
        activeId: this.questActive ? this.questActive.def.id : null,
        killsAtAccept: this.questActive ? this.questActive.killsAtAccept : 0,
        notified: this.questNotified,
      },
      sites: this.serializeSites(),
    };
  }

  /** A stable key for an NPC's persisted state (village for town shops, spawn index below). */
  private npcKey(n: Npc): string {
    return n.village ? `m:${n.village}` : `i:${n.spawnId ?? -1}`;
  }

  /** Per-map deltas: surviving base enemies/pickups, opened doors, blown rubble, shop state. */
  private serializeSites(): SiteSave[] {
    const out: SiteSave[] = [];
    for (const [key, site] of this.sites) {
      const baseCount = site.floor.itemSpawns.length + site.floor.goldSpawns.length;
      const alivePickupIds = site.pickups
        .filter((p) => p.spawnId !== undefined && p.spawnId >= 0 && !p.dead)
        .map((p) => p.spawnId!);
      out.push({
        key,
        enemies: site.enemies
          .filter((e) => e.spawnId >= 0 && !e.dead)
          .map((e) => ({ idx: e.spawnId, hp: e.hp, corrupted: e.corrupted })),
        takenPickups: missingIndices(baseCount, alivePickupIds),
        doorsOpen: site.doorsOpen,
        rubbleCleared: site.rubbleCleared.map((p) => [p.x, p.y] as [number, number]),
        npcs: site.npcs
          .filter((n) => n.kind === 'merchant' || n.kind === 'hermit')
          .map((n) => ({
            key: this.npcKey(n),
            giftGiven: !!n.giftGiven,
            stock: n.stock ? n.stock.map((s) => ({ ...s })) : null,
          })),
      });
    }
    return out;
  }

  /** Parse a site key back into a SiteRef. */
  private refFromKey(key: string): SiteRef {
    if (key === 'world') return { kind: 'world' };
    const [id, depth] = key.split(':');
    return { kind: 'dungeon', id: id as DungeonId, depth: Number(depth) };
  }

  /** Re-create every visited map and re-apply its saved deltas. */
  private restoreSites(saves: SiteSave[]): void {
    for (const saved of saves) {
      const ref = this.refFromKey(saved.key);
      const { site } = this.getOrCreateSite(ref);
      const depth = ref.kind === 'dungeon' ? ref.depth : 1;

      // enemies: rebuild only the survivors (dead base enemies stay dead)
      const alive = new Map(saved.enemies.map((e) => [e.idx, e]));
      const rebuilt: Enemy[] = [];
      site.floor.enemySpawns.forEach((s, i) => {
        const rec = alive.get(i);
        if (!rec) return;
        const e = new Enemy(s.kind, 0, 0, rec.corrupted, depth, this.corruption.tierReached);
        e.x = s.x * TILE + (TILE - e.w) / 2;
        e.y = s.y * TILE + (TILE - e.h) / 2;
        e.hp = rec.hp;
        e.spawnId = i;
        rebuilt.push(e);
      });
      site.enemies = rebuilt;

      // pickups: drop the ones already collected
      const taken = new Set(saved.takenPickups);
      site.pickups = site.pickups.filter(
        (p) => p.spawnId === undefined || p.spawnId < 0 || !taken.has(p.spawnId),
      );

      // opened doors and blown rubble
      if (saved.doorsOpen) {
        for (const d of site.floor.doors) site.floor.tiles[d.y * site.floor.w + d.x] = Tile.Floor;
        site.floor.doors.length = 0;
        site.doorsOpen = true;
      }
      for (const [x, y] of saved.rubbleCleared) {
        if (site.floor.tiles[y * site.floor.w + x] === Tile.Rubble) {
          site.floor.tiles[y * site.floor.w + x] = Tile.Floor;
        }
        site.rubbleCleared.push({ x, y });
      }

      // merchant stock / hermit gifts
      const byKey = new Map(saved.npcs.map((n) => [n.key, n]));
      for (const n of site.npcs) {
        const rec = byKey.get(this.npcKey(n));
        if (!rec) continue;
        n.giftGiven = rec.giftGiven;
        if (rec.stock) n.stock = rec.stock.map((s) => ({ ...s }));
      }
    }
  }

  /**
   * Rebuild a suspended run. Maps regenerate deterministically from the seed
   * and then each visited floor's saved deltas are re-applied (cleared enemies
   * stay dead, collected loot stays gone, doors stay open, shops keep their
   * depleted stock), while all of the player's progress — level, gold,
   * inventory, corruption, mutations, quest — is restored exactly and the
   * player is placed where they left off.
   */
  private restoreFrom(save: RunSave): void {
    this.restoring = true;

    // decay the overworld to match how far the chaos had spread
    this.reapplyChaosForRestore(save.appliedChaosTier);
    this.appliedChaosTier = save.appliedChaosTier;

    // corruption first, so derived stats recompute from the right mutations
    this.corruption.points = save.corruption.points;
    this.corruption.tierReached = save.corruption.tierReached;
    this.corruption.mutations = [...save.corruption.mutations];
    this.corruption.graces = save.corruption.graces;
    this.fx = mergeEffects(this.baseFx, computeMutationEffects(this.corruption.mutations));

    this.progression.level = save.progression.level;
    this.progression.xp = save.progression.xp;
    this.levelHpBonus = save.levelHpBonus;
    this.levelDamageBonus = save.levelDamageBonus;

    this.inventory.weapon = save.inventory.weapon;
    this.inventory.hasKey = save.inventory.hasKey;
    this.inventory.hasBow = save.inventory.hasBow;
    this.inventory.arrows = save.inventory.arrows;
    this.inventory.gold = save.inventory.gold;
    this.inventory.setCounts(save.inventory.counts);

    this.spellbook.known.length = 0;
    for (const id of save.spellbook.known) this.spellbook.learn(id);
    this.spellbook.maxMana = save.spellbook.maxMana;
    this.spellbook.mana = Math.min(save.spellbook.mana, save.spellbook.maxMana);

    for (let i = 0; i < this.hotbar.slots.length; i++) {
      const s = save.hotbar.slots[i];
      this.hotbar.slots[i] = s ? { ...s } : null;
    }
    this.hotbar.selected = save.hotbar.selected;

    this.kills = save.kills;
    this.time = save.time;
    this.deepestGate = save.deepestGate;
    this.shrineUses = new Map(save.shrineUses);
    this.healerTimes = new Map(save.healerTimes);

    this.questIdx = save.quest.idx;
    this.questNotified = save.quest.notified;
    this.questActive = null;
    if (save.quest.activeId) {
      const def = QUESTS.find((q) => q.id === save.quest.activeId);
      if (def) this.questActive = { def, killsAtAccept: save.quest.killsAtAccept };
    }

    // re-create every visited map and re-apply its cleared-state deltas, so
    // dead enemies stay dead and collected loot stays collected on return
    // (older saves predate per-map deltas — fall back to fresh maps)
    this.restoreSites(save.sites ?? []);

    // enter the saved site (already rebuilt above), then pin the player where they were
    const ref: SiteRef = save.site.kind === 'world'
      ? { kind: 'world' }
      : { kind: 'dungeon', id: save.site.id as DungeonId, depth: save.site.depth };
    this.activateSite(ref, null);
    this.player.x = save.player.x;
    this.player.y = save.player.y;
    this.player.maxHp = save.player.maxHp;
    this.player.hp = save.player.hp;
    this.player.facing = save.player.facing as Player['facing'];
    this.player.hasteT = save.player.hasteT;
    this.player.stoneskinT = save.player.stoneskinT;
    if (save.player.poisoned) this.player.applyPoison();
    this.recomputeFog();

    this.restoring = false;
  }

  /** Re-run chaos map mutations (terrain decay, fallen far village) up to a tier. */
  private reapplyChaosForRestore(tier: number): void {
    if (tier <= 0) return;
    const rng = new Rng((this.baseSeed ^ 0x00c0ffee) >>> 0);
    for (let i = 0; i < tier && i < CHAOS_EVENTS.length; i++) {
      CHAOS_EVENTS[i]!.apply(this.world, rng);
    }
    const worldSite = this.sites.get('world');
    if (worldSite) worldSite.npcs = this.worldNpcsFromSpawns();
  }

  private updatePauseMenu(input: InputState, game: Game): void {
    if (input.pause) {
      this.paused = false;
      return;
    }
    if (input.menuUp) this.pauseCursor = (this.pauseCursor + this.pauseOptions.length - 1) % this.pauseOptions.length;
    if (input.menuDown) this.pauseCursor = (this.pauseCursor + 1) % this.pauseOptions.length;
    const confirm = input.interact || input.click || (input.attack && !input.click);
    if (!confirm) return;
    switch (this.pauseCursor) {
      case 0:
        this.paused = false;
        break;
      case 1: {
        const save = this.serialize();
        if (save) writeSave(save);
        game.switchScene(this.flow.title());
        break;
      }
      case 2:
        clearSave();
        game.switchScene(this.flow.title());
        break;
      default:
        break;
    }
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

  // --- sites: the overworld and every dungeon floor, persistent for the run ---

  private siteKey(ref: SiteRef): string {
    return ref.kind === 'world' ? 'world' : `${ref.id}:${ref.depth}`;
  }

  private createWorldSite(): void {
    this.world = generateWorld(this.baseSeed);
    const site: SiteState = {
      floor: this.world,
      fog: new Uint8Array(this.world.w * this.world.h).fill(FOG_HIDDEN),
      enemies: [],
      pickups: [],
      npcs: [],
      doorsOpen: false,
      rubbleCleared: [],
    };
    this.world.enemySpawns.forEach((s, i) => {
      const e = new Enemy(s.kind, 0, 0, false, 1, this.corruption.tierReached);
      e.x = s.x * TILE + (TILE - e.w) / 2;
      e.y = s.y * TILE + (TILE - e.h) / 2;
      e.spawnId = i;
      site.enemies.push(e);
    });
    this.pushBasePickups(site, this.world);
    site.npcs = this.worldNpcsFromSpawns();
    this.sites.set('world', site);
  }

  /** Build the overworld NPC list from the (possibly chaos-thinned) spawns. */
  private worldNpcsFromSpawns(): Npc[] {
    return this.world.npcSpawns.map((n, i) => ({
      x: n.x * TILE + 3, y: n.y * TILE + 2, w: 10, h: 12,
      wanderX: n.x * TILE, wanderY: n.y * TILE,
      wanderTimer: this.rng.range(0.5, 3),
      village: n.village, kind: n.kind, line: n.line,
      spawnId: i,
      stock:
        n.kind === 'merchant'
          ? n.village === 'castle' ? castleStock(this.rng) : merchantStock(0, this.rng)
          : undefined,
    }));
  }

  /** Add a floor's fixed item and gold pickups, tagged with stable spawn ids. */
  private pushBasePickups(site: SiteState, floor: FloorData): void {
    let id = 0;
    for (const s of floor.itemSpawns) {
      site.pickups.push({ item: s.item, x: s.x * TILE + 3, y: s.y * TILE + 3, dead: false, spawnId: id++ });
    }
    for (const s of floor.goldSpawns) {
      site.pickups.push({ item: null, gold: s.amount, x: s.x * TILE + 3, y: s.y * TILE + 3, dead: false, spawnId: id++ });
    }
  }

  private getOrCreateSite(ref: SiteRef): { site: SiteState; isNew: boolean } {
    const key = this.siteKey(ref);
    const existing = this.sites.get(key);
    if (existing) return { site: existing, isNew: false };
    if (ref.kind === 'world') throw new Error('world site must exist');
    const def = DUNGEONS[ref.id];
    const floor = generateFloor((this.baseSeed ^ def.seedSalt) >>> 0, ref.depth, def.opts(ref.depth));
    const site: SiteState = {
      floor,
      fog: new Uint8Array(floor.w * floor.h).fill(FOG_HIDDEN),
      enemies: [],
      pickups: [],
      npcs: [],
      doorsOpen: false,
      rubbleCleared: [],
    };
    const tier = this.corruption.tierReached;
    floor.enemySpawns.forEach((s, i) => {
      const corrupted =
        s.kind !== 'boss' && tier >= CORRUPT_VARIANT_TIER && this.rng.chance(CORRUPT_VARIANT_CHANCE);
      const e = new Enemy(s.kind, 0, 0, corrupted, ref.depth, tier);
      e.x = s.x * TILE + (TILE - e.w) / 2;
      e.y = s.y * TILE + (TILE - e.h) / 2;
      e.spawnId = i;
      site.enemies.push(e);
    });
    this.pushBasePickups(site, floor);
    // friendly encounters waiting in the dark
    floor.friendlySpawns.forEach((s, i) => {
      site.npcs.push({
        x: s.x * TILE + 3, y: s.y * TILE + 2, w: 10, h: 12,
        wanderX: s.x * TILE, wanderY: s.y * TILE, wanderTimer: 0,
        village: null, kind: s.kind, line: '',
        spawnId: i,
        stock: s.kind === 'merchant' ? merchantStock(ref.depth, this.rng) : undefined,
        hint: s.kind === 'hermit' ? hermitHint(this.rng) : undefined,
        giftGiven: false,
      });
    });
    this.sites.set(key, site);
    return { site, isNew: true };
  }

  private activateSite(ref: SiteRef, arriveAt: Pt | null): void {
    // transient effects never follow through a transition
    this.projectiles = [];
    this.bombs = [];
    this.booms = [];
    const { site, isNew } = this.getOrCreateSite(ref);
    this.site = ref;
    this.cur = site;
    this.floor = site.floor;
    this.fog = site.fog;
    this.enemies = site.enemies;
    this.pickups = site.pickups;
    this.npcs = site.npcs;
    this.depth = ref.kind === 'dungeon' ? ref.depth : 0;
    if (ref.kind === 'dungeon' && ref.id === 'gate') {
      this.deepestGate = Math.max(this.deepestGate, ref.depth);
    }
    // pressing deeper for the first time steadies the mind a little
    if (ref.kind === 'dungeon' && isNew && ref.depth > 1 && !this.restoring) {
      cleanse(this.corruption, STAIRS_CLEANSE);
    }
    this.placePlayerNear(arriveAt ?? site.floor.spawn);
    this.player.kx = 0;
    this.player.ky = 0;
    this.recomputeFog();
    this.renderer?.camera.setBounds(this.floor.w, this.floor.h);
    this.renderer?.camera.snapTo(this.player.cx, this.player.cy);
  }

  /** Stand the player next to a target tile without touching transition tiles. */
  private placePlayerNear(t: Pt): void {
    const spots = [
      { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
      { x: 0, y: 0 },
    ];
    for (const d of spots) {
      const tx = t.x + d.x;
      const ty = t.y + d.y;
      if (tx < 0 || ty < 0 || tx >= this.floor.w || ty >= this.floor.h) continue;
      const tile = this.floor.tiles[ty * this.floor.w + tx] as Tile;
      if (isSolid(tile)) continue;
      if (TRANSITION_TILES.has(tile) && (d.x !== 0 || d.y !== 0)) continue;
      this.player.x = tx * TILE + 3;
      this.player.y = ty * TILE + 2;
      return;
    }
    this.player.x = t.x * TILE + 3;
    this.player.y = t.y * TILE + 2;
  }

  private enterDungeon(id: DungeonId): void {
    this.audio.play('stairs');
    this.activateSite({ kind: 'dungeon', id, depth: 1 }, null);
    this.hud.push(
      id === 'gate'
        ? 'You step through the Chaos Gate. The air howls.'
        : `You descend into the ${DUNGEONS[id].name}.`,
    );
    if (id === 'gate') this.audio.play('bossRoar');
  }

  private goDown(): void {
    if (this.site.kind !== 'dungeon') return;
    const { id, depth } = this.site;
    if (depth >= DUNGEONS[id].floors) return;
    this.audio.play('stairs');
    this.activateSite({ kind: 'dungeon', id, depth: depth + 1 }, null);
    const atBottom = id === 'gate' && depth + 1 >= FINAL_DEPTH;
    this.hud.push(
      atBottom
        ? 'A dread presence stirs below. This is the last floor.'
        : `You descend to floor ${depth + 1}. The air grows fouler.`,
    );
    if (atBottom) this.audio.play('bossRoar');
  }

  private goUp(): void {
    if (this.site.kind !== 'dungeon') return;
    const { id, depth } = this.site;
    this.audio.play('stairs');
    if (depth <= 1) {
      const entrance = id === 'gate' ? this.world.gate : id === 'barrow' ? this.world.barrow : this.world.mine;
      this.activateSite({ kind: 'world' }, entrance);
      this.hud.push('You climb back into the open air.');
    } else {
      const target: SiteRef = { kind: 'dungeon', id, depth: depth - 1 };
      const { site } = this.getOrCreateSite(target);
      this.activateSite(target, site.floor.downStairs ?? site.floor.spawn);
      this.hud.push(`You climb back to floor ${depth - 1}.`);
    }
  }

  private endRun(game: Game, cause: string, victory: boolean): void {
    if (this.ending) return;
    this.ending = true;
    clearSave(); // the run is over — no suspended save to resume
    const stats: RunStats = {
      identity: identityOf(this.character),
      depth: this.deepestGate,
      level: this.progression.level,
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
    // Pause menu (Resume / Save & Quit / Abandon) freezes everything
    if (this.paused) {
      this.hud.update(dt);
      this.updatePauseMenu(input, game);
      return;
    }

    // Talking or trading pauses the world (the corruption clock included)
    if (this.dialog) {
      this.hud.update(dt);
      this.updateDialog(this.dialog, input);
      return;
    }

    // Inventory/spellbook window pauses the world (the corruption clock included)
    const windowWasOpen = this.window.open;
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
    // Esc with nothing else open opens the pause menu (but not the same Esc
    // that just closed the bag)
    if (input.pause && !windowWasOpen) {
      this.paused = true;
      this.pauseCursor = 0;
      return;
    }

    this.time += dt;
    this.hud.update(dt);
    this.spellbook.regen(dt);
    if (this.flashT > 0) this.flashT -= dt;

    // Corruption is the clock: always ticking (slower under open sky — depth 0)
    const events = tickCorruption(this.corruption, dt, this.depth, this.fx.corruptionRateMult, this.rng);
    this.handleCorruptionEvents(events, game);
    if (this.ending) return;
    this.syncChaosEvents();

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

    // Overworld life: villagers, wandering beasts, shrines and healers
    this.contextHint = '';
    if (this.site.kind === 'world') {
      this.updateNpcs(dt);
      this.updateWilderness(dt);
      this.updateWorldInteractions(input);
    }
    // Friendly folk (merchants, priests, hermits, the captain) live everywhere
    this.updateNpcInteraction(input);

    // Enemies
    for (const e of this.enemies) e.update(dt, this);

    // Player sword vs enemies: sector test around the aimed swing direction
    const arc = this.player.activeSwing();
    if (arc && this.player.swing) {
      const reach = this.inventory.weaponStats.reach;
      const dmg = swingDamage(this.inventory.weaponStats.damage, this.fx.damageBonus + this.levelDamageBonus);
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
      if (p.item === null) {
        p.dead = true;
        this.inventory.gold += p.gold ?? 0;
        this.hud.push(`You scoop up ${p.gold} gold.`);
        this.audio.play('coin');
        continue;
      }
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
          this.cur.doorsOpen = true;
          this.hud.push('The chaos seal shatters. The way is open.');
          this.audio.play('unlock');
          break;
        }
      }
    }

    // Reap the dead: kills grant experience, gold, and quest progress
    for (const e of this.enemies) {
      if (e.dead) {
        this.kills++;
        const boons = grantXp(this.progression, xpForKill(e.kind, e.corrupted, Math.max(1, this.depth)));
        this.applyLevelUps(boons);
        if (e.kind === 'boss') {
          this.audio.play('victory');
          this.endRun(game, 'Slew the Herald of Decay', true);
          return;
        }
        this.pickups.push({
          item: null,
          gold: goldDropFor(this.depth, this.rng),
          x: e.cx - 5,
          y: e.cy - 5,
          dead: false,
        });
        if (
          this.questActive && !this.questNotified &&
          this.kills - this.questActive.killsAtAccept >= this.questActive.def.targetKills
        ) {
          this.questNotified = true;
          this.hud.push('Quest complete! Report to Captain Aldric.');
          this.audio.play('quest');
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.pickups = this.pickups.filter((p) => !p.dead);
    // keep the persistent site pointing at the fresh arrays
    this.cur.enemies = this.enemies;
    this.cur.pickups = this.pickups;

    // Transitions: dungeon entrances on the overworld, stairs below
    const ptile = this.floor.tiles[
      Math.floor(this.player.cy / TILE) * this.floor.w + Math.floor(this.player.cx / TILE)
    ] as Tile;
    if (this.site.kind === 'world') {
      if (ptile === Tile.GateEntrance) {
        this.enterDungeon('gate');
        return;
      }
      if (ptile === Tile.CaveEntrance) {
        this.enterDungeon('barrow');
        return;
      }
      if (ptile === Tile.MineEntrance) {
        this.enterDungeon('mine');
        return;
      }
    } else {
      if (ptile === Tile.StairsDown) {
        this.goDown();
        return;
      }
      if (ptile === Tile.StairsUp) {
        this.goUp();
        return;
      }
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
      this.recomputeMaxHp();
    }
  }

  /** Apply pending chaos-tier world events (village falls, land decays, attacks). */
  private syncChaosEvents(): void {
    while (this.appliedChaosTier < this.corruption.tierReached && this.appliedChaosTier < CHAOS_EVENTS.length) {
      const ev = CHAOS_EVENTS[this.appliedChaosTier]!;
      this.appliedChaosTier++;
      const worldSite = this.sites.get('world')!;
      const spawns = ev.apply(this.world, this.rng);
      // villages that fell lose their people
      worldSite.npcs = worldSite.npcs.filter((n) =>
        this.world.npcSpawns.some((s) => s.village === n.village),
      );
      if (this.site.kind === 'world') this.npcs = worldSite.npcs;
      for (const s of spawns) {
        const e = new Enemy(s.kind, 0, 0, s.corrupted, 1, this.corruption.tierReached);
        e.x = s.x * TILE + (TILE - e.w) / 2;
        e.y = s.y * TILE + (TILE - e.h) / 2;
        worldSite.enemies.push(e);
      }
      this.hud.push(ev.message);
      this.audio.play('bossRoar');
      this.flashT = 0.3;
      this.flashColor = '#ff20d0';
    }
  }

  private updateNpcs(dt: number): void {
    for (const n of this.npcs) {
      if (n.kind !== 'villager') continue; // traders and the captain hold their posts
      n.wanderTimer -= dt;
      if (n.wanderTimer <= 0) {
        n.wanderTimer = this.rng.range(1.5, 4);
        n.wanderX = n.x + this.rng.range(-40, 40);
        n.wanderY = n.y + this.rng.range(-30, 30);
      }
      const dx = n.wanderX - n.x;
      const dy = n.wanderY - n.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) moveAndCollide(n, (dx / len) * 16 * dt, (dy / len) * 16 * dt, this);
    }
  }

  /** Chaos-scaled wandering monsters in the wilderness. */
  private updateWilderness(dt: number): void {
    this.wildTimer -= dt;
    if (this.wildTimer > 0) return;
    const tier = this.corruption.tierReached;
    this.wildTimer = Math.max(6, WILD_SPAWN_INTERVAL - 3 * tier);
    if (this.enemies.length >= WILD_SPAWN_CAP + 2 * tier) return;
    const ptx = Math.floor(this.player.cx / TILE);
    const pty = Math.floor(this.player.cy / TILE);
    for (let tries = 0; tries < 30; tries++) {
      const x = this.rng.int(2, this.world.w - 3);
      const y = this.rng.int(2, this.world.h - 3);
      const d = Math.hypot(x - ptx, y - pty);
      if (d < 13 || d > 24) continue;
      if (isSolid(this.world.tiles[y * this.world.w + x] as Tile)) continue;
      // villages stay safe until the tier-4 assault
      const inVillage =
        inRoom(this.world.homeVillage.bounds, x, y) || inRoom(this.world.farVillage.bounds, x, y);
      if (inVillage && tier < 4) continue;
      const kind = tier >= 1 && this.rng.chance(0.25) ? 'archer' : this.rng.chance(0.6) ? 'chaser' : 'bat';
      const corrupted = tier >= 2 && this.rng.chance(0.12 * tier);
      const e = new Enemy(kind, 0, 0, corrupted, 1 + Math.floor(tier / 2), tier);
      e.x = x * TILE + (TILE - e.w) / 2;
      e.y = y * TILE + (TILE - e.h) / 2;
      this.enemies.push(e);
      return;
    }
  }

  /** Shrines cleanse corruption; healers mend wounds. Fallen villages offer neither. */
  private updateWorldInteractions(input: InputState): void {
    const ptx = Math.floor(this.player.cx / TILE);
    const pty = Math.floor(this.player.cy / TILE);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const tx = ptx + dx;
      const ty = pty + dy;
      if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) continue;
      const t = this.world.tiles[ty * this.world.w + tx] as Tile;
      if (t !== Tile.Shrine && t !== Tile.Healer) continue;
      const key = `${tx},${ty}`;
      const village = this.villageOf(tx, ty);
      if (village && !villageIntact(village, this.corruption.tierReached)) {
        this.contextHint = t === Tile.Shrine ? 'The shrine is dead stone.' : 'The healer’s tent lies empty.';
        return;
      }
      if (t === Tile.Shrine) {
        const uses = this.shrineUses.get(key) ?? 0;
        if (uses >= SHRINE_USES) {
          this.contextHint = 'The shrine’s light is spent.';
          return;
        }
        this.contextHint = 'F: pray (cleanse corruption)';
        if (input.interact) {
          this.shrineUses.set(key, uses + 1);
          cleanse(this.corruption, SHRINE_CLEANSE);
          this.hud.push('Order washes through you. The chaos recedes.');
          this.audio.play('potion');
          this.flashT = 0.25;
          this.flashColor = '#40e0d0';
        }
      } else {
        const last = this.healerTimes.get(key);
        if (last !== undefined && this.time - last < HEALER_COOLDOWN) {
          this.contextHint = `The healer must rest (${Math.ceil(HEALER_COOLDOWN - (this.time - last))}s).`;
          return;
        }
        this.contextHint = 'F: let the healer mend your wounds';
        if (input.interact) {
          this.healerTimes.set(key, this.time);
          this.player.hp = this.player.maxHp;
          this.player.curePoison();
          this.hud.push('Warm hands and bitter herbs. You are whole again.');
          this.audio.play('potion');
        }
      }
      return;
    }
  }

  // --- friendly NPCs: shops, cleansing rites, hints, quests ---

  private nearestFriendly(): Npc | null {
    for (const n of this.npcs) {
      if (n.kind === 'villager') continue;
      if (Math.hypot(n.x + 5 - this.player.cx, n.y + 7 - this.player.cy) < 24) return n;
    }
    return null;
  }

  private updateNpcInteraction(input: InputState): void {
    if (this.contextHint !== '') return; // a shrine/healer prompt is already up
    const n = this.nearestFriendly();
    if (!n) return;
    this.contextHint = `F: talk to ${FRIENDLY_NAMES[n.kind as FriendlyKind]}`;
    if (input.interact) this.openNpc(n);
  }

  private openNpc(n: Npc): void {
    switch (n.kind) {
      case 'merchant': this.openMerchant(n); break;
      case 'priest': this.openPriest(); break;
      case 'hermit': this.openHermit(n); break;
      case 'questgiver': this.openQuestgiver(); break;
      default: break;
    }
  }

  private updateDialog(d: NpcDialog, input: InputState): void {
    if (input.pause) {
      this.dialog = null;
      return;
    }
    if (d.choices.length > 0) {
      if (input.menuUp) d.cursor = (d.cursor + d.choices.length - 1) % d.choices.length;
      if (input.menuDown) d.cursor = (d.cursor + 1) % d.choices.length;
      if (input.interact || input.attack || input.click) {
        const c = d.choices[d.cursor];
        if (!c) return;
        if (c.pick) c.pick();
        else this.dialog = null; // "Leave"
      }
    }
  }

  private openMerchant(n: Npc): void {
    const stock = n.stock ?? [];
    const build = (cursor: number): void => {
      const choices: NpcDialog['choices'] = stock.map((s) => {
        const def = ITEMS[s.item];
        const owned =
          (def.kind === 'weapon' && def.weapon!.tier <= this.inventory.weaponStats.tier) ||
          (s.item === 'bow' && this.inventory.hasBow);
        const soldOut = s.stock <= 0;
        const poor = this.inventory.gold < s.price;
        const label = owned
          ? `${def.name} - owned`
          : soldOut
            ? `${def.name} - sold out`
            : `${def.name}  ${s.price}g  x${s.stock}`;
        return {
          label,
          dim: owned || soldOut || poor,
          pick: () => {
            if (owned || soldOut) return;
            if (poor) {
              this.hud.push('Not enough gold.');
              return;
            }
            this.inventory.gold -= s.price;
            s.stock--;
            this.inventory.add(s.item);
            if (def.kind === 'consumable') this.hotbar.autoAssign({ kind: 'item', id: s.item });
            this.hud.push(`Bought: ${def.name}.`);
            this.audio.play('coin');
            build(this.dialog?.cursor ?? 0); // refresh stock counts and affordability
          },
        };
      });
      choices.push({ label: 'Leave', pick: null });
      this.dialog = {
        title: `${FRIENDLY_NAMES.merchant} - "Coin talks, hero."`,
        lines: [`Your gold: ${this.inventory.gold}`],
        choices,
        cursor: Math.min(cursor, choices.length - 1),
      };
    };
    build(0);
  }

  private openPriest(): void {
    this.dialog = {
      title: FRIENDLY_NAMES.priest,
      lines: [
        '"The chaos gnaws at you, wanderer."',
        '"Order can still be bought - in coin."',
      ],
      choices: [
        {
          label: `Cleansing rites  ${PRIEST_PRICE}g  (-${PRIEST_CLEANSE} corruption)`,
          dim: this.inventory.gold < PRIEST_PRICE,
          pick: () => {
            if (this.inventory.gold < PRIEST_PRICE) {
              this.hud.push('Not enough gold.');
              return;
            }
            this.inventory.gold -= PRIEST_PRICE;
            cleanse(this.corruption, PRIEST_CLEANSE * this.fx.purityMult);
            this.hud.push("The priest's chant scours the rot away.");
            this.audio.play('potion');
            this.flashT = 0.25;
            this.flashColor = '#40e0d0';
            this.dialog = null;
          },
        },
        { label: 'Leave', pick: null },
      ],
      cursor: 0,
    };
  }

  private openHermit(n: Npc): void {
    const lines = [`"${n.hint ?? '...'}"`];
    if (!n.giftGiven) {
      n.giftGiven = true;
      const gift = hermitGift(this.rng);
      this.inventory.gold += gift;
      lines.push(`The hermit presses ${gift} gold into your palm.`);
      this.audio.play('coin');
    }
    this.dialog = {
      title: FRIENDLY_NAMES.hermit,
      lines,
      choices: [{ label: 'Leave', pick: null }],
      cursor: 0,
    };
  }

  private openQuestgiver(): void {
    const title = FRIENDLY_NAMES.questgiver;
    if (this.questActive) {
      const q = this.questActive;
      const done = this.kills - q.killsAtAccept;
      if (done >= q.def.targetKills) {
        const reward = q.def.rewardItem ? ITEMS[q.def.rewardItem] : null;
        this.dialog = {
          title,
          lines: ['"Well fought! The land breathes easier."'],
          choices: [
            {
              label: `Collect reward: ${q.def.rewardGold}g${reward ? ` + ${reward.name}` : ''}`,
              pick: () => {
                this.inventory.gold += q.def.rewardGold;
                if (q.def.rewardItem) {
                  this.inventory.add(q.def.rewardItem);
                  if (ITEMS[q.def.rewardItem].kind === 'consumable') {
                    this.hotbar.autoAssign({ kind: 'item', id: q.def.rewardItem });
                  }
                }
                this.questActive = null;
                this.questNotified = false;
                this.questIdx++;
                this.hud.push(`Reward claimed: ${q.def.rewardGold} gold.`);
                this.audio.play('quest');
                this.dialog = null;
              },
            },
            { label: 'Leave', pick: null },
          ],
          cursor: 0,
        };
      } else {
        this.dialog = {
          title,
          lines: [`"Not done yet? ${done}/${q.def.targetKills} beasts slain."`],
          choices: [{ label: 'Leave', pick: null }],
          cursor: 0,
        };
      }
      return;
    }
    const def = QUESTS[this.questIdx];
    if (!def) {
      this.dialog = {
        title,
        lines: ['"The land owes you more than it can pay, hero."'],
        choices: [{ label: 'Leave', pick: null }],
        cursor: 0,
      };
      return;
    }
    const reward = def.rewardItem ? ITEMS[def.rewardItem] : null;
    this.dialog = {
      title,
      lines: [
        '"The beasts multiply while the Gate stands."',
        `"${def.description}, and ${def.rewardGold} gold is yours."`,
        ...(reward ? [`"...and my spare ${reward.name}."`] : []),
      ],
      choices: [
        {
          label: `Accept: ${def.description}`,
          pick: () => {
            this.questActive = { def, killsAtAccept: this.kills };
            this.questNotified = false;
            this.hud.push(`Quest accepted: ${def.description}.`);
            this.audio.play('quest');
            this.dialog = null;
          },
        },
        { label: 'Not now', pick: null },
      ],
      cursor: 0,
    };
  }

  private villageOf(tx: number, ty: number): 'home' | 'far' | null {
    const near = (v: Village): boolean =>
      tx >= v.bounds.x - 2 && tx < v.bounds.x + v.bounds.w + 2 &&
      ty >= v.bounds.y - 2 && ty < v.bounds.y + v.bounds.h + 2;
    if (near(this.world.homeVillage)) return 'home';
    if (near(this.world.farVillage)) return 'far';
    return null;
  }

  /** Max hp = base + mutation delta + level growth, clamped; current hp follows the cap down. */
  private recomputeMaxHp(): void {
    const newMax = Math.min(
      PLAYER_MAX_HP_CAP,
      Math.max(2, PLAYER_START_HP + this.fx.maxHpDelta + this.levelHpBonus),
    );
    this.player.maxHp = newMax;
    this.player.hp = Math.min(this.player.hp, newMax);
  }

  private applyLevelUps(boons: LevelUpBoon[]): void {
    for (const b of boons) {
      this.levelHpBonus += b.maxHpDelta;
      this.levelDamageBonus += b.damageDelta;
      this.recomputeMaxHp();
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + b.heal);
      this.spellbook.maxMana += b.maxManaDelta;
      this.spellbook.mana = this.spellbook.maxMana; // level-ups refill mana
      this.hud.push(b.message);
      this.audio.play('levelup');
      this.flashT = 0.3;
      this.flashColor = '#ffd040';
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

  private locationLabel(): string {
    if (this.site.kind === 'dungeon') {
      return `${DUNGEONS[this.site.id].name} B${this.site.depth}`;
    }
    const tx = Math.floor(this.player.cx / TILE);
    const ty = Math.floor(this.player.cy / TILE);
    if (this.villageOf(tx, ty) === 'home') return this.world.homeVillage.name;
    if (this.villageOf(tx, ty) === 'far') return this.world.farVillage.name;
    const c = this.world.castle;
    if (tx >= c.x - 1 && tx < c.x + c.w + 1 && ty >= c.y - 1 && ty < c.y + c.h + 1) return 'Bandit Castle';
    return 'Wilderness';
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
          this.cur.rubbleCleared.push({ x: tx, y: ty });
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
    const baseRadius = this.site.kind === 'world' ? WORLD_VISION_RADIUS : VISION_RADIUS;
    const radius = baseRadius + this.fx.visionDelta;
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
      this.renderer.camera.setBounds(this.floor.w, this.floor.h);
      this.renderer.camera.snapTo(this.player.cx, this.player.cy);
    }
    const r = this.renderer;
    r.camera.follow(this.player.cx, this.player.cy, 1 / 60);

    r.begin();
    r.drawTiles(this.floor, this.fog, this.corruption.points, this.time);

    for (const p of this.pickups) r.drawPickup(p, this.fog, this.floor.w, this.time);

    for (const n of this.npcs) {
      const near = Math.hypot(n.x - this.player.x, n.y - this.player.y) < 30;
      let marker: string | null = null;
      if (n.kind === 'questgiver') {
        const ready =
          this.questActive &&
          this.kills - this.questActive.killsAtAccept >= this.questActive.def.targetKills;
        if (ready || (!this.questActive && this.questIdx < QUESTS.length)) marker = '!';
      }
      r.drawNpc(n, this.fog, this.floor.w, near, marker, this.time);
    }

    // bombs on the ground
    for (const b of this.bombs) {
      const sprite = r.atlas.items.get('bomb')!;
      const blink = b.fuse < 0.4 && Math.floor(this.time * 12) % 2 === 0;
      if (!blink) ctx.drawImage(sprite, Math.round(b.x - 5 - r.camera.x), Math.round(b.y - 5 - r.camera.y), 10, 10);
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
    if (this.flashT > 0 && !getSettings().reduceFlashing) {
      r.flashScreen(this.flashColor, Math.min(0.5, this.flashT * 2));
    }

    const questView = this.questActive
      ? {
          desc: this.questActive.def.description,
          done: Math.min(
            this.kills - this.questActive.killsAtAccept,
            this.questActive.def.targetKills,
          ),
          target: this.questActive.def.targetKills,
          ready:
            this.kills - this.questActive.killsAtAccept >= this.questActive.def.targetKills,
        }
      : null;
    this.hud.render(
      ctx, r.atlas, this.player, this.corruption, this.locationLabel(),
      this.inventory, this.spellbook, this.hotbar, this.progression, this.time,
      this.contextHint, questView,
    );

    if (this.window.open) {
      this.window.render(ctx, r.atlas, this.inventory, this.spellbook, this.hotbar);
    }

    if (this.dialog) {
      drawDialogPanel(ctx, {
        title: this.dialog.title,
        lines: this.dialog.lines,
        entries: this.dialog.choices.map((c) => ({ label: c.label, dim: c.dim })),
        cursor: this.dialog.cursor,
      });
    }

    if (this.paused) {
      drawDialogPanel(ctx, {
        title: 'Paused',
        lines: ['The corruption is held at bay... for now.'],
        entries: this.pauseOptions.map((label) => ({ label })),
        cursor: this.pauseCursor,
      });
    }
  }
}

// re-export for main.ts dev tooling
export { moveAndCollide };
