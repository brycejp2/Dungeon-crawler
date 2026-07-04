// HUD: hearts, mana, corruption meter, floor number, 9-slot hotbar, buff/poison
// indicators, ADOM-flavor message log. All screen-space, drawn last.

import { VIEW_W, VIEW_H, CORRUPTION_MAX, CORRUPTION_THRESHOLDS, LEVEL_CAP } from './config';
import type { Player } from './entities';
import type { CorruptionState } from './corruption';
import type { Inventory } from './items';
import type { SpriteAtlas } from './render';
import type { Spellbook, Hotbar, HotbarEntry } from './spells';
import { xpToNext, type Progression } from './progression';

const FONT = '7px monospace';
const FONT_TINY = '6px monospace';
const FONT_BIG = '10px monospace';

export const HOTBAR_SLOT_W = 17;
export const HOTBAR_X = 40;

interface Message {
  text: string;
  age: number;
}

export class Hud {
  private messages: Message[] = [];

  push(text: string): void {
    this.messages.push({ text, age: 0 });
    if (this.messages.length > 3) this.messages.shift();
  }

  update(dt: number): void {
    for (const m of this.messages) m.age += dt;
    this.messages = this.messages.filter((m) => m.age < 3);
  }

  render(
    ctx: CanvasRenderingContext2D,
    atlas: SpriteAtlas,
    player: Player,
    corruption: CorruptionState,
    location: string,
    inventory: Inventory,
    spellbook: Spellbook,
    hotbar: Hotbar,
    progression: Progression,
    time: number,
    contextHint = '',
    quest: { desc: string; done: number; target: number; ready: boolean } | null = null,
  ): void {
    ctx.save();
    ctx.textBaseline = 'top';

    // --- hearts, top-left ---
    const hearts = Math.ceil(player.maxHp / 2);
    for (let i = 0; i < hearts; i++) {
      const filled = player.hp - i * 2; // 2 = full, 1 = half, <=0 empty
      this.drawHeart(ctx, 5 + i * 9, 5, filled >= 2 ? 'full' : filled === 1 ? 'half' : 'empty');
    }

    // --- mana bar under hearts ---
    const manaW = 54;
    ctx.fillStyle = '#101018';
    ctx.fillRect(4, 14, manaW + 2, 5);
    ctx.fillStyle = '#3868e0';
    ctx.fillRect(5, 15, Math.round(manaW * (spellbook.mana / spellbook.maxMana)), 3);
    ctx.strokeStyle = '#606078';
    ctx.lineWidth = 1;
    ctx.strokeRect(4.5, 14.5, manaW + 1, 4);

    // --- xp bar + level under the mana bar ---
    const atCap = progression.level >= LEVEL_CAP;
    const xpFrac = atCap ? 1 : Math.min(1, progression.xp / xpToNext(progression.level));
    ctx.fillStyle = '#101018';
    ctx.fillRect(4, 20, manaW + 2, 4);
    ctx.fillStyle = atCap ? '#ffd040' : '#c8a030';
    ctx.fillRect(5, 21, Math.round(manaW * xpFrac), 2);
    ctx.font = FONT_TINY;
    ctx.fillStyle = '#ffd040';
    ctx.fillText(`Lv ${progression.level}`, 4, 26);

    // --- gold, next to the level ---
    ctx.fillStyle = '#ffd040';
    ctx.fillText(`$${inventory.gold}`, 28, 26);

    // --- status indicators (poison, buffs) right of the bars ---
    let statusX = 66;
    ctx.font = FONT_TINY;
    if (player.poisoned) {
      ctx.fillStyle = Math.floor(time * 3) % 2 === 0 ? '#40e080' : '#208048';
      ctx.fillText('POISON', statusX, 14);
      statusX += 30;
    }
    if (player.hasteT > 0) {
      ctx.fillStyle = '#e0c030';
      ctx.fillText(`HASTE ${Math.ceil(player.hasteT)}`, statusX, 14);
      statusX += 34;
    }
    if (player.stoneskinT > 0) {
      ctx.fillStyle = '#a8b0c0';
      ctx.fillText(`STONE ${Math.ceil(player.stoneskinT)}`, statusX, 14);
    }

    // --- corruption meter, top-right ---
    const meterW = 90;
    const meterX = VIEW_W - meterW - 18;
    const meterY = 6;
    ctx.fillStyle = '#101018';
    ctx.fillRect(meterX - 1, meterY - 1, meterW + 2, 8);
    const frac = corruption.points / CORRUPTION_MAX;
    const pulse = 0.75 + 0.25 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(${Math.round(200 * pulse + 55)}, 0, ${Math.round(180 * pulse + 40)}, 1)`;
    ctx.fillRect(meterX, meterY, Math.round(meterW * frac), 6);
    ctx.strokeStyle = '#606078';
    ctx.strokeRect(meterX - 0.5, meterY - 0.5, meterW + 1, 7);
    for (const t of CORRUPTION_THRESHOLDS) {
      const tx = meterX + Math.round((t / CORRUPTION_MAX) * meterW);
      ctx.fillStyle = '#a0a0b8';
      ctx.fillRect(tx, meterY - 2, 1, 2);
    }
    this.drawSkull(ctx, VIEW_W - 14, 3);

    // --- location name, top-center ---
    ctx.font = FONT_BIG;
    ctx.fillStyle = '#e8e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(location, VIEW_W / 2, 4);
    ctx.textAlign = 'left';

    // --- hotbar, bottom ---
    const barY = VIEW_H - 18;
    ctx.fillStyle = 'rgba(10, 10, 18, 0.8)';
    ctx.fillRect(0, barY - 3, VIEW_W, 21);
    // weapon + bow to the left of the numbered slots
    const weaponSprite = atlas.items.get(inventory.weapon);
    if (weaponSprite) ctx.drawImage(weaponSprite, 5, barY + 2, 10, 10);
    ctx.font = FONT;
    if (inventory.hasBow) {
      const bowSprite = atlas.items.get('bow');
      if (bowSprite) {
        ctx.globalAlpha = inventory.arrows > 0 ? 1 : 0.35;
        ctx.drawImage(bowSprite, 19, barY + 2, 10, 10);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#c8c8d8';
      ctx.fillText(`${inventory.arrows}`, 27, barY + 8);
    }
    // 9 numbered slots
    for (let i = 0; i < 9; i++) {
      const x = HOTBAR_X + i * HOTBAR_SLOT_W;
      const entry = hotbar.get(i);
      ctx.fillStyle = 'rgba(30, 30, 46, 0.9)';
      ctx.fillRect(x, barY, 15, 15);
      ctx.strokeStyle = i === hotbar.selected ? '#ffd040' : '#4a4a62';
      ctx.strokeRect(x + 0.5, barY + 0.5, 14, 14);
      ctx.font = FONT_TINY;
      ctx.fillStyle = '#707088';
      ctx.fillText(`${i + 1}`, x + 1, barY + 1);
      if (!entry) continue;
      this.drawEntryIcon(ctx, atlas, entry, x + 3, barY + 4, inventory, spellbook);
    }
    if (inventory.hasKey) {
      const keySprite = atlas.items.get('key');
      if (keySprite) ctx.drawImage(keySprite, HOTBAR_X + 9 * HOTBAR_SLOT_W + 4, barY + 2, 10, 10);
    }
    ctx.font = FONT_TINY;
    ctx.fillStyle = '#707088';
    ctx.fillText('1-9 use', VIEW_W - 42, barY + 1);
    ctx.fillText('I: bag', VIEW_W - 42, barY + 8);

    // --- context hint (shrines, healers) centered above the bar ---
    if (contextHint) {
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd040';
      ctx.fillText(contextHint, VIEW_W / 2, barY - 12);
      ctx.textAlign = 'left';
    }

    // --- quest tracker, right side above the bar ---
    if (quest) {
      ctx.font = FONT_TINY;
      ctx.textAlign = 'right';
      ctx.fillStyle = quest.ready ? '#68e068' : '#c8b060';
      const label = quest.ready
        ? 'QUEST DONE - see Capt. Aldric'
        : `${quest.desc}: ${quest.done}/${quest.target}`;
      ctx.fillText(label, VIEW_W - 6, barY - 10);
      ctx.textAlign = 'left';
    }

    // --- message log above the bar ---
    ctx.font = FONT;
    let my = VIEW_H - 30;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      const alpha = m.age < 2.4 ? 1 : 1 - (m.age - 2.4) / 0.6;
      ctx.fillStyle = `rgba(232, 220, 255, ${Math.max(0, alpha).toFixed(2)})`;
      ctx.fillText(m.text, 6, my);
      my -= 9;
    }

    ctx.restore();
  }

  private drawEntryIcon(
    ctx: CanvasRenderingContext2D,
    atlas: SpriteAtlas,
    entry: HotbarEntry,
    x: number,
    y: number,
    inventory: Inventory,
    spellbook: Spellbook,
  ): void {
    if (entry.kind === 'item') {
      const count = inventory.count(entry.id);
      const sprite = atlas.items.get(entry.id);
      if (sprite) {
        ctx.globalAlpha = count > 0 ? 1 : 0.25;
        ctx.drawImage(sprite, x, y, 10, 10);
        ctx.globalAlpha = 1;
      }
      if (count > 0) {
        ctx.font = FONT_TINY;
        ctx.fillStyle = '#e8e8f0';
        ctx.fillText(`${count}`, x + 7, y + 5);
      }
    } else {
      const canCast = spellbook.canCast(entry.id);
      const sprite = atlas.spells.get(entry.id);
      if (sprite) {
        ctx.globalAlpha = canCast ? 1 : 0.3;
        ctx.drawImage(sprite, x, y, 10, 10);
        ctx.globalAlpha = 1;
      }
      ctx.font = FONT_TINY;
      ctx.fillStyle = canCast ? '#68a0ff' : '#485068';
      ctx.fillText(`${spellbook.costOf(entry.id)}`, x + 8, y + 5);
    }
  }

  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'full' | 'half' | 'empty'): void {
    ctx.fillStyle = '#38202a';
    // heart silhouette from rects (chunky pixel heart, 8x7)
    ctx.fillRect(x + 1, y, 2, 2);
    ctx.fillRect(x + 5, y, 2, 2);
    ctx.fillRect(x, y + 1, 8, 3);
    ctx.fillRect(x + 1, y + 4, 6, 1);
    ctx.fillRect(x + 2, y + 5, 4, 1);
    ctx.fillRect(x + 3, y + 6, 2, 1);
    if (kind === 'empty') return;
    ctx.fillStyle = '#e02848';
    const clip = kind === 'half' ? 4 : 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, clip, 8);
    ctx.clip();
    ctx.fillRect(x + 1, y, 2, 2);
    ctx.fillRect(x + 5, y, 2, 2);
    ctx.fillRect(x, y + 1, 8, 3);
    ctx.fillRect(x + 1, y + 4, 6, 1);
    ctx.fillRect(x + 2, y + 5, 4, 1);
    ctx.fillRect(x + 3, y + 6, 2, 1);
    ctx.restore();
  }

  private drawSkull(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = '#d8d8e8';
    ctx.fillRect(x + 1, y, 6, 5);
    ctx.fillRect(x + 2, y + 5, 4, 2);
    ctx.fillStyle = '#101018';
    ctx.fillRect(x + 2, y + 2, 1, 2);
    ctx.fillRect(x + 5, y + 2, 1, 2);
    ctx.fillRect(x + 3, y + 5, 1, 1);
    ctx.fillRect(x + 5, y + 5, 1, 1);
  }
}

// --- NPC dialog / shop panel -------------------------------------------------

export interface DialogEntry {
  label: string;
  dim?: boolean; // unaffordable / sold out / not applicable
}

export interface DialogView {
  title: string;
  lines: string[]; // flavor text above the choices
  entries: DialogEntry[];
  cursor: number;
}

/** Centered bordered panel for talking/trading; world is paused behind it. */
export function drawDialogPanel(ctx: CanvasRenderingContext2D, view: DialogView): void {
  const w = 260;
  const rows = view.lines.length + view.entries.length;
  const h = 42 + rows * 12;
  const x = Math.floor((VIEW_W - w) / 2);
  const y = Math.floor((VIEW_H - h) / 2);
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(8, 8, 16, 0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#8a7a3a';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.font = FONT;
  ctx.fillStyle = '#ffd040';
  ctx.fillText(view.title, x + 10, y + 8);
  let ly = y + 22;
  for (const line of view.lines) {
    ctx.fillStyle = '#9a9ab0';
    ctx.fillText(line, x + 12, ly);
    ly += 12;
  }
  view.entries.forEach((e, i) => {
    if (i === view.cursor) {
      ctx.fillStyle = 'rgba(255, 208, 64, 0.12)';
      ctx.fillRect(x + 6, ly - 2, w - 12, 11);
      ctx.fillStyle = '#ffd040';
      ctx.fillText('>', x + 8, ly);
    }
    ctx.fillStyle = e.dim ? '#606078' : i === view.cursor ? '#ffe8a0' : '#e8e0c8';
    ctx.fillText(e.label, x + 18, ly);
    ly += 12;
  });
  ctx.fillStyle = '#707088';
  ctx.font = FONT_TINY;
  ctx.fillText('Up/Down: select   F/Enter: confirm   Esc: leave', x + 10, y + h - 10);
  ctx.restore();
}
