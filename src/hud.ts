// HUD: hearts, corruption meter, floor number, inventory bar, ADOM-flavor message log.
// All screen-space, drawn last.

import { VIEW_W, VIEW_H, CORRUPTION_MAX, CORRUPTION_THRESHOLDS } from './config';
import type { Player } from './entities';
import type { CorruptionState } from './corruption';
import type { Inventory } from './items';
import type { SpriteAtlas } from './render';

const FONT = '7px monospace';
const FONT_BIG = '10px monospace';

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
    depth: number,
    inventory: Inventory,
    time: number,
  ): void {
    ctx.save();
    ctx.textBaseline = 'top';

    // --- hearts, top-left ---
    const hearts = Math.ceil(player.maxHp / 2);
    for (let i = 0; i < hearts; i++) {
      const filled = player.hp - i * 2; // 2 = full, 1 = half, <=0 empty
      this.drawHeart(ctx, 5 + i * 9, 5, filled >= 2 ? 'full' : filled === 1 ? 'half' : 'empty');
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
    ctx.lineWidth = 1;
    ctx.strokeRect(meterX - 0.5, meterY - 0.5, meterW + 1, 7);
    for (const t of CORRUPTION_THRESHOLDS) {
      const tx = meterX + Math.round((t / CORRUPTION_MAX) * meterW);
      ctx.fillStyle = '#a0a0b8';
      ctx.fillRect(tx, meterY - 2, 1, 2);
    }
    // skull at the doom end
    this.drawSkull(ctx, VIEW_W - 14, 3);

    // --- floor number, top-center ---
    ctx.font = FONT_BIG;
    ctx.fillStyle = '#e8e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(`B${depth}`, VIEW_W / 2, 4);
    ctx.textAlign = 'left';

    // --- inventory bar, bottom ---
    const slots = inventory.consumables();
    const barY = VIEW_H - 16;
    ctx.fillStyle = 'rgba(10, 10, 18, 0.75)';
    ctx.fillRect(0, barY - 2, VIEW_W, 18);
    // weapon
    const weaponSprite = atlas.items.get(inventory.weapon);
    if (weaponSprite) ctx.drawImage(weaponSprite, 6, barY + 1);
    ctx.font = FONT;
    ctx.fillStyle = '#c8c8d8';
    let x = 26;
    for (const slot of slots) {
      const sprite = atlas.items.get(slot.id);
      if (slot.selected && slot.count > 0) {
        ctx.strokeStyle = '#ffd040';
        ctx.strokeRect(x - 1.5, barY - 0.5, 13, 13);
      }
      if (sprite) {
        ctx.globalAlpha = slot.count > 0 ? 1 : 0.25;
        ctx.drawImage(sprite, x, barY + 1);
        ctx.globalAlpha = 1;
      }
      if (slot.count > 0) ctx.fillText(`${slot.count}`, x + 9, barY + 6);
      x += 22;
    }
    if (inventory.hasKey) {
      const keySprite = atlas.items.get('key');
      if (keySprite) ctx.drawImage(keySprite, x + 4, barY + 1);
    }
    ctx.fillStyle = '#707088';
    ctx.fillText('E:use  Q:swap  Shift:dodge  Space:attack', VIEW_W - 178, barY + 4);

    // --- message log above the bar ---
    ctx.font = FONT;
    let my = VIEW_H - 28;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      const alpha = m.age < 2.4 ? 1 : 1 - (m.age - 2.4) / 0.6;
      ctx.fillStyle = `rgba(232, 220, 255, ${Math.max(0, alpha).toFixed(2)})`;
      ctx.fillText(m.text, 6, my);
      my -= 9;
    }

    ctx.restore();
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
