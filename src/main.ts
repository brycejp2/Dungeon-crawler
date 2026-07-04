// Entry point: virtual-resolution canvas with integer scaling, input/audio wiring,
// scene flow, boot to title.

import { VIEW_W, VIEW_H, PX } from './config';
import { Game } from './game';
import type { Scene, SceneFlow, RunStats } from './game';
import { WebAudio } from './audio';
import {
  MenuScene, HighScoresScene, SettingsScene, AboutScene, GameOverScene, VictoryScene,
} from './scenes';
import { CharCreateScene } from './charCreate';
import { PlayScene } from './playScene';
import type { CharacterDef } from './character';
import {
  loadSettings, loadSave, clearSave, writeSave, hasSave, submitScore,
} from './storage';

const visible = document.getElementById('game') as HTMLCanvasElement;
const visibleCtx = visible.getContext('2d')!;

// Game renders to a supersampled virtual canvas (logical view x PX); code
// draws in logical coordinates through a scaled context. We blit it up at
// integer scale (or shrink to fit small windows).
const virtual = document.createElement('canvas');
virtual.width = VIEW_W * PX;
virtual.height = VIEW_H * PX;
const ctx = virtual.getContext('2d')!;
ctx.scale(PX, PX);
ctx.imageSmoothingEnabled = false;

function resize(): void {
  const fit = Math.min(window.innerWidth / virtual.width, window.innerHeight / virtual.height);
  const scale = fit >= 1 ? Math.floor(fit) : fit; // integer upscale, fractional shrink-to-fit
  visible.width = Math.round(virtual.width * scale);
  visible.height = Math.round(virtual.height * scale);
  visibleCtx.imageSmoothingEnabled = scale < 1;
}
window.addEventListener('resize', resize);
resize();

const audio = new WebAudio();
window.addEventListener('keydown', () => audio.unlock(), { once: true });
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// Apply persisted settings to the audio backend on boot.
const settings = loadSettings();
audio.muted = !settings.sound;
audio.masterVolume = settings.sound ? settings.volume / 100 : 0;

// Dev helpers: ?seed=123&floor=7 jumps straight into a run for testing.
const params = new URLSearchParams(location.search);
const devSeed = params.has('seed') ? Number(params.get('seed')) : undefined;
const devFloor = params.has('floor') ? Number(params.get('floor')) : undefined;

const flow: SceneFlow = {
  title: (): Scene => new MenuScene(flow),
  charCreate: (): Scene => {
    clearSave(); // starting a new game abandons any suspended run
    return new CharCreateScene(flow);
  },
  newRun: (character?: CharacterDef): Scene =>
    new PlayScene(
      flow,
      devSeed ?? Math.floor(Math.random() * 0xffffffff),
      devFloor ?? 0, // 0 = begin on the overworld; ?floor=N jumps into the Chaos Gate
      character, // undefined => random character (dev shortcut runs)
    ),
  continueRun: (): Scene | null => {
    const save = loadSave();
    if (!save) return null;
    clearSave(); // single-use: consumed on resume, re-written when the run is next suspended
    return new PlayScene(flow, save.seed, 0, undefined, save);
  },
  highScores: (): Scene => new HighScoresScene(flow),
  settings: (): Scene => new SettingsScene(flow),
  about: (): Scene => new AboutScene(flow),
  gameOver: (stats: RunStats): Scene =>
    new GameOverScene(stats, flow, submitScore(stats, false).qualified),
  victory: (stats: RunStats): Scene =>
    new VictoryScene(stats, flow, submitScore(stats, true).qualified),
  hasSave: (): boolean => hasSave(),
};

const game = new Game(ctx, audio);
game.input.attach(window);
game.input.attachPointer(visible, (clientX, clientY) => {
  const rect = visible.getBoundingClientRect();
  const scale = visible.width / VIEW_W;
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
});
game.switchScene(devFloor !== undefined ? flow.newRun() : flow.title());
game.start();

// Autosave a live run when the tab is hidden or closed, so the player can
// Continue exactly where they left off. A finished run serializes to null.
function autosaveOnExit(): void {
  const scene = game.currentScene;
  if (scene instanceof PlayScene) {
    const save = scene.serialize();
    if (save) writeSave(save);
  }
}
window.addEventListener('pagehide', autosaveOnExit);
window.addEventListener('beforeunload', autosaveOnExit);

// ?debug=1 exposes the game for automated end-to-end tests. Dev-only escape hatch.
if (params.has('debug')) {
  (window as unknown as Record<string, unknown>).__game = game;
}

// Blit loop: virtual canvas -> visible canvas at integer scale
function blit(): void {
  visibleCtx.drawImage(virtual, 0, 0, visible.width, visible.height);
  requestAnimationFrame(blit);
}
requestAnimationFrame(blit);
