// Input abstraction. Game code consumes virtual actions only — never raw key codes —
// so keyboard, mouse, and gamepad all feed the same InputState; a touch backend for
// mobile slots in the same way.

export interface InputState {
  moveX: number; // -1..1 (keyboard or left stick)
  moveY: number; // -1..1
  attack: boolean; // just pressed this tick
  dodge: boolean; // just pressed
  useItem: boolean; // just pressed
  cycleItem: boolean; // just pressed
  interact: boolean; // just pressed
  pause: boolean; // just pressed
  fire: boolean; // just pressed (mouse click / RT / RB) — ranged attack
  anyKey: boolean; // just pressed (menus)
  // aiming
  pointerX: number; // virtual-canvas coords (mouse)
  pointerY: number;
  hasPointer: boolean; // mouse has moved at least once
  stickX: number; // right analog stick direction, deadzone applied
  stickY: number;
  hasStick: boolean; // stick currently deflected — takes priority over pointer
}

type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'attack' | 'dodge' | 'useItem' | 'cycleItem' | 'interact' | 'pause' | 'fire';

const KEYMAP: Record<string, Action> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'attack', KeyJ: 'attack', KeyZ: 'attack',
  ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyK: 'dodge', KeyX: 'dodge',
  KeyE: 'useItem', KeyL: 'useItem', KeyC: 'useItem',
  KeyQ: 'cycleItem', Tab: 'cycleItem',
  KeyF: 'interact', Enter: 'interact',
  Escape: 'pause', KeyP: 'pause',
};

// Standard gamepad mapping: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Start=9
const PAD_BUTTONS: [number, Action][] = [
  [0, 'attack'],
  [1, 'dodge'],
  [2, 'useItem'],
  [3, 'cycleItem'],
  [4, 'interact'],
  [5, 'fire'],
  [7, 'fire'],
  [9, 'pause'],
];

const STICK_DEADZONE = 0.25;

export class InputHub {
  private held = new Set<Action>();
  private pressed = new Set<Action>(); // accumulated since last poll
  private anyPressed = false;
  private padHeld = new Set<number>();
  private pointerX = 0;
  private pointerY = 0;
  private hasPointer = false;

  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (action) {
        e.preventDefault();
        if (!this.held.has(action)) this.pressed.add(action);
        this.held.add(action);
      }
      if (!e.repeat) this.anyPressed = true;
    });
    target.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (action) this.held.delete(action);
    });
    target.addEventListener('blur', () => {
      this.held.clear();
    });
  }

  /**
   * Wire mouse aiming/firing. toVirtual converts client coords to
   * virtual-canvas coords (main.ts knows the integer scale).
   */
  attachPointer(el: HTMLElement, toVirtual: (clientX: number, clientY: number) => { x: number; y: number }): void {
    el.addEventListener('pointermove', (e) => {
      const p = toVirtual(e.clientX, e.clientY);
      this.pointerX = p.x;
      this.pointerY = p.y;
      this.hasPointer = true;
    });
    el.addEventListener('pointerdown', (e) => {
      const p = toVirtual(e.clientX, e.clientY);
      this.pointerX = p.x;
      this.pointerY = p.y;
      this.hasPointer = true;
      if (e.button === 0) this.pressed.add('fire');
      this.anyPressed = true;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Poll once per simulation tick; consumes just-pressed edges. */
  poll(): InputState {
    const state: InputState = {
      moveX: (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0),
      moveY: (this.held.has('down') ? 1 : 0) - (this.held.has('up') ? 1 : 0),
      attack: this.pressed.has('attack'),
      dodge: this.pressed.has('dodge'),
      useItem: this.pressed.has('useItem'),
      cycleItem: this.pressed.has('cycleItem'),
      interact: this.pressed.has('interact'),
      pause: this.pressed.has('pause'),
      fire: this.pressed.has('fire'),
      anyKey: this.anyPressed,
      pointerX: this.pointerX,
      pointerY: this.pointerY,
      hasPointer: this.hasPointer,
      stickX: 0,
      stickY: 0,
      hasStick: false,
    };
    this.pollGamepad(state);
    this.pressed.clear();
    this.anyPressed = false;
    return state;
  }

  private pollGamepad(state: InputState): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let pad: Gamepad | null = null;
    for (const p of navigator.getGamepads()) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) return;

    const dz = (v: number | undefined): number => {
      const x = v ?? 0;
      return Math.abs(x) > STICK_DEADZONE ? x : 0;
    };

    // Left stick: movement (merges with keyboard, clamped)
    const lx = dz(pad.axes[0]);
    const ly = dz(pad.axes[1]);
    if (lx !== 0 || ly !== 0) {
      state.moveX = Math.max(-1, Math.min(1, state.moveX + lx));
      state.moveY = Math.max(-1, Math.min(1, state.moveY + ly));
    }

    // Right stick: aim direction (takes priority over the mouse pointer)
    const rx = dz(pad.axes[2]);
    const ry = dz(pad.axes[3]);
    if (rx !== 0 || ry !== 0) {
      state.stickX = rx;
      state.stickY = ry;
      state.hasStick = true;
    }

    // Buttons with edge detection
    for (const [idx, action] of PAD_BUTTONS) {
      const down = pad.buttons[idx]?.pressed ?? false;
      const was = this.padHeld.has(idx);
      if (down && !was) {
        switch (action) {
          case 'attack': state.attack = true; break;
          case 'dodge': state.dodge = true; break;
          case 'useItem': state.useItem = true; break;
          case 'cycleItem': state.cycleItem = true; break;
          case 'interact': state.interact = true; break;
          case 'pause': state.pause = true; break;
          case 'fire': state.fire = true; break;
          default: break;
        }
        state.anyKey = true;
      }
      if (down) this.padHeld.add(idx);
      else this.padHeld.delete(idx);
    }
  }
}
