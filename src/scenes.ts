// Title, Game Over, and Victory scenes. Pure menu screens: draw text, wait for a key.

import { VIEW_W, VIEW_H } from './config';
import type { Game, Scene, SceneFlow, RunStats } from './game';
import type { InputState } from './input';

const TITLE_FLAVOR = [
  'The Chaos Gate has opened beneath the village.',
  'Corruption seeps upward, floor by floor.',
  'Descend. Slay the Herald of Decay.',
  'And do it quickly — the rot does not wait.',
];

function drawCenteredLines(
  ctx: CanvasRenderingContext2D,
  lines: { text: string; y: number; font: string; color: string }[],
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const l of lines) {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, VIEW_W / 2, l.y);
  }
  ctx.textAlign = 'left';
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class TitleScene implements Scene {
  private time = 0;
  private armed = false; // swallow the keypress that brought us here

  constructor(private readonly flow: SceneFlow) {}

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;
    if (!input.anyKey) {
      this.armed = true;
      return;
    }
    if (this.armed && this.time > 0.3) game.switchScene(this.flow.newRun());
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#08060c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // pulsing corruption glow behind the title
    const pulse = 0.12 + 0.05 * Math.sin(this.time * 2);
    const grad = ctx.createRadialGradient(VIEW_W / 2, 60, 10, VIEW_W / 2, 60, 130);
    grad.addColorStop(0, `rgba(200, 0, 170, ${pulse.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(200, 0, 170, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const lines = [
      { text: 'C O R R U P T I O N', y: 38, font: 'bold 22px monospace', color: '#ff30d0' },
      { text: 'C R A W L', y: 62, font: 'bold 22px monospace', color: '#e8e8f0' },
      ...TITLE_FLAVOR.map((text, i) => ({
        text, y: 104 + i * 12, font: '8px monospace', color: '#9a90b0',
      })),
      { text: 'WASD/Arrows move   Space attack   Shift dodge', y: 168, font: '8px monospace', color: '#707088' },
      { text: 'E use item   Q swap item', y: 180, font: '8px monospace', color: '#707088' },
    ];
    if (Math.floor(this.time * 1.5) % 2 === 0) {
      lines.push({ text: '- press any key to descend -', y: 208, font: '9px monospace', color: '#ffd040' });
    }
    drawCenteredLines(ctx, lines);
  }
}

export class GameOverScene implements Scene {
  private time = 0;

  constructor(
    private readonly stats: RunStats,
    private readonly flow: SceneFlow,
  ) {}

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;
    if (input.anyKey && this.time > 1) game.switchScene(this.flow.title());
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0c0508';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const s = this.stats;
    drawCenteredLines(ctx, [
      { text: 'Y O U   D I E D', y: 44, font: 'bold 18px monospace', color: '#e02848' },
      { text: s.cause, y: 74, font: '9px monospace', color: '#c8b0c0' },
      { text: `Floor reached: B${s.depth}`, y: 104, font: '8px monospace', color: '#9a90b0' },
      { text: `Kills: ${s.kills}`, y: 116, font: '8px monospace', color: '#9a90b0' },
      { text: `Corruption: ${s.corruptionPoints}%  (${s.mutationCount} mutations)`, y: 128, font: '8px monospace', color: '#9a90b0' },
      { text: `Time: ${fmtTime(s.timeSec)}`, y: 140, font: '8px monospace', color: '#9a90b0' },
      { text: 'The dungeon keeps what it takes.', y: 168, font: '8px monospace', color: '#705a68' },
      ...(this.time > 1 ? [{ text: '- press any key -', y: 200, font: '9px monospace', color: '#ffd040' }] : []),
    ]);
  }
}

export class VictoryScene implements Scene {
  private time = 0;

  constructor(
    private readonly stats: RunStats,
    private readonly flow: SceneFlow,
  ) {}

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;
    if (input.anyKey && this.time > 1.5) game.switchScene(this.flow.title());
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#060a08';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const glow = 0.1 + 0.06 * Math.sin(this.time * 3);
    const grad = ctx.createRadialGradient(VIEW_W / 2, 50, 5, VIEW_W / 2, 50, 120);
    grad.addColorStop(0, `rgba(255, 220, 80, ${glow.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 220, 80, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const s = this.stats;
    drawCenteredLines(ctx, [
      { text: 'V I C T O R Y', y: 42, font: 'bold 20px monospace', color: '#ffd040' },
      { text: 'The Herald of Decay is no more.', y: 72, font: '9px monospace', color: '#d8e8d0' },
      { text: 'The corruption gutters and dies. The village is saved.', y: 86, font: '8px monospace', color: '#9ab090' },
      { text: `Kills: ${s.kills}`, y: 116, font: '8px monospace', color: '#9a90b0' },
      { text: `Final corruption: ${s.corruptionPoints}%  (${s.mutationCount} mutations)`, y: 128, font: '8px monospace', color: '#9a90b0' },
      { text: `Time: ${fmtTime(s.timeSec)}`, y: 140, font: '8px monospace', color: '#9a90b0' },
      ...(this.time > 1.5 ? [{ text: '- press any key -', y: 196, font: '9px monospace', color: '#ffd040' }] : []),
    ]);
  }
}
