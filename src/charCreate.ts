// Character creation: name, gender, race, class, and a blessing chosen from a
// random set of 4 — plus full randomize. Keyboard, mouse, and gamepad all work.

import { VIEW_W, VIEW_H } from './config';
import type { Game, Scene, SceneFlow } from './game';
import type { InputState } from './input';
import { Rng } from './rng';
import {
  GENDERS, RACES, CLASSES, BLESSINGS, ALL_RACES, ALL_CLASSES,
  rollBlessingOptions, randomName, randomCharacter,
} from './character';
import type { CharacterDef, BlessingId } from './character';

const MAX_NAME = 14;

// vertical layout
const ROWS = ['name', 'gender', 'race', 'clazz', 'blessing', 'randomize', 'begin'] as const;
type RowId = (typeof ROWS)[number];
const ROW_Y: Record<RowId, number> = {
  name: 52,
  gender: 70,
  race: 88,
  clazz: 112,
  blessing: 136,
  randomize: 176,
  begin: 192,
};

export class CharCreateScene implements Scene {
  private time = 0;
  private cursor = 0;
  private editingName = false;
  private rng = new Rng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  private blessingOptions: BlessingId[];
  private def: CharacterDef;

  constructor(private readonly flow: SceneFlow) {
    this.blessingOptions = rollBlessingOptions(this.rng);
    this.def = randomCharacter(this.rng, this.blessingOptions);
  }

  private randomize(): void {
    this.blessingOptions = rollBlessingOptions(this.rng);
    this.def = randomCharacter(this.rng, this.blessingOptions);
  }

  private cycleRow(row: RowId, dir: number): void {
    switch (row) {
      case 'gender': {
        const i = GENDERS.findIndex((g) => g.id === this.def.gender);
        this.def.gender = GENDERS[(i + dir + GENDERS.length) % GENDERS.length]!.id;
        break;
      }
      case 'race': {
        const i = ALL_RACES.indexOf(this.def.race);
        this.def.race = ALL_RACES[(i + dir + ALL_RACES.length) % ALL_RACES.length]!;
        break;
      }
      case 'clazz': {
        const i = ALL_CLASSES.indexOf(this.def.clazz);
        this.def.clazz = ALL_CLASSES[(i + dir + ALL_CLASSES.length) % ALL_CLASSES.length]!;
        break;
      }
      case 'blessing': {
        const i = this.blessingOptions.indexOf(this.def.blessing);
        this.def.blessing = this.blessingOptions[(i + dir + 4) % 4]!;
        break;
      }
      case 'name':
        this.def.name = randomName(this.rng);
        break;
      default:
        break;
    }
  }

  private activate(row: RowId, game: Game): void {
    switch (row) {
      case 'name':
        this.editingName = !this.editingName;
        break;
      case 'randomize':
        this.randomize();
        break;
      case 'begin':
        if (this.def.name.trim().length === 0) this.def.name = randomName(this.rng);
        game.switchScene(this.flow.newRun({ ...this.def, name: this.def.name.trim() }));
        break;
      default:
        this.cycleRow(row, 1);
    }
  }

