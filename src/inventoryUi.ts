// The inventory/spellbook window (I or Tab). The world pauses while it is open.
// Lists held consumables and known spells; select with arrows/mouse, press 1-9 to
// bind the selection to a hotbar slot, E/Enter/click to use or cast it.

import { VIEW_W, VIEW_H } from './config';
import type { InputState } from './input';
import type { Inventory } from './items';
import { ITEMS } from './items';
import type { ItemId } from './items';
import { SPELLS } from './spells';
import type { Spellbook, Hotbar, HotbarEntry } from './spells';
import type { SpriteAtlas } from './render';

const PANEL_X = 40;
const PANEL_Y = 24;
const PANEL_W = VIEW_W - 80;
const PANEL_H = VIEW_H - 60;
const ROW_H = 13;
const LIST_Y = PANEL_Y + 30;

interface Row {
  entry: HotbarEntry;
  header?: never;
}

export interface WindowAction {
  type: 'use' | 'cast';
  entry: HotbarEntry;
}

export class InventoryWindow {
  open = false;
  private cursor = 0;
  private rows: Row[] = [];

  toggle(): void {
    this.open = !this.open;
    this.cursor = 0;
  }

  private rebuild(inventory: Inventory, spellbook: Spellbook): void {
    this.rows = [];
    for (const { id } of inventory.held()) {
      this.rows.push({ entry: { kind: 'item', id } });
    }
    for (const id of spellbook.known) {
      this.rows.push({ entry: { kind: 'spell', id } });
    }
    if (this.cursor >= this.rows.length) this.cursor = Math.max(0, this.rows.length - 1);
  }

  /**
   * Handle a tick of input while open. Returns an action when the player
   * uses/casts the selected entry, or null.
   */
  update(input: InputState, inventory: Inventory, spellbook: Spellbook, hotbar: Hotbar): WindowAction | null {
    this.rebuild(inventory, spellbook);
    if (this.rows.length === 0) return null;

    if (input.menuUp) this.cursor = (this.cursor + this.rows.length - 1) % this.rows.length;
    if (input.menuDown) this.cursor = (this.cursor + 1) % this.rows.length;

    // mouse hover selects; click uses
    let clicked = false;
    if (input.hasPointer) {
      const idx = Math.floor((input.pointerY - LIST_Y) / ROW_H);
      if (idx >= 0 && idx < this.rows.length && input.pointerX >= PANEL_X && input.pointerX <= PANEL_X + PANEL_W) {
        this.cursor = idx;
        if (input.click) clicked = true;
      }
    }

    const selected = this.rows[this.cursor];
    if (!selected) return null;

    // bind to hotbar slot
    if (input.hotkey !== null) {
      hotbar.assign(input.hotkey - 1, selected.entry);
      return null;
    }

    if (input.useItem || input.interact || clicked) {
      return { type: selected.entry.kind === 'item' ? 'use' : 'cast', entry: selected.entry };
    }
    return null;
  }

  render(
    ctx: CanvasRenderingContext2D,
    atlas: SpriteAtlas,
    inventory: Inventory,
    spellbook: Spellbook,
    hotbar: Hotbar,
  ): void {
    ctx.save();
    ctx.textBaseline = 'top';
    // dim the world
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // panel
    ctx.fillStyle = 'rgba(16, 14, 26, 0.95)';
    ctx.fillRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    ctx.strokeStyle = '#6a5a8a';
    ctx.lineWidth = 1;
    ctx.strokeRect(PANEL_X + 0.5, PANEL_Y + 0.5, PANEL_W - 1, PANEL_H - 1);

    ctx.font = '9px monospace';
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText('PACK & SPELLBOOK', PANEL_X + 8, PANEL_Y + 7);
    ctx.font = '6px monospace';
    ctx.fillStyle = '#8878a8';
    ctx.fillText(`mana ${Math.floor(spellbook.mana)}/${spellbook.maxMana}`, PANEL_X + PANEL_W - 66, PANEL_Y + 9);

    if (this.rows.length === 0) {
      ctx.font = '7px monospace';
      ctx.fillStyle = '#707088';
      ctx.fillText('Your pack is empty and your mind is quiet.', PANEL_X + 10, LIST_Y + 4);
    }

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const y = LIST_Y + i * ROW_H;
      if (i === this.cursor) {
        ctx.fillStyle = 'rgba(255, 208, 64, 0.14)';
        ctx.fillRect(PANEL_X + 3, y - 1, PANEL_W - 6, ROW_H - 1);
      }
      const e = row.entry;
      const slot = hotbar.slotOf(e);
      ctx.font = '7px monospace';
      if (e.kind === 'item') {
        const sprite = atlas.items.get(e.id);
        if (sprite) ctx.drawImage(sprite, PANEL_X + 8, y, 10, 10);
        ctx.fillStyle = i === this.cursor ? '#ffe8a0' : '#c8c8d8';
        ctx.fillText(`${ITEMS[e.id].name} x${inventory.count(e.id)}`, PANEL_X + 22, y + 2);
        ctx.fillStyle = '#707088';
        ctx.fillText(this.itemHint(e.id), PANEL_X + 128, y + 2);
      } else {
        const def = SPELLS[e.id];
        const sprite = atlas.spells.get(e.id);
        if (sprite) ctx.drawImage(sprite, PANEL_X + 8, y, 10, 10);
        const affordable = spellbook.canCast(e.id);
        ctx.fillStyle = i === this.cursor ? '#ffe8a0' : affordable ? '#a8c0ff' : '#586078';
        ctx.fillText(`${def.name} (${spellbook.costOf(e.id)} mp)`, PANEL_X + 22, y + 2);
        ctx.fillStyle = '#707088';
        ctx.fillText(def.description, PANEL_X + 128, y + 2);
      }
      if (slot >= 0) {
        ctx.fillStyle = '#ffd040';
        ctx.fillText(`[${slot + 1}]`, PANEL_X + PANEL_W - 22, y + 2);
      }
    }

    ctx.font = '6px monospace';
    ctx.fillStyle = '#8878a8';
    ctx.fillText('up/down select   1-9 bind hotkey   E/click use/cast   I close', PANEL_X + 8, PANEL_Y + PANEL_H - 10);
    ctx.restore();
  }

  private itemHint(id: ItemId): string {
    switch (id) {
      case 'healPotion': return 'restore 2 hearts';
      case 'purityPotion': return '-25 corruption';
      case 'elixir': return '-50 corruption';
      case 'bomb': return 'thrown explosive';
      default: return '';
    }
  }
}
