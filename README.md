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
| Use item | E / L / C | X |
| Swap item | Q / Tab | Y |

Bombs are thrown toward your aim (up to ~4 tiles, stopping at walls) instead of
dropped at your feet.

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
npm test         # 48 unit tests: dungeon connectivity, corruption math, combat, rng
npm run build    # typecheck + production bundle in dist/
```

Dev shortcuts: `?seed=123&floor=7` jumps straight to a floor; add `&debug=1` to expose
`window.__game` for automated tests.
