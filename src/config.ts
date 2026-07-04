// All tunable balance constants live here. This is the tuning surface for the game.

// --- Simulation / rendering ---
export const DT = 1 / 60; // fixed simulation timestep (seconds)
export const MAX_STEPS_PER_FRAME = 5; // spiral-of-death cap
export const TILE = 16; // logical pixels per tile (world/physics units)
export const VIEW_W = 480; // logical view (30 tiles), 16:9
export const VIEW_H = 270; // (16.9 tiles)
// Art supersample: sprites are baked and the canvas rendered at PX x the
// logical resolution, so the real framebuffer is 960x540. World units,
// physics, and UI layout all stay in logical pixels.
export const PX = 2;

// --- Dungeon ---
export const MAP_W = 48;
export const MAP_H = 36;

// --- Overworld ---
export const WORLD_W = 96;
export const WORLD_H = 72;
export const WORLD_VISION_RADIUS = 12; // tiles; open air sees farther than dungeons
export const WILD_SPAWN_INTERVAL = 18; // s between wilderness spawn checks (shrinks with chaos)
export const WILD_SPAWN_CAP = 8; // max live wilderness monsters (grows with chaos)
export const SHRINE_CLEANSE = 20; // corruption purged per prayer
export const SHRINE_USES = 2; // prayers per shrine per run
export const HEALER_COOLDOWN = 120; // s between free heals at the same healer
export const FINAL_DEPTH = 8;
export const ROOM_ATTEMPTS = 30;
export const ROOM_MIN = 4;
export const ROOM_MAX = 9;
export const ROOM_KEEP_MIN = 6;
export const ROOM_KEEP_MAX = 10;
export const KEY_FLOORS = [2, 4, 6];
export const SPAWN_SAFE_DIST = 8; // tiles (BFS) — no enemies closer than this to spawn

// --- Player ---
export const PLAYER_SPEED = 78; // px/s
export const PLAYER_W = 10;
export const PLAYER_H = 12;
export const PLAYER_START_HP = 6; // half-hearts (3 hearts)
export const PLAYER_MAX_HP_CAP = 16; // 8 hearts — leaves room for level growth
export const PLAYER_IFRAMES = 0.8; // seconds
export const DODGE_DIST = 90; // px
export const DODGE_TIME = 0.18; // seconds
export const DODGE_COOLDOWN = 0.7; // seconds

// --- Combat ---
export const SWING_WINDUP = 0.06;
export const SWING_ACTIVE = 0.12;
export const SWING_RECOVERY = 0.12;
export const SWING_REACH = 18; // px radial extent of the swing sector
export const SWING_HALF_ANGLE = 1.0; // rad half-width of the swing sector (~115° arc)
export const KNOCKBACK_SPEED = 180; // px/s impulse
export const KNOCKBACK_DECAY = 0.001; // v *= KNOCKBACK_DECAY^dt (gone in ~0.3s)
export const KNOCKBACK_INPUT_LOCK = 40; // input suppressed while |v| above this
export const ENEMY_HITSTUN = 0.2; // seconds of enemy i-frames after a hit

// --- Ranged (bow / thrown bombs) ---
export const ARROW_SPEED = 230; // px/s
export const ARROW_DAMAGE = 2;
export const BOW_COOLDOWN = 0.45; // seconds
export const BOMB_THROW_DIST = 64; // px max lob distance

// --- Magic ---
export const MANA_MAX = 10;
export const MANA_REGEN = 0.45; // per second
export const BOLT_DAMAGE = 3;
export const BOLT_SPEED = 250; // px/s
export const NOVA_RADIUS = 42; // px
export const NOVA_DAMAGE = 2;
export const HASTE_DURATION = 8; // seconds
export const HASTE_MULT = 1.4;
export const STONESKIN_DURATION = 8; // seconds
export const BLINK_DIST = 56; // px
export const CLEANSE_CORRUPTION = 8; // corruption points purged by Cleanse

// --- Leveling ---
export const LEVEL_CAP = 10;
export const XP_LEVEL_BASE = 10; // xp needed from level 1 -> 2
export const XP_LEVEL_GROWTH = 10; // extra xp needed per subsequent level
export const XP_DEPTH_SCALE = 0.2; // kill xp bonus per depth beyond 1
export const LEVELUP_HEAL = 2; // half-hearts restored on level up

// --- Poison (afflicts the player; corrupted enemies inflict it) ---
export const POISON_TICKS = 3;
export const POISON_INTERVAL = 1.5; // seconds between ticks

// --- Enemies ---
export const ENEMY_BASE_COUNT = 4;
export const ENEMY_PER_DEPTH = 2;
export const DEPTH_SCALE = 0.15; // +15% hp/dmg per depth beyond 1
export const AGGRO_RADIUS = 8; // tiles
export const AGGRO_LOSE_TIME = 3; // seconds without LOS
export const PROJECTILE_SPEED = 140; // px/s

// --- Corruption ---
export const CORRUPTION_MAX = 100;
export const CORRUPTION_BASE_RATE = 0.14; // points/s on depth 1
export const CORRUPTION_DEPTH_RATE = 0.035; // extra points/s per depth beyond 1
export const CORRUPTION_THRESHOLDS = [20, 40, 60, 80];
export const CORRUPT_HIT_POINTS = 2; // corruption gained when a corrupted enemy hits you
export const STAIRS_CLEANSE = 5; // corruption removed on descending
export const PURITY_POTION_CLEANSE = 25;
export const ELIXIR_CLEANSE = 50;
export const CORRUPT_TIER_SPAWN_SCALE = 0.15; // +15% enemy hp/dmg per tier at spawn
export const CORRUPT_VARIANT_TIER = 3; // tier at which corrupted variants appear
export const CORRUPT_VARIANT_CHANCE = 0.3;

// --- Fog of war ---
export const VISION_RADIUS = 8; // tiles
export const FOG_RECOMPUTE_HZ = 10;
export const EXPLORED_BRIGHTNESS = 0.35;
