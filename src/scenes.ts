// Front-end scenes: main menu, high scores, settings, about, plus the
// game-over and victory screens. All are pure menu screens — draw text,
// read InputState, switch scenes. No game simulation here.

import { VIEW_W, VIEW_H } from './config';
import type { Game, Scene, SceneFlow, RunStats } from './game';
import type { InputState } from './input';
import {
  loadHighScores, getSettings, saveSettings, type HighScore,
} from './storage';

// --- shared drawing helpers ---

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
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Corruption-glow background shared by the menu-family screens. */
function drawBackdrop(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.fillStyle = '#08060c';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const pulse = 0.1 + 0.04 * Math.sin(time * 2);
  const grad = ctx.createRadialGradient(VIEW_W / 2, 50, 10, VIEW_W / 2, 50, 150);
  grad.addColorStop(0, `rgba(200, 0, 170, ${pulse.toFixed(3)})`);
  grad.addColorStop(1, 'rgba(200, 0, 170, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawTitle(ctx: CanvasRenderingContext2D): void {
  drawCenteredLines(ctx, [
    { text: 'C O R R U P T I O N', y: 30, font: 'bold 22px monospace', color: '#ff30d0' },
    { text: 'C R A W L', y: 54, font: 'bold 22px monospace', color: '#e8e8f0' },
  ]);
}

/** A vertical list of selectable options with keyboard + mouse navigation. */
interface MenuOption {
  label: string;
  enabled?: boolean; // default true
  onSelect: () => void;
}

class MenuList {
  cursor = 0;

  constructor(
    private readonly options: MenuOption[],
    private readonly topY: number,
    private readonly rowH = 16,
  ) {
    this.snapToEnabled(1);
  }

  private enabled(i: number): boolean {
    return this.options[i]?.enabled !== false;
  }

  private snapToEnabled(dir: number): void {
    for (let i = 0; i < this.options.length; i++) {
      if (this.enabled(this.cursor)) return;
      this.cursor = (this.cursor + dir + this.options.length) % this.options.length;
    }
  }

  private move(dir: number): void {
    for (let i = 0; i < this.options.length; i++) {
      this.cursor = (this.cursor + dir + this.options.length) % this.options.length;
      if (this.enabled(this.cursor)) return;
    }
  }

  update(input: InputState): void {
    if (input.menuUp) this.move(-1);
    if (input.menuDown) this.move(1);

    // mouse hover selects, click activates
    if (input.hasPointer) {
      const idx = Math.round((input.pointerY - this.topY) / this.rowH);
      if (idx >= 0 && idx < this.options.length && Math.abs(input.pointerY - (this.topY + idx * this.rowH)) < this.rowH / 2) {
        if (this.enabled(idx)) this.cursor = idx;
        if (input.click && this.enabled(idx)) {
          this.cursor = idx;
          this.activate();
          return;
        }
      }
    }
    if (input.interact || (input.attack && !input.click)) this.activate();
  }

  private activate(): void {
    const opt = this.options[this.cursor];
    if (opt && opt.enabled !== false) opt.onSelect();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '11px monospace';
    this.options.forEach((opt, i) => {
      const y = this.topY + i * this.rowH;
      const selected = i === this.cursor;
      const disabled = opt.enabled === false;
      ctx.fillStyle = disabled ? '#4a4458' : selected ? '#ffd040' : '#b0a8c0';
      const text = selected && !disabled ? `›  ${opt.label}  ‹` : opt.label;
      ctx.fillText(text, VIEW_W / 2, y);
    });
    ctx.textAlign = 'left';
  }
}

// --- main menu ---

export class MenuScene implements Scene {
  private time = 0;
  private armed = false; // swallow the key/click that brought us here
  private list: MenuList;

  constructor(private readonly flow: SceneFlow) {
    const options: MenuOption[] = [
      { label: 'Continue', enabled: flow.hasSave(), onSelect: () => this.continue() },
      { label: 'New Game', onSelect: () => this.flowSwitch(flow.charCreate()) },
      { label: 'High Scores', onSelect: () => this.flowSwitch(flow.highScores()) },
      { label: 'Settings', onSelect: () => this.flowSwitch(flow.settings()) },
      { label: 'About', onSelect: () => this.flowSwitch(flow.about()) },
    ];
    this.list = new MenuList(options, 120);
  }

  private game!: Game;

  enter(game: Game): void {
    this.game = game;
  }

  private flowSwitch(scene: Scene): void {
    this.game.switchScene(scene);
  }

  private continue(): void {
    const scene = this.flow.continueRun();
    if (scene) this.game.switchScene(scene);
  }

  update(dt: number, input: InputState): void {
    this.time += dt;
    // require the input to be released once before accepting menu presses,
    // so the keypress from a previous screen doesn't fall straight through
    if (!input.anyKey && !input.click) this.armed = true;
    if (!this.armed) return;
    this.list.update(input);
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawBackdrop(ctx, this.time);
    drawTitle(ctx);
    drawCenteredLines(ctx, [
      { text: 'A roguelike race against the rising corruption.', y: 84, font: '8px monospace', color: '#9a90b0' },
    ]);
    this.list.render(ctx);
    drawCenteredLines(ctx, [
      { text: '↑↓ select    Enter/click confirm', y: VIEW_H - 20, font: '8px monospace', color: '#605878' },
    ]);
  }
}

// --- high scores ---

export class HighScoresScene implements Scene {
  private time = 0;
  private armed = false;
  private readonly scores: HighScore[] = loadHighScores();

  constructor(private readonly flow: SceneFlow) {}

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;
    if (!input.anyKey && !input.click) this.armed = true;
    if (this.armed && (input.anyKey || input.click)) game.switchScene(this.flow.title());
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawBackdrop(ctx, this.time);
    drawCenteredLines(ctx, [
      { text: 'H I G H   S C O R E S', y: 26, font: 'bold 16px monospace', color: '#ffd040' },
    ]);
    ctx.textBaseline = 'top';
    if (this.scores.length === 0) {
      drawCenteredLines(ctx, [
        { text: 'No runs recorded yet.', y: 110, font: '9px monospace', color: '#9a90b0' },
        { text: 'Descend and make your mark.', y: 126, font: '8px monospace', color: '#705a68' },
      ]);
    } else {
      const x0 = 40;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#707088';
      ctx.fillText('#', x0, 54);
      ctx.fillText('SCORE', x0 + 16, 54);
      ctx.fillText('HERO', x0 + 66, 54);
      ctx.textAlign = 'right';
      ctx.fillText('DEPTH', VIEW_W - x0 - 96, 54);
      ctx.fillText('KILLS', VIEW_W - x0 - 52, 54);
      ctx.fillText('TIME', VIEW_W - x0, 54);
      this.scores.forEach((s, i) => {
        const y = 70 + i * 14;
        const win = s.won;
        ctx.textAlign = 'left';
        ctx.fillStyle = win ? '#ffd040' : i === 0 ? '#e8e0f0' : '#b0a8c0';
        ctx.fillText(`${i + 1}`, x0, y);
        ctx.fillText(`${s.score}`, x0 + 16, y);
        const name = s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name;
        ctx.fillText(win ? `${name} ★` : name, x0 + 66, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#9a90b0';
        ctx.fillText(s.depth > 0 ? `B${s.depth}` : '-', VIEW_W - x0 - 96, y);
        ctx.fillText(`${s.kills}`, VIEW_W - x0 - 52, y);
        ctx.fillText(fmtTime(s.timeSec), VIEW_W - x0, y);
      });
      ctx.textAlign = 'left';
    }
    drawCenteredLines(ctx, [
      { text: '- press any key to go back -', y: VIEW_H - 18, font: '8px monospace', color: '#605878' },
    ]);
  }
}

// --- settings ---

export class SettingsScene implements Scene {
  private time = 0;
  private armed = false;
  private cursor = 0;
  private readonly rows = 4; // Sound, Volume, Reduce Flashing, Back
  private game!: Game;

  constructor(private readonly flow: SceneFlow) {}

  enter(game: Game): void {
    this.game = game;
  }

  private apply(): void {
    const s = getSettings();
    this.game.audio.muted = !s.sound;
    this.game.audio.masterVolume = s.sound ? s.volume / 100 : 0;
    saveSettings(s);
  }

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;
    if (!input.anyKey && !input.click) this.armed = true;
    if (!this.armed) return;

    if (input.pause) {
      game.switchScene(this.flow.title());
      return;
    }
    if (input.menuUp) this.cursor = (this.cursor + this.rows - 1) % this.rows;
    if (input.menuDown) this.cursor = (this.cursor + 1) % this.rows;

    const s = getSettings();
    const confirm = input.interact || (input.attack && !input.click) || input.click;
    if (this.cursor === 0) {
      // Sound on/off
      if (input.menuLeft || input.menuRight || confirm) {
        s.sound = !s.sound;
        this.apply();
      }
    } else if (this.cursor === 1) {
      // Volume
      if (input.menuLeft) { s.volume = Math.max(0, s.volume - 10); this.apply(); }
      if (input.menuRight) { s.volume = Math.min(100, s.volume + 10); this.apply(); }
    } else if (this.cursor === 2) {
      if (input.menuLeft || input.menuRight || confirm) {
        s.reduceFlashing = !s.reduceFlashing;
        this.apply();
      }
    } else if (this.cursor === 3 && confirm) {
      game.switchScene(this.flow.title());
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawBackdrop(ctx, this.time);
    drawCenteredLines(ctx, [
      { text: 'S E T T I N G S', y: 30, font: 'bold 16px monospace', color: '#ffd040' },
    ]);
    const s = getSettings();
    const bar = (v: number): string => {
      const filled = Math.round(v / 10);
      return '[' + '█'.repeat(filled) + '·'.repeat(10 - filled) + ']';
    };
    const rows = [
      { label: 'Sound', value: s.sound ? 'On' : 'Off' },
      { label: 'Volume', value: `${bar(s.volume)} ${s.volume}` },
      { label: 'Reduce Flashing', value: s.reduceFlashing ? 'On' : 'Off' },
      { label: 'Back', value: '' },
    ];
    ctx.textBaseline = 'top';
    ctx.font = '10px monospace';
    rows.forEach((r, i) => {
      const y = 92 + i * 22;
      const sel = i === this.cursor;
      ctx.textAlign = 'left';
      ctx.fillStyle = sel ? '#ffd040' : '#b0a8c0';
      ctx.fillText(sel ? `› ${r.label}` : `  ${r.label}`, 90, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = sel ? '#ffe890' : '#9a90b0';
      ctx.fillText(r.value, VIEW_W - 90, y);
    });
    ctx.textAlign = 'left';
    drawCenteredLines(ctx, [
      { text: '↑↓ select   ←→ change   Esc back', y: VIEW_H - 18, font: '8px monospace', color: '#605878' },
    ]);
  }
}

// --- about ---

const ABOUT_LINES = [
  'CORRUPTION CRAWL',
  '',
  'A real-time roguelike where Zelda-style action meets',
  'the creeping doom of ADOM. Explore an overworld of',
  'villages and dungeons, then descend the Chaos Gate to',
  'slay the Herald of Decay — before the corruption',
  'claims you first. Every second, the rot grows.',
  '',
  'Trade with merchants, take quests, cleanse yourself at',
  'shrines, and grow stronger. Death is permanent, but you',
  'can suspend a run and Continue it later.',
  '',
  'Built with TypeScript + HTML5 Canvas. No engine, no art',
  'assets — every sprite and sound is generated in code.',
];

export class AboutScene implements Scene {
  private time = 0;
  private armed = false;

  constructor(private readonly flow: SceneFlow) {}

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;
    if (!input.anyKey && !input.click) this.armed = true;
    if (this.armed && (input.anyKey || input.click)) game.switchScene(this.flow.title());
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawBackdrop(ctx, this.time);
    drawCenteredLines(ctx, [
      { text: 'A B O U T', y: 24, font: 'bold 16px monospace', color: '#ffd040' },
    ]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ABOUT_LINES.forEach((line, i) => {
      const y = 56 + i * 12;
      ctx.font = i === 0 ? 'bold 9px monospace' : '8px monospace';
      ctx.fillStyle = i === 0 ? '#ff30d0' : '#9a90b0';
      ctx.fillText(line, VIEW_W / 2, y);
    });
    ctx.textAlign = 'left';
    drawCenteredLines(ctx, [
      { text: '- press any key to go back -', y: VIEW_H - 18, font: '8px monospace', color: '#605878' },
    ]);
  }
}

// --- run end screens ---

export class GameOverScene implements Scene {
  private time = 0;

  constructor(
    private readonly stats: RunStats,
    private readonly flow: SceneFlow,
    private readonly isHighScore = false,
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
      { text: 'Y O U   D I E D', y: 40, font: 'bold 18px monospace', color: '#e02848' },
      { text: s.identity, y: 66, font: '9px monospace', color: '#e8d8f0' },
      { text: s.cause, y: 80, font: '9px monospace', color: '#c8b0c0' },
      { text: s.depth > 0 ? `Gate floor reached: B${s.depth}` : 'Never braved the Chaos Gate', y: 104, font: '8px monospace', color: '#9a90b0' },
      { text: `Level ${s.level}   Kills: ${s.kills}`, y: 116, font: '8px monospace', color: '#9a90b0' },
      { text: `Corruption: ${s.corruptionPoints}%  (${s.mutationCount} mutations)`, y: 128, font: '8px monospace', color: '#9a90b0' },
      { text: `Time: ${fmtTime(s.timeSec)}`, y: 140, font: '8px monospace', color: '#9a90b0' },
      ...(this.isHighScore
        ? [{ text: '★ NEW HIGH SCORE ★', y: 160, font: 'bold 9px monospace', color: '#ffd040' }]
        : [{ text: 'The dungeon keeps what it takes.', y: 160, font: '8px monospace', color: '#705a68' }]),
      ...(this.time > 1 ? [{ text: '- press any key -', y: 200, font: '9px monospace', color: '#ffd040' }] : []),
    ]);
  }
}

