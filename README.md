# Corruption Crawl

A roguelike race-against-time dungeon crawler — **Zelda** real-time action combat fused
with **ADOM**'s procedural depth, permadeath, and corruption.

The Chaos Gate has opened beneath the village. Corruption seeps upward, floor by floor.
Descend eight procedurally generated floors and slay the **Herald of Decay** — quickly,
because the corruption meter never stops climbing. Cross a threshold and you mutate:
sometimes cursed, sometimes double-edged. Hit 100% and the run is over.

## Play

```bash
npm install
npm run dev      # open the printed localhost URL
```

| Action | Keyboard + Mouse | Gamepad |
| --- | --- | --- |
| Move | WASD / Arrow keys | Left stick |
| Attack (sword) | Space / J / Z | A |
| Shoot bow | Left click (aims at cursor) | RT / RB (aims with right stick) |
| Aim | Mouse cursor | Right stick |
| Dodge (i-frames) | Shift / K / X | B |
| Hotbar slots 1–9 | 1–9 | Y cycles, X activates |
| Inventory / spellbook | I / Tab | Select |

Bombs are thrown toward your aim (up to ~4 tiles, stopping at walls) instead of
dropped at your feet.

## Hotbar & spellbook

Everything usable lives on a **9-slot hotbar**: consumables and spells auto-assign to
the first free slot as you find them, and pressing its number uses/casts it instantly.
Open the **pack & spellbook window** (I or Tab — the world pauses) to review what you
carry and know; select an entry and press **1–9 to rebind it** to any slot, or
E/Enter/click to use it directly from the window.

Spells cost **mana** (blue bar under your hearts, regenerates slowly):

| Spell | Cost | Effect |
| --- | --- | --- |
| Chaos Bolt *(known from start)* | 2 | Aimed bolt, 3 damage |
| Cleanse *(known from start)* | 2 | Cure poison, purge 8 corruption |
| Haste *(tome, floor 2)* | 3 | +40% move speed for 8s |
| Nova *(tome, floor 3)* | 4 | Radial blast, 2 damage + knockback |
| Stoneskin *(tome, floor 4)* | 3 | Absorb 1 damage per hit for 8s |
| Blink *(tome, floor 5)* | 2 | Teleport toward your aim |

Beware: corrupted enemies now **poison** you on hit — a damage-over-time that ignores
i-frames. Cleanse is the cure.

## Forge your hero

Every run starts at the character forge: pick a **name** (or let fate name you),
**gender**, **race**, **class**, and one **blessing** from a random offering of four —
or hit **RANDOMIZE** to roll the whole hero. Your identity ("Zora the Elf Mage") is
carved into the death and victory screens.

| Race | Effect |
| --- | --- |
| Human | Adaptable; packs an extra heal potion |
| Elf | +3 mana, +8% speed, one heart fewer |
| Dwarf | +1 heart, corruption 10% slower, a bit slow |
| Orc | +1 sword damage, chaos-tainted (+15% corruption) |
| Halfling | Quick dodge, +5% speed, one heart fewer, two bombs |

| Class | Effect |
| --- | --- |
| Knight | +1 heart, knows Stoneskin, −2 mana |
| Ranger | Bow + 10 arrows, knows Haste |
| Mage | +4 mana, faster regen, knows Nova, one heart fewer |
| Priest | Potions & cleansing 25% stronger, starts with a purity potion |
| Rogue | Fast dodge, +5% speed, knows Blink, starts with a bomb |

Blessings range from raw stats (+1 heart, +3 mana, +10% speed) to stranger gifts:
slower corruption, a bow, cheaper spells, extra potions — or the **Blessing of
Order**, which absorbs your first mutation harmlessly.

## The run

- **8 floors**, rooms-and-corridors, always fully connected, seeded and deterministic.
- **Enemies**: goblin chasers (telegraphed lunges), cultist archers (kite and shoot),
  erratic bats — plus corrupted variants once the world decays far enough.
- **Corruption**: rises passively (faster on deeper floors), +2 when corrupted enemies
  touch you. Thresholds at 20/40/60/80 each grant a random mutation. Purity potions
  (−25) and Elixirs of Order (−50) push it back; descending stairs cleanses a little.
  Mutations are forever — cleansing never revokes them.
- **Weapons**: Rusty Sword → Soldier's Blade (floor 3) → Chaosbane (floor 6).
- **Hunter's Bow** (floor 2): mouse- or stick-aimed arrows for picking off archers and
  bats at range. Arrows are scarce — gather bundles as you descend.
- **Keys**: floors 2/4/6 seal the stairs behind a chaos lock; find the key first.
- **Bombs** clear rubble and crowds (careful — they hurt you too).
- **Permadeath.** The dungeon keeps what it takes.

## Tech

TypeScript + HTML5 Canvas 2D, zero runtime dependencies. Vite for dev/build, Vitest
for tests. All art is procedural (Canvas primitives baked to sprite atlases at boot);
all audio is WebAudio-synthesized. Input, audio, and storage sit behind thin
abstractions so the game can ship to Steam via Electron/Tauri and to mobile via
Capacitor without touching game logic.

```bash
npm test         # 73 unit tests: dungeon connectivity, corruption math, combat, spells, rng
npm run build    # typecheck + production bundle in dist/
```

Dev shortcuts: `?seed=123&floor=7` jumps straight to a floor; add `&debug=1` to expose
`window.__game` for automated tests.
