// Fixed-timestep game loop + scene manager.
// Simulation always steps at DT; rendering happens once per animation frame.

import { DT, MAX_STEPS_PER_FRAME } from './config';
import type { InputState } from './input';
import { InputHub } from './input';
import type { AudioPort } from './audio';

export interface Scene {
  update(dt: number, input: InputState, game: Game): void;
  render(ctx: CanvasRenderingContext2D): void;
  enter?(game: Game): void;
}

export interface RunStats {
  depth: number;
  kills: number;
  corruptionPoints: number;
  mutationCount: number;
  timeSec: number;
  cause: string; // how the run ended
}

/** Scene factories wired up in main.ts so scenes and PlayScene never import each other. */
export interface SceneFlow {
  title(): Scene;
  newRun(seed?: number, startDepth?: number): Scene;
  gameOver(stats: RunStats): Scene;
  victory(stats: RunStats): Scene;
}

export class Game {
  private scene: Scene | null = null;
  private accumulator = 0;
  private lastTime = 0;
  readonly input = new InputHub();

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    readonly audio: AudioPort,
  ) {}

  get currentScene(): Scene | null {
    return this.scene;
  }

  switchScene(scene: Scene): void {
    this.scene = scene;
    scene.enter?.(this);
  }

  start(): void {
    this.lastTime = performance.now();
    const frame = (now: number) => {
      this.accumulator += Math.min((now - this.lastTime) / 1000, DT * MAX_STEPS_PER_FRAME);
      this.lastTime = now;
      while (this.accumulator >= DT) {
        this.accumulator -= DT;
        const input = this.input.poll();
        this.scene?.update(DT, input, this);
      }
      if (this.scene) this.scene.render(this.ctx);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
