// Input abstraction. Game code consumes virtual actions only — never raw key codes —
// so a touch/gamepad backend can be swapped in for mobile without touching game logic.

export interface InputState {
  moveX: number; // -1..1
  moveY: number; // -1..1
  attack: boolean; // just pressed this tick
  dodge: boolean; // just pressed
  useItem: boolean; // just pressed
  cycleItem: boolean; // just pressed
  interact: boolean; // just pressed
  pause: boolean; // just pressed
  anyKey: boolean; // just pressed (menus)
}

type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'dodge' | 'useItem' | 'cycleItem' | 'interact' | 'pause';

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

export class Keyboard {
  private held = new Set<Action>();
  private pressed = new Set<Action>(); // accumulated since last poll
  private anyPressed = false;

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
      anyKey: this.anyPressed,
    };
    this.pressed.clear();
    this.anyPressed = false;
    return state;
  }
}