export class VictoryScene implements Scene {
  private time = 0;

  constructor(
    private readonly stats: RunStats,
    private readonly flow: SceneFlow,
    private readonly isHighScore = false,
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
      { text: `${s.identity} slew the Herald of Decay!`, y: 72, font: '9px monospace', color: '#d8e8d0' },
      { text: 'The corruption gutters and dies. The village is saved.', y: 86, font: '8px monospace', color: '#9ab090' },
      { text: `Level ${s.level}   Kills: ${s.kills}`, y: 116, font: '8px monospace', color: '#9a90b0' },
      { text: `Final corruption: ${s.corruptionPoints}%  (${s.mutationCount} mutations)`, y: 128, font: '8px monospace', color: '#9a90b0' },
      { text: `Time: ${fmtTime(s.timeSec)}`, y: 140, font: '8px monospace', color: '#9a90b0' },
      ...(this.isHighScore
        ? [{ text: '★ NEW HIGH SCORE ★', y: 162, font: 'bold 9px monospace', color: '#ffd040' }]
        : []),
      ...(this.time > 1.5 ? [{ text: '- press any key -', y: 196, font: '9px monospace', color: '#ffd040' }] : []),
    ]);
  }
}

/** Kept as an alias so any legacy references to a "title" resolve to the menu. */
export const TitleScene = MenuScene;
