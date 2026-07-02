// Entry point: virtual-resolution canvas with integer scaling, input/audio wiring,
// scene flow, boot to title.

import { VIEW_W, VIEW_H } from './config';
import { Game } from './game';
import type { Scene, SceneFlow, RunStats } from './game';
import { WebAudio } from './audio';
import { TitleScene, GameOverScene, VictoryScene } from './scenes';
import { PlayScene } from './playScene';

const visible = document.getElementById('game') as HTMLCanvasElement;
const visibleCtx = visible.getContext('2d')!;

// Game renders to a fixed virtual canvas; we blit it up at integer scale.
const virtual = document.createElement('canvas');
virtual.width = VIEW_W;
virtual.height = VIEW_H;
const ctx = virtual.getContext('2d')!;

function resize(): void {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H)));
  visible.width = VIEW_W * scale;
  visible.height = VIEW_H * scale;
  visibleCtx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

const audio = new WebAudio();
window.addEventListener('keydown', () => audio.unlock(), { once: true });
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// Dev helpers: ?seed=123&floor=7 jumps straight into a run for testing.
const params = new URLSearchParams(location.search);
const devSeed = params.has('seed') ? Number(params.get('seed')) : undefined;
const devFloor = params.has('floor') ? Number(params.get('floor')) : undefined;

const flow: SceneFlow = {
  title: (): Scene => new TitleScene(flow),
  newRun: (seed?: number, startDepth?: number): Scene =>
    new PlayScene(
      flow,
      seed ?? devSeed ?? Math.floor(Math.random() * 0xffffffff),
      startDepth ?? devFloor ?? 1,
    ),
  gameOver: (stats: RunStats): Scene => new GameOverScene(stats, flow),
  victory: (stats: RunStats): Scene => new VictoryScene(stats, flow),
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
