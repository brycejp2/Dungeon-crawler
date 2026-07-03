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
  hotkey: number | null; // 1-9 just pressed — activate hotbar slot
  inventory: boolean; // just pressed — toggle inventory/spellbook window
  menuUp: boolean; // just pressed (up edge / dpad) — menu navigation
  menuDown: boolean; // just pressed
  menuLeft: boolean; // just pressed
  menuRight: boolean; // just pressed
  typed: string; // printable characters typed since last poll (name entry)
  backspace: number; // count of backspace presses since last poll
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
  | 'attack' | 'dodge' | 'useItem' | 'cycleItem' | 'interact' | 'pause' | 'fire'
  | 'inventory' | 'backspace'
  | 'hk1' | 'hk2' | 'hk3' | 'hk4' | 'hk5' | 'hk6' | 'hk7' | 'hk8' | 'hk9';

const KEYMAP: Record<string, Action> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'attack', KeyJ: 'attack', KeyZ: 'attack',
  ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyK: 'dodge', KeyX: 'dodge',
  KeyE: 'useItem', KeyL: 'useItem', KeyC: 'useItem',
  KeyQ: 'cycleItem',
  KeyF: 'interact', Enter: 'interact',
  Escape: 'pause', KeyP: 'pause',
  KeyI: 'inventory', Tab: 'inventory',
  Backspace: 'backspace',
  Digit1: 'hk1', Digit2: 'hk2', Digit3: 'hk3',
  Digit4: 'hk4', Digit5: 'hk5', Digit6: 'hk6',
  Digit7: 'hk7', Digit8: 'hk8', Digit9: 'hk9',
};

const HOTKEY_ACTIONS: Action[] = ['hk1', 'hk2', 'hk3', 'hk4', 'hk5', 'hk6', 'hk7', 'hk8', 'hk9'];

// Standard gamepad mapping: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Select=8 Start=9 DUp=12 DDown=13
const PAD_BUTTONS: [number, Action][] = [
  [0, 'attack'],
  [1, 'dodge'],
  [2, 'useItem'],
  [3, 'cycleItem'],
  [4, 'interact'],
  [5, 'fire'],
  [7, 'fire'],
  [8, 'inventory'],
  [9, 'pause'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
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
  private typedBuf = '';
  private backspaceCount = 0;

  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (action) {
        e.preventDefault();
        if (!this.held.has(action)) this.pressed.add(action);
        this.held.add(action);
      }
      // count every backspace (including several within one sim tick, and key repeat)
      if (e.code === 'Backspace') this.backspaceCount++;
      // collect printable characters for text entry (name field)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && this.typedBuf.length < 8) {
        this.typedBuf += e.key;
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
      hotkey: this.pressedHotkey(),
      inventory: this.pressed.has('inventory'),
      menuUp: this.pressed.has('up'),
      menuDown: this.pressed.has('down'),
      menuLeft: this.pressed.has('left'),
      menuRight: this.pressed.has('right'),
      typed: this.typedBuf,
      backspace: this.backspaceCount,
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
    this.typedBuf = '';
    this.backspaceCount = 0;
    return state;
  }

  private pressedHotkey(): number | null {
    for (let i = 0; i < HOTKEY_ACTIONS.length; i++) {
      if (this.pressed.has(HOTKEY_ACTIONS[i]!)) return i + 1;
    }
    return null;
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
          case 'inventory': state.inventory = true; break;
          case 'up': state.menuUp = true; break;
          case 'down': state.menuDown = true; break;
          case 'left': state.menuLeft = true; break;
          case 'right': state.menuRight = true; break;
          default: break;
        }
        state.anyKey = true;
      }
      if (down) this.padHeld.add(idx);
      else this.padHeld.delete(idx);
    }
  }
}