  update(dt: number, input: InputState, game: Game): void {
    this.time += dt;

    if (this.editingName) {
      // deletions first so "clear then retype" within one tick behaves
      if (input.backspace > 0) {
        this.def.name = this.def.name.slice(0, Math.max(0, this.def.name.length - input.backspace));
      }
      for (const ch of input.typed) {
        if (/[a-zA-Z0-9 '\-]/.test(ch) && this.def.name.length < MAX_NAME) {
          this.def.name += ch;
        }
      }
      if (input.interact || input.pause || input.inventory || input.click) this.editingName = false;
      return; // navigation is suspended while typing
    }

    if (input.menuUp) this.cursor = (this.cursor + ROWS.length - 1) % ROWS.length;
    if (input.menuDown) this.cursor = (this.cursor + 1) % ROWS.length;

    // mouse hover + click
    let clicked = false;
    if (input.hasPointer) {
      for (let i = 0; i < ROWS.length; i++) {
        const y = ROW_Y[ROWS[i]!];
        if (input.pointerY >= y - 3 && input.pointerY < y + 12 && input.pointerX > 40 && input.pointerX < VIEW_W - 40) {
          this.cursor = i;
          if (input.click) clicked = true;
        }
      }
    }

    const row = ROWS[this.cursor]!;
    if (input.menuLeft) this.cycleRow(row, -1);
    if (input.menuRight) this.cycleRow(row, 1);
    // Keyboard/gamepad attack confirms; a mouse press only confirms when it
    // actually lands on a row (left click also raises `attack` for combat).
    const keyboardConfirm = input.attack && !input.click;
    if (input.interact || keyboardConfirm || clicked) this.activate(row, game);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#08060c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const pulse = 0.1 + 0.04 * Math.sin(this.time * 2);
    const grad = ctx.createRadialGradient(VIEW_W / 2, 30, 8, VIEW_W / 2, 30, 110);
    grad.addColorStop(0, `rgba(200, 0, 170, ${pulse.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(200, 0, 170, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#ff30d0';
    ctx.fillText('FORGE YOUR HERO', VIEW_W / 2, 18);
    ctx.textAlign = 'left';

    const label = (row: RowId): void => {
      const selected = ROWS[this.cursor] === row;
      const y = ROW_Y[row];
      if (selected) {
        ctx.fillStyle = 'rgba(255, 208, 64, 0.12)';
        ctx.fillRect(42, y - 3, VIEW_W - 84, 14);
        ctx.fillStyle = '#ffd040';
        ctx.font = '8px monospace';
        ctx.fillText('>', 46, y + 1);
      }
    };
    const field = (row: RowId, name: string, value: string, arrows: boolean): void => {
      const selected = ROWS[this.cursor] === row;
      const y = ROW_Y[row];
      label(row);
      ctx.font = '8px monospace';
      ctx.fillStyle = '#8878a8';
      ctx.fillText(name, 56, y + 1);
      ctx.fillStyle = selected ? '#ffe8a0' : '#d8d8e8';
      const text = arrows && selected ? `< ${value} >` : value;
      ctx.fillText(text, 122, y + 1);
    };

    // name (with blinking caret while editing)
    const caret = this.editingName && Math.floor(this.time * 3) % 2 === 0 ? '_' : '';
    field('name', 'NAME', `${this.def.name}${caret}`, false);
    if (ROWS[this.cursor] === 'name') {
      ctx.font = '6px monospace';
      ctx.fillStyle = '#707088';
      ctx.fillText(this.editingName ? 'type to edit, Enter when done' : 'Enter to edit, left/right rerolls', 250, ROW_Y.name + 2);
    }

    field('gender', 'GENDER', GENDERS.find((g) => g.id === this.def.gender)!.name, true);

    const race = RACES[this.def.race];
    field('race', 'RACE', race.name, true);
    ctx.font = '6px monospace';
    ctx.fillStyle = '#707088';
    ctx.fillText(race.description, 122, ROW_Y.race + 11);

    const clazz = CLASSES[this.def.clazz];
    field('clazz', 'CLASS', clazz.name, true);
    ctx.fillStyle = '#707088';
    ctx.fillText(clazz.description, 122, ROW_Y.clazz + 11);

    // blessing: chosen one plus the other rolled options as dots
    const blessing = BLESSINGS[this.def.blessing];
    field('blessing', 'BLESSING', blessing.name, true);
    ctx.fillStyle = '#707088';
    ctx.fillText(blessing.description, 122, ROW_Y.blessing + 11);
    // option pips
    for (let i = 0; i < this.blessingOptions.length; i++) {
      const chosen = this.blessingOptions[i] === this.def.blessing;
      ctx.fillStyle = chosen ? '#ffd040' : '#4a4a62';
      ctx.fillRect(122 + i * 8, ROW_Y.blessing + 20, 5, 3);
    }
    ctx.fillStyle = '#585068';
    ctx.fillText('the fates offer four; choose one', 160, ROW_Y.blessing + 19);

    // buttons
    const button = (row: RowId, text: string, color: string): void => {
      const selected = ROWS[this.cursor] === row;
      const y = ROW_Y[row];
      label(row);
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = selected ? '#ffe8a0' : color;
      ctx.fillText(selected ? `[ ${text} ]` : text, VIEW_W / 2, y);
      ctx.textAlign = 'left';
    };
    button('randomize', 'RANDOMIZE', '#8878a8');
    button('begin', 'BEGIN THE DESCENT', '#ffd040');

    ctx.font = '6px monospace';
    ctx.fillStyle = '#585068';
    ctx.textAlign = 'center';
    ctx.fillText('arrows/WASD move  left/right change  Enter/Space/click select', VIEW_W / 2, VIEW_H - 14);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}
