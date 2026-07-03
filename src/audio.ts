// WebAudio-generated sound effects behind a thin port. No audio assets.
// Everything downstream calls audio.play(sfx) — a native backend can replace this later.

export type SfxId =
  | 'swing' | 'hit' | 'hurt' | 'pickup' | 'stairs' | 'potion'
  | 'mutation' | 'unlock' | 'die' | 'bossRoar' | 'victory' | 'shoot' | 'boom'
  | 'levelup';

export interface AudioPort {
  play(sfx: SfxId): void;
}

interface Note {
  freq: number;
  dur: number;
  type: OscillatorType;
  slide?: number; // target freq to glide to
  delay?: number;
  vol?: number;
}

const SFX: Record<SfxId, Note[]> = {
  swing: [{ freq: 620, dur: 0.06, type: 'square', slide: 220, vol: 0.12 }],
  hit: [{ freq: 200, dur: 0.08, type: 'square', slide: 90, vol: 0.2 }],
  hurt: [{ freq: 150, dur: 0.18, type: 'sawtooth', slide: 60, vol: 0.25 }],
  pickup: [
    { freq: 660, dur: 0.07, type: 'square', vol: 0.15 },
    { freq: 990, dur: 0.09, type: 'square', delay: 0.07, vol: 0.15 },
  ],
  stairs: [
    { freq: 440, dur: 0.09, type: 'triangle', vol: 0.2 },
    { freq: 330, dur: 0.09, type: 'triangle', delay: 0.09, vol: 0.2 },
    { freq: 220, dur: 0.14, type: 'triangle', delay: 0.18, vol: 0.2 },
  ],
  potion: [{ freq: 520, dur: 0.2, type: 'sine', slide: 780, vol: 0.2 }],
  mutation: [
    { freq: 300, dur: 0.25, type: 'sawtooth', slide: 150, vol: 0.25 },
    { freq: 450, dur: 0.3, type: 'sawtooth', slide: 100, delay: 0.1, vol: 0.2 },
  ],
  unlock: [
    { freq: 880, dur: 0.06, type: 'square', vol: 0.15 },
    { freq: 1320, dur: 0.12, type: 'square', delay: 0.08, vol: 0.15 },
  ],
  die: [
    { freq: 260, dur: 0.3, type: 'sawtooth', slide: 40, vol: 0.3 },
    { freq: 130, dur: 0.5, type: 'sawtooth', slide: 30, delay: 0.2, vol: 0.25 },
  ],
  bossRoar: [
    { freq: 90, dur: 0.5, type: 'sawtooth', slide: 45, vol: 0.35 },
    { freq: 120, dur: 0.4, type: 'square', slide: 60, delay: 0.15, vol: 0.25 },
  ],
  victory: [
    { freq: 523, dur: 0.12, type: 'square', vol: 0.2 },
    { freq: 659, dur: 0.12, type: 'square', delay: 0.13, vol: 0.2 },
    { freq: 784, dur: 0.12, type: 'square', delay: 0.26, vol: 0.2 },
    { freq: 1047, dur: 0.35, type: 'square', delay: 0.39, vol: 0.2 },
  ],
  shoot: [{ freq: 950, dur: 0.07, type: 'square', slide: 500, vol: 0.1 }],
  boom: [{ freq: 110, dur: 0.35, type: 'sawtooth', slide: 30, vol: 0.35 }],
  levelup: [
    { freq: 523, dur: 0.09, type: 'square', vol: 0.18 },
    { freq: 659, dur: 0.09, type: 'square', delay: 0.09, vol: 0.18 },
    { freq: 880, dur: 0.22, type: 'square', delay: 0.18, vol: 0.2 },
  ],
};

export class WebAudio implements AudioPort {
  private ctx: AudioContext | null = null;
  muted = false;

  /** Call once from a user-gesture handler; AudioContext requires it. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    void this.ctx?.resume();
  }

  play(sfx: SfxId): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    for (const n of SFX[sfx]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = t0 + (n.delay ?? 0);
      const vol = n.vol ?? 0.2;
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.slide), start + n.dur);
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + n.dur + 0.02);
    }
  }
}

/** No-op backend for tests / headless. */
export class NullAudio implements AudioPort {
  play(): void {}
}
