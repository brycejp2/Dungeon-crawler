// Rendering: procedural sprite atlas (no art assets), camera, tilemap, fog of war,
// corruption visuals. Draws in logical coordinates to a PX-supersampled canvas;
// sprites are baked at PX x detail and drawn back at logical size, so each art
// texel lands on exactly one framebuffer pixel.

import {
  TILE, VIEW_W, VIEW_H, MAP_W, MAP_H, PX, EXPLORED_BRIGHTNESS, CORRUPTION_MAX,
  SWING_REACH, SWING_HALF_ANGLE,
} from './config';
import { Tile } from './dungeon';
import type { FloorData, EnemyKind } from './dungeon';
import type { Facing } from './combat';
import type { Player, Enemy, Projectile, Pickup } from './entities';
import type { ItemId } from './items';
import type { SpellId } from './spells';

export const FOG_HIDDEN = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

function mkCanvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  draw(c);
  return canvas;
}

/**
 * Bake a sprite at PX x supersampled detail. `w`/`h` are the logical size the
 * sprite occupies in the world; the painter draws on a canvas PX times larger,
 * so it works on a grid twice as fine as the old art.
 */
function mkSprite(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  return mkCanvas(w * PX, h * PX, draw);
}

/** Bake legacy 1x painters (small UI icons) by scaling the context up. */
function mkScaled(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  return mkCanvas(w * PX, h * PX, (c) => {
    c.scale(PX, PX);
    draw(c);
  });
}

/** Round a logical coordinate to the framebuffer pixel grid (1/PX steps). */
function snap(v: number): number {
  return Math.round(v * PX) / PX;
}

function tintMagenta(base: HTMLCanvasElement): HTMLCanvasElement {
  return mkCanvas(base.width, base.height, (c) => {
    c.drawImage(base, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(255, 0, 220, 0.45)';
    c.fillRect(0, 0, base.width, base.height);
  });
}

// --- sprite painters ---

export interface PlayerPalette {
  skin: string;
  hair: string;
  longHair?: boolean; // extra side locks
}

const DEFAULT_PALETTE: PlayerPalette = { skin: '#f0c890', hair: '#7a4a20' };

// All world painters draw at PX x detail: coordinates below are framebuffer
// pixels on a grid twice as fine as the logical world unit.

function paintPlayer(c: CanvasRenderingContext2D, facing: Facing, pal: PlayerPalette): void {
  // logical 12x14 -> 24x28 canvas: boots, tunic with belt+shading, arms, head
  const side = facing === 'left' || facing === 'right';
  // boots
  c.fillStyle = '#4a2e16';
  c.fillRect(4, 24, 6, 4);
  c.fillRect(14, 24, 6, 4);
  c.fillStyle = '#5a3a1e';
  c.fillRect(4, 24, 6, 2);
  c.fillRect(14, 24, 6, 2);
  // tunic
  c.fillStyle = '#227a36';
  c.fillRect(2, 12, 20, 12);
  c.fillStyle = '#2e9e46';
  c.fillRect(3, 12, 18, 9); // lit torso
  c.fillStyle = '#38b854';
  c.fillRect(4, 13, 7, 4); // chest highlight
  // belt
  c.fillStyle = '#4a2e16';
  c.fillRect(3, 20, 18, 2);
  c.fillStyle = '#c8a040';
  c.fillRect(10, 20, 4, 2); // buckle
  // arms (skin) at the tunic sides
  c.fillStyle = pal.skin;
  if (side) {
    c.fillRect(facing === 'left' ? 1 : 20, 14, 3, 6);
  } else {
    c.fillRect(0, 14, 3, 6);
    c.fillRect(21, 14, 3, 6);
  }
  // head
  c.fillStyle = pal.skin;
  c.fillRect(5, 2, 14, 11);
  c.fillStyle = 'rgba(0,0,0,0.15)';
  c.fillRect(5, 11, 14, 2); // chin shadow
  // hair
  c.fillStyle = pal.hair;
  c.fillRect(4, 0, 16, 4);
  c.fillRect(4, 3, 3, 3);
  c.fillRect(17, 3, 3, 3);
  if (facing === 'up') c.fillRect(5, 2, 14, 9); // back of head: all hair
  if (pal.longHair) {
    c.fillRect(3, 2, 2, 11);
    c.fillRect(19, 2, 2, 11);
  }
  // face
  c.fillStyle = '#1a1a2e';
  if (facing === 'down') {
    c.fillRect(8, 7, 2, 3);
    c.fillRect(14, 7, 2, 3);
  } else if (facing === 'left') {
    c.fillRect(6, 7, 2, 3);
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillRect(13, 3, 6, 10); // turned-away shading
  } else if (facing === 'right') {
    c.fillRect(16, 7, 2, 3);
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillRect(5, 3, 6, 10);
  }
}

function paintChaser(c: CanvasRenderingContext2D): void {
  // logical 11x12 -> 22x24 goblin: warty body, big ears, mad grin
  c.fillStyle = '#516d1e';
  c.fillRect(2, 6, 18, 16); // body outline-ish base
  c.fillStyle = '#6a8a2a';
  c.fillRect(3, 6, 16, 14);
  c.fillStyle = '#7fa338';
  c.fillRect(4, 7, 7, 5); // highlight
  // ears
  c.fillStyle = '#6a8a2a';
  c.fillRect(0, 2, 5, 8);
  c.fillRect(17, 2, 5, 8);
  c.fillStyle = '#516d1e';
  c.fillRect(1, 3, 2, 5);
  c.fillRect(19, 3, 2, 5);
  // feet
  c.fillStyle = '#3a5a10';
  c.fillRect(4, 22, 6, 2);
  c.fillRect(12, 22, 6, 2);
  // eyes: yellow with dark pupils
  c.fillStyle = '#ffdd30';
  c.fillRect(5, 10, 4, 4);
  c.fillRect(13, 10, 4, 4);
  c.fillStyle = '#201800';
  c.fillRect(7, 11, 2, 2);
  c.fillRect(14, 11, 2, 2);
  // grin with teeth
  c.fillStyle = '#902020';
  c.fillRect(7, 16, 8, 3);
  c.fillStyle = '#e8e8d8';
  c.fillRect(8, 16, 2, 1);
  c.fillRect(12, 16, 2, 1);
  // warts
  c.fillStyle = '#8fae48';
  c.fillRect(16, 8, 1, 1);
  c.fillRect(5, 16, 1, 1);
}

function paintArcher(c: CanvasRenderingContext2D): void {
  // logical 10x12 -> 20x24 hooded cultist: layered robe, glowing eyes, bow arm
  c.fillStyle = '#411c4e';
  c.fillRect(2, 4, 16, 20); // robe base
  c.fillStyle = '#5a2a6a';
  c.fillRect(3, 4, 14, 18);
  c.fillStyle = '#6d3580';
  c.fillRect(4, 12, 5, 8); // fold highlight
  c.fillStyle = '#411c4e';
  c.fillRect(9, 12, 2, 10); // center fold shadow
  // hood
  c.fillStyle = '#3a1a4a';
  c.fillRect(2, 2, 16, 9);
  c.fillStyle = '#2a1038';
  c.fillRect(4, 6, 12, 5); // hood cavity
  // glowing eyes
  c.fillStyle = '#ff4040';
  c.fillRect(6, 8, 2, 2);
  c.fillRect(12, 8, 2, 2);
  c.fillStyle = '#ffb0a0';
  c.fillRect(6, 8, 1, 1);
  c.fillRect(12, 8, 1, 1);
  // rope belt
  c.fillStyle = '#c8a040';
  c.fillRect(3, 14, 14, 1);
  // bow arm
  c.fillStyle = '#8a6a2a';
  c.fillRect(0, 12, 3, 9);
  c.fillStyle = '#a8823a';
  c.fillRect(0, 12, 1, 9);
}

function paintBat(c: CanvasRenderingContext2D): void {
  // logical 9x8 -> 18x16: membrane wings with finger bones
  c.fillStyle = '#4a4a6a';
  c.fillRect(0, 4, 6, 6); // left wing
  c.fillRect(12, 4, 6, 6); // right wing
  c.fillStyle = '#3a3a54';
  c.fillRect(0, 8, 6, 2); // wing bottom shading
  c.fillRect(12, 8, 6, 2);
  c.fillStyle = '#5d5d80';
  c.fillRect(2, 4, 1, 5); // wing bones
  c.fillRect(4, 4, 1, 5);
  c.fillRect(13, 4, 1, 5);
  c.fillRect(15, 4, 1, 5);
  // body
  c.fillStyle = '#2a2a3e';
  c.fillRect(6, 2, 6, 10);
  c.fillStyle = '#383850';
  c.fillRect(7, 3, 3, 4);
  // ears
  c.fillStyle = '#2a2a3e';
  c.fillRect(6, 0, 2, 3);
  c.fillRect(10, 0, 2, 3);
  // eyes + fangs
  c.fillStyle = '#ff3030';
  c.fillRect(7, 4, 1, 2);
  c.fillRect(10, 4, 1, 2);
  c.fillStyle = '#e8e8d8';
  c.fillRect(7, 9, 1, 2);
  c.fillRect(10, 9, 1, 2);
}

function paintBoss(c: CanvasRenderingContext2D): void {
  // logical 26x26 -> 52x52 Herald of Decay: horned bulk, glowing seams, maw
  // body
  c.fillStyle = '#3f1034';
  c.fillRect(5, 11, 42, 38); // dark rim
  c.fillStyle = '#5a1a4a';
  c.fillRect(7, 13, 38, 34);
  c.fillStyle = '#7a2a5a';
  c.fillRect(10, 16, 32, 24); // lit mass
  c.fillStyle = '#94396c';
  c.fillRect(12, 18, 12, 8); // highlight
  // shoulder spikes
  c.fillStyle = '#2a0a1e';
  c.fillRect(2, 18, 6, 10);
  c.fillRect(44, 18, 6, 10);
  // horns
  c.fillStyle = '#2a0a1e';
  c.fillRect(0, 0, 10, 16);
  c.fillRect(42, 0, 10, 16);
  c.fillStyle = '#1a0512';
  c.fillRect(0, 0, 5, 8);
  c.fillRect(47, 0, 5, 8);
  c.fillStyle = '#4a1a3a';
  c.fillRect(7, 4, 3, 10); // horn inner light
  c.fillRect(42, 4, 3, 10);
  // eyes: burning pink with cores
  c.fillStyle = '#ff20a0';
  c.fillRect(15, 21, 7, 6);
  c.fillRect(30, 21, 7, 6);
  c.fillStyle = '#ffd0e8';
  c.fillRect(17, 23, 3, 2);
  c.fillRect(32, 23, 3, 2);
  // maw with teeth
  c.fillStyle = '#1a0a12';
  c.fillRect(16, 33, 20, 8);
  c.fillStyle = '#e8d8e0';
  for (let i = 0; i < 5; i++) c.fillRect(18 + i * 4, 33, 2, 3);
  for (let i = 0; i < 4; i++) c.fillRect(20 + i * 4, 38, 2, 3);
  // corruption seams
  c.fillStyle = '#ff20d0';
  c.fillRect(8, 30, 6, 1);
  c.fillRect(38, 28, 6, 1);
  c.fillRect(24, 14, 1, 5);
  // claws
  c.fillStyle = '#2a0a1e';
  c.fillRect(4, 46, 10, 6);
  c.fillRect(38, 46, 10, 6);
  c.fillStyle = '#e8d8e0';
  c.fillRect(5, 50, 2, 2);
  c.fillRect(9, 50, 2, 2);
  c.fillRect(41, 50, 2, 2);
  c.fillRect(45, 50, 2, 2);
}

const T2 = TILE * PX; // 32: tile size in framebuffer pixels

function paintTileWall(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#3a3a52';
  c.fillRect(0, 0, T2, T2);
  // top face catches the light
  c.fillStyle = '#4c4c6a';
  c.fillRect(0, 0, T2, 8);
  c.fillStyle = '#585878';
  c.fillRect(0, 0, T2, 2);
  // bottom shadow
  c.fillStyle = '#26263a';
  c.fillRect(0, T2 - 4, T2, 4);
  // brick pattern with mortar lines
  c.fillStyle = '#2e2e44';
  c.fillRect(0, 15, T2, 2); // horizontal mortar
  c.fillRect(0, 24, T2, 1);
  c.fillRect(10, 8, 2, 7); // vertical seams, offset per row
  c.fillRect(24, 8, 2, 7);
  c.fillRect(4, 17, 2, 7);
  c.fillRect(17, 17, 2, 7);
  c.fillRect(27, 25, 2, 5);
  c.fillRect(12, 25, 2, 5);
  // brick face highlights
  c.fillStyle = '#42425e';
  c.fillRect(12, 9, 10, 2);
  c.fillRect(6, 18, 9, 2);
}

function paintTileFloor(c: CanvasRenderingContext2D, seedHash: number): void {
  c.fillStyle = '#1c1c28';
  c.fillRect(0, 0, T2, T2);
  // large flagstone shading
  c.fillStyle = '#20202e';
  c.fillRect(1, 1, T2 - 2, T2 - 2);
  c.fillStyle = '#1a1a26';
  c.fillRect(0, 0, T2, 1);
  c.fillRect(0, 0, 1, T2);
  // deterministic speckle + cracks from tile hash
  let s = seedHash;
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
  c.fillStyle = '#262636';
  for (let i = 0; i < 7; i++) {
    next();
    c.fillRect(s % T2, (s >> 5) % T2, 1 + (s % 2), 1);
  }
  c.fillStyle = '#15151f';
  next();
  const cx = s % (T2 - 8);
  const cy = (s >> 5) % (T2 - 8);
  c.fillRect(cx, cy + 4, 5, 1); // small crack
  c.fillRect(cx + 4, cy + 5, 1, 3);
}

function paintTileCorrupt(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#241428';
  c.fillRect(0, 0, T2, T2);
  c.fillStyle = '#2c1832';
  c.fillRect(1, 1, T2 - 2, T2 - 2);
  // branching veins
  c.fillStyle = '#58185e';
  c.fillRect(4, 6, 12, 2);
  c.fillRect(14, 8, 2, 8);
  c.fillRect(14, 14, 10, 2);
  c.fillRect(22, 16, 2, 8);
  c.fillRect(8, 22, 8, 2);
  // pustules with bright cores
  c.fillStyle = '#8a20a0';
  c.fillRect(6, 5, 4, 4);
  c.fillRect(21, 14, 4, 4);
  c.fillRect(12, 24, 3, 3);
  c.fillStyle = '#d040e8';
  c.fillRect(7, 6, 2, 2);
  c.fillRect(22, 15, 2, 2);
  c.fillRect(13, 25, 1, 1);
}

function paintStairsDown(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#1c1c28';
  c.fillRect(0, 0, T2, T2);
  // descending steps into darkness
  const shades = ['#2e2e44', '#232336', '#191926', '#101018', '#05050a'];
  for (let i = 0; i < 5; i++) {
    const inset = i * 3;
    c.fillStyle = shades[i]!;
    c.fillRect(2 + inset, 2 + inset, T2 - 4 - inset * 2, T2 - 4 - inset * 2);
  }
  c.fillStyle = '#000005';
  c.fillRect(14, 14, 8, 8); // the drop
  // step edge highlights
  c.fillStyle = '#3c3c56';
  c.fillRect(2, 2, T2 - 4, 1);
  c.fillRect(5, 5, T2 - 10, 1);
}

function paintStairsUp(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#1c1c28';
  c.fillRect(0, 0, T2, T2);
  // ascending steps toward the light
  c.fillStyle = '#2e2e44';
  c.fillRect(2, 22, 28, 8);
  c.fillStyle = '#3c3c56';
  c.fillRect(5, 15, 22, 8);
  c.fillStyle = '#4c4c6a';
  c.fillRect(8, 8, 16, 8);
  c.fillStyle = '#5c5c7e';
  c.fillRect(11, 2, 10, 7);
  // step lips
  c.fillStyle = '#6e6e94';
  c.fillRect(2, 22, 28, 1);
  c.fillRect(5, 15, 22, 1);
  c.fillRect(8, 8, 16, 1);
  c.fillRect(11, 2, 10, 1);
}

function paintDoor(c: CanvasRenderingContext2D): void {
  // stone frame
  c.fillStyle = '#3a3a52';
  c.fillRect(0, 0, T2, T2);
  // wooden door with planks
  c.fillStyle = '#5a3a1e';
  c.fillRect(3, 1, T2 - 6, T2 - 2);
  c.fillStyle = '#6e4a28';
  c.fillRect(5, 3, T2 - 10, T2 - 6);
  c.fillStyle = '#5a3a1e';
  c.fillRect(11, 3, 2, T2 - 6); // plank seams
  c.fillRect(19, 3, 2, T2 - 6);
  // iron bands
  c.fillStyle = '#484858';
  c.fillRect(4, 7, T2 - 8, 2);
  c.fillRect(4, 23, T2 - 8, 2);
  c.fillStyle = '#686880';
  c.fillRect(4, 7, T2 - 8, 1);
  // chaos lock plate + keyhole
  c.fillStyle = '#ffd040';
  c.fillRect(13, 13, 7, 6);
  c.fillStyle = '#c89820';
  c.fillRect(13, 17, 7, 2);
  c.fillStyle = '#1a1a1a';
  c.fillRect(15, 14, 2, 2);
  c.fillRect(15, 16, 1, 2);
}

function paintRubble(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#1c1c28';
  c.fillRect(0, 0, T2, T2);
  c.fillStyle = '#20202e';
  c.fillRect(1, 1, T2 - 2, T2 - 2);
  // rock pile with lit tops and shadowed bases
  const rock = (x: number, y: number, w: number, h: number) => {
    c.fillStyle = '#3c3c52';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#55556e';
    c.fillRect(x + 1, y + 1, w - 2, Math.max(1, Math.floor(h / 2) - 1));
    c.fillStyle = '#6a6a86';
    c.fillRect(x + 1, y + 1, Math.max(1, Math.floor(w / 3)), 1);
  };
  rock(3, 12, 12, 12);
  rock(15, 5, 11, 10);
  rock(17, 17, 11, 11);
  rock(8, 22, 8, 7);
  // dust specks
  c.fillStyle = '#2e2e40';
  c.fillRect(5, 9, 2, 1);
  c.fillRect(27, 14, 2, 1);
  c.fillRect(13, 29, 2, 1);
}

function paintItem(c: CanvasRenderingContext2D, item: ItemId): void {
  // 10x10 icons
  switch (item) {
    case 'healPotion':
      c.fillStyle = '#d02040';
      c.fillRect(3, 3, 4, 6);
      c.fillRect(2, 5, 6, 4);
      c.fillStyle = '#e8e8f0';
      c.fillRect(4, 1, 2, 2);
      break;
    case 'purityPotion':
      c.fillStyle = '#30c0e0';
      c.fillRect(3, 3, 4, 6);
      c.fillRect(2, 5, 6, 4);
      c.fillStyle = '#e8e8f0';
      c.fillRect(4, 1, 2, 2);
      break;
    case 'elixir':
      c.fillStyle = '#ffe060';
      c.fillRect(3, 2, 4, 7);
      c.fillRect(2, 4, 6, 5);
      c.fillStyle = '#fffdf0';
      c.fillRect(4, 0, 2, 2);
      break;
    case 'bomb':
      c.fillStyle = '#20202e';
      c.fillRect(2, 4, 6, 6);
      c.fillRect(3, 3, 4, 8);
      c.fillStyle = '#c08030';
      c.fillRect(5, 1, 1, 3);
      c.fillStyle = '#ff6020';
      c.fillRect(5, 0, 2, 2);
      break;
    case 'key':
      c.fillStyle = '#ffd040';
      c.fillRect(2, 2, 4, 4);
      c.fillRect(4, 5, 2, 5);
      c.fillRect(6, 7, 2, 1);
      c.fillRect(6, 9, 2, 1);
      c.fillStyle = '#1a1a1a';
      c.fillRect(3, 3, 2, 2);
      break;
    case 'tomeNova':
    case 'tomeHaste':
    case 'tomeStoneskin':
    case 'tomeBlink': {
      const spine = item === 'tomeNova' ? '#d04020' : item === 'tomeHaste' ? '#e0c030' : item === 'tomeStoneskin' ? '#808898' : '#40c0d0';
      c.fillStyle = '#3a2a4a';
      c.fillRect(1, 1, 8, 9);
      c.fillStyle = spine;
      c.fillRect(1, 1, 2, 9);
      c.fillStyle = '#d8c8f0';
      c.fillRect(4, 3, 4, 1);
      c.fillRect(4, 5, 4, 1);
      c.fillRect(4, 7, 3, 1);
      break;
    }
    case 'bow':
      c.strokeStyle = '#8a6a2a';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(3, 5, 4.5, -Math.PI / 2.6, Math.PI / 2.6);
      c.stroke();
      c.strokeStyle = '#d8d8e8';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(4, 1);
      c.lineTo(4, 9);
      c.stroke();
      break;
    case 'arrows':
      c.strokeStyle = '#c8a060';
      c.lineWidth = 1;
      for (const off of [0, 3]) {
        c.beginPath();
        c.moveTo(2 + off, 9);
        c.lineTo(7 + off - 1, 2);
        c.stroke();
      }
      c.fillStyle = '#d8d8e8';
      c.fillRect(6, 1, 2, 2);
      c.fillRect(9, 1, 2, 2);
      break;
    case 'sword1':
    case 'sword2':
    case 'sword3': {
      const blade = item === 'sword1' ? '#9a9aa8' : item === 'sword2' ? '#c8d0e0' : '#80ffd0';
      c.fillStyle = blade;
      c.fillRect(4, 0, 2, 7);
      c.fillStyle = '#7a5a20';
      c.fillRect(2, 6, 6, 2);
      c.fillRect(4, 8, 2, 2);
      break;
    }
  }
}

function paintSpell(c: CanvasRenderingContext2D, id: SpellId): void {
  // 10x10 spell icons
  switch (id) {
    case 'chaosBolt':
      c.strokeStyle = '#ff30d0';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(7, 1);
      c.lineTo(3, 5);
      c.lineTo(6, 5);
      c.lineTo(2, 9);
      c.stroke();
      break;
    case 'nova':
      c.strokeStyle = '#ffd060';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(5, 5, 3, 0, Math.PI * 2);
      c.stroke();
      for (const a of [0, 1, 2, 3]) {
        const ang = (a / 4) * Math.PI * 2 + 0.4;
        c.beginPath();
        c.moveTo(5 + Math.cos(ang) * 3.5, 5 + Math.sin(ang) * 3.5);
        c.lineTo(5 + Math.cos(ang) * 5, 5 + Math.sin(ang) * 5);
        c.stroke();
      }
      break;
    case 'haste':
      c.strokeStyle = '#e0c030';
      c.lineWidth = 1.5;
      for (const off of [0, 3]) {
        c.beginPath();
        c.moveTo(2 + off, 2);
        c.lineTo(6 + off, 5);
        c.lineTo(2 + off, 8);
        c.stroke();
      }
      break;
    case 'stoneskin':
      c.fillStyle = '#808898';
      c.fillRect(2, 1, 6, 5);
      c.fillRect(3, 6, 4, 2);
      c.fillRect(4, 8, 2, 1);
      c.fillStyle = '#a8b0c0';
      c.fillRect(3, 2, 2, 2);
      break;
    case 'cleanse':
      c.fillStyle = '#40e080';
      c.fillRect(4, 1, 2, 3);
      c.fillRect(3, 3, 4, 4);
      c.fillRect(4, 7, 2, 2);
      c.fillStyle = '#c0ffd8';
      c.fillRect(4, 3, 1, 2);
      break;
    case 'blink':
      c.strokeStyle = '#40c0d0';
      c.lineWidth = 1;
      c.strokeRect(1.5, 3.5, 3, 4);
      c.setLineDash([1, 1]);
      c.strokeRect(6.5, 2.5, 3, 4);
      c.setLineDash([]);
      break;
  }
}

export class SpriteAtlas {
  player: Record<Facing, HTMLCanvasElement>;
  enemies: Record<Exclude<EnemyKind, 'boss'>, HTMLCanvasElement>;
  enemiesCorrupt: Record<Exclude<EnemyKind, 'boss'>, HTMLCanvasElement>;
  boss: HTMLCanvasElement;
  tiles: Map<Tile, HTMLCanvasElement>;
  floorVariants: HTMLCanvasElement[];
  items: Map<ItemId, HTMLCanvasElement>;
  spells: Map<SpellId, HTMLCanvasElement>;

  constructor(palette: PlayerPalette = DEFAULT_PALETTE) {
    this.player = {
      up: mkSprite(12, 14, (c) => paintPlayer(c, 'up', palette)),
      down: mkSprite(12, 14, (c) => paintPlayer(c, 'down', palette)),
      left: mkSprite(12, 14, (c) => paintPlayer(c, 'left', palette)),
      right: mkSprite(12, 14, (c) => paintPlayer(c, 'right', palette)),
    };
    this.enemies = {
      chaser: mkSprite(11, 12, paintChaser),
      archer: mkSprite(10, 12, paintArcher),
      bat: mkSprite(9, 8, paintBat),
    };
    this.enemiesCorrupt = {
      chaser: tintMagenta(this.enemies.chaser),
      archer: tintMagenta(this.enemies.archer),
      bat: tintMagenta(this.enemies.bat),
    };
    this.boss = mkSprite(26, 26, paintBoss);
    this.tiles = new Map<Tile, HTMLCanvasElement>([
      [Tile.Wall, mkSprite(TILE, TILE, paintTileWall)],
      [Tile.CorruptFloor, mkSprite(TILE, TILE, paintTileCorrupt)],
      [Tile.StairsDown, mkSprite(TILE, TILE, paintStairsDown)],
      [Tile.StairsUp, mkSprite(TILE, TILE, paintStairsUp)],
      [Tile.DoorLocked, mkSprite(TILE, TILE, paintDoor)],
      [Tile.Rubble, mkSprite(TILE, TILE, paintRubble)],
    ]);
    this.floorVariants = [0, 1, 2, 3].map((i) =>
      mkSprite(TILE, TILE, (c) => paintTileFloor(c, 0x9e3779 + i * 7919)),
    );
    const itemIds: ItemId[] = [
      'healPotion', 'purityPotion', 'elixir', 'bomb', 'key',
      'sword1', 'sword2', 'sword3', 'bow', 'arrows',
      'tomeNova', 'tomeHaste', 'tomeStoneskin', 'tomeBlink',
    ];
    this.items = new Map(itemIds.map((id) => [id, mkScaled(10, 10, (c) => paintItem(c, id))]));
    const spellIds: SpellId[] = ['chaosBolt', 'nova', 'haste', 'stoneskin', 'cleanse', 'blink'];
    this.spells = new Map(spellIds.map((id) => [id, mkScaled(10, 10, (c) => paintSpell(c, id))]));
  }
}

export class Camera {
  x = 0;
  y = 0;

  snapTo(px: number, py: number): void {
    this.x = px - VIEW_W / 2;
    this.y = py - VIEW_H / 2;
    this.clamp();
  }

  follow(px: number, py: number, dt: number): void {
    const tx = px - VIEW_W / 2;
    const ty = py - VIEW_H / 2;
    const k = Math.min(1, 8 * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clamp();
  }

  private clamp(): void {
    this.x = Math.max(0, Math.min(MAP_W * TILE - VIEW_W, this.x));
    this.y = Math.max(0, Math.min(MAP_H * TILE - VIEW_H, this.y));
  }
}

/** Stable per-tile hash for corruption tile decay + floor variants. */
function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return (h ^ (h >> 16)) >>> 0;
}

export class Renderer {
  readonly atlas: SpriteAtlas;
  readonly camera = new Camera();

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    palette?: PlayerPalette,
  ) {
    this.atlas = new SpriteAtlas(palette);
  }

  begin(): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /** Camera position snapped to the framebuffer grid; all world draws share it. */
  private get camX(): number {
    return snap(this.camera.x);
  }

  private get camY(): number {
    return snap(this.camera.y);
  }

  drawTiles(floor: FloorData, fog: Uint8Array, corruptionPoints: number, time: number): void {
    const { ctx, camera, atlas } = this;
    const x0 = Math.floor(camera.x / TILE);
    const y0 = Math.floor(camera.y / TILE);
    const x1 = Math.min(floor.w - 1, Math.ceil((camera.x + VIEW_W) / TILE));
    const y1 = Math.min(floor.h - 1, Math.ceil((camera.y + VIEW_H) / TILE));
    const decayFrac = (corruptionPoints / CORRUPTION_MAX) * 0.4;

    for (let ty = Math.max(0, y0); ty <= y1; ty++) {
      for (let tx = Math.max(0, x0); tx <= x1; tx++) {
        const f = fog[ty * floor.w + tx]!;
        if (f === FOG_HIDDEN) continue;
        let t = floor.tiles[ty * floor.w + tx] as Tile;
        const hash = tileHash(tx, ty);
        // corruption visually eats the floor
        if (t === Tile.Floor && (hash % 1000) / 1000 < decayFrac) t = Tile.CorruptFloor;
        const sprite = t === Tile.Floor ? atlas.floorVariants[hash % 4]! : atlas.tiles.get(t)!;
        const sx = tx * TILE - this.camX;
        const sy = ty * TILE - this.camY;
        ctx.drawImage(sprite, sx, sy, TILE, TILE);
        if (t === Tile.CorruptFloor) {
          // pulse
          const pulse = 0.1 + 0.08 * Math.sin(time * 3 + hash);
          ctx.fillStyle = `rgba(255, 0, 220, ${pulse.toFixed(3)})`;
          ctx.fillRect(sx, sy, TILE, TILE);
        }
        if (f === FOG_EXPLORED) {
          ctx.fillStyle = `rgba(0, 0, 0, ${1 - EXPLORED_BRIGHTNESS})`;
          ctx.fillRect(sx, sy, TILE, TILE);
        }
      }
    }
  }

  private visibleAt(fog: Uint8Array, floorW: number, wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    return fog[ty * floorW + tx] === FOG_VISIBLE;
  }

  drawPickup(p: Pickup, fog: Uint8Array, floorW: number, time: number): void {
    if (!this.visibleAt(fog, floorW, p.x + 5, p.y + 5)) return;
    const bob = Math.sin(time * 4 + p.x) * 1.5;
    const sprite = this.atlas.items.get(p.item)!;
    this.ctx.drawImage(sprite, snap(p.x - this.camX), snap(p.y - this.camY + bob), 10, 10);
  }

  drawEnemy(e: Enemy, fog: Uint8Array, floorW: number, time: number): void {
    if (!this.visibleAt(fog, floorW, e.cx, e.cy)) return;
    const { ctx } = this;
    const sx = snap(e.x - this.camX);
    const sy = snap(e.y - this.camY);
    // hit flash
    if (e.iframes > 0 && Math.floor(time * 30) % 2 === 0) return;
    const sprite =
      e.kind === 'boss'
        ? this.atlas.boss
        : (e.corrupted ? this.atlas.enemiesCorrupt : this.atlas.enemies)[e.kind];
    ctx.drawImage(sprite, sx, sy, sprite.width / PX, sprite.height / PX);
    // telegraphs
    if (e.state === 'windup') {
      const blink = Math.floor(time * 12) % 2 === 0;
      if (blink) {
        ctx.fillStyle = 'rgba(255, 60, 60, 0.45)';
        ctx.fillRect(sx - 1, sy - 1, e.w + 2, e.h + 2);
      }
    } else if (e.state === 'stunned') {
      ctx.fillStyle = '#ffe060';
      const wob = Math.sin(time * 10) * 3;
      ctx.fillRect(sx + e.w / 2 + wob, sy - 5, 2, 2);
      ctx.fillRect(sx + e.w / 2 - wob, sy - 4, 2, 2);
    }
  }

  drawAimLine(e: Enemy, px: number, py: number): void {
    const { ctx, camera } = this;
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(e.cx - camera.x, e.cy - camera.y);
    ctx.lineTo(px - camera.x, py - camera.y);
    ctx.stroke();
  }

  drawPlayer(p: Player, time: number): void {
    // i-frame flicker
    if (p.iframes > 0 && Math.floor(time * 15) % 2 === 0) return;
    const sprite = this.atlas.player[p.facing];
    const lw = sprite.width / PX;
    const lh = sprite.height / PX;
    this.ctx.drawImage(sprite, snap(p.cx - lw / 2 - this.camX), snap(p.y + p.h - lh - this.camY), lw, lh);
  }

  /** Aimed sword sweep: translucent wedge + bright edge around the aim direction. */
  drawSwingArc(cx: number, cy: number, dirX: number, dirY: number, extraReach: number): void {
    const { ctx, camera } = this;
    const angle = Math.atan2(dirY, dirX);
    const radius = SWING_REACH + extraReach;
    const sx = cx - camera.x;
    const sy = cy - camera.y;
    ctx.fillStyle = 'rgba(240, 240, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, radius, angle - SWING_HALF_ANGLE, angle + SWING_HALF_ANGLE);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, angle - SWING_HALF_ANGLE, angle + SWING_HALF_ANGLE);
    ctx.stroke();
  }

  drawProjectile(pr: Projectile): void {
    const { ctx, camera } = this;
    if (pr.bolt) {
      // chaos bolt: glowing magenta orb with a bright core
      const sx = Math.round(pr.x - camera.x);
      const sy = Math.round(pr.y - camera.y);
      ctx.fillStyle = 'rgba(255, 48, 208, 0.35)';
      ctx.beginPath();
      ctx.arc(sx, sy, pr.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff30d0';
      ctx.fillRect(sx - 2, sy - 2, 4, 4);
      ctx.fillStyle = '#ffd0f0';
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
      return;
    }
    if (pr.friendly) {
      // arrow: shaft along the flight direction with a bright head
      const len = Math.hypot(pr.vx, pr.vy) || 1;
      const dx = pr.vx / len;
      const dy = pr.vy / len;
      const sx = pr.x - camera.x;
      const sy = pr.y - camera.y;
      ctx.strokeStyle = '#c8a060';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - dx * 4, sy - dy * 4);
      ctx.lineTo(sx + dx * 3, sy + dy * 3);
      ctx.stroke();
      ctx.fillStyle = '#f0f0f8';
      ctx.fillRect(Math.round(sx + dx * 3 - 1), Math.round(sy + dy * 3 - 1), 2, 2);
      return;
    }
    ctx.fillStyle = pr.corrupted ? '#ff30d0' : '#ffd060';
    const s = pr.size;
    ctx.fillRect(Math.round(pr.x - s / 2 - camera.x), Math.round(pr.y - s / 2 - camera.y), s, s);
  }

  /** Mouse aim: crosshair at the cursor's world position. */
  drawCrosshair(wx: number, wy: number): void {
    const { ctx, camera } = this;
    const sx = Math.round(wx - camera.x);
    const sy = Math.round(wy - camera.y);
    ctx.strokeStyle = 'rgba(255, 220, 120, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 4, sy);
    ctx.lineTo(sx - 1.5, sy);
    ctx.moveTo(sx + 1.5, sy);
    ctx.lineTo(sx + 4, sy);
    ctx.moveTo(sx, sy - 4);
    ctx.lineTo(sx, sy - 1.5);
    ctx.moveTo(sx, sy + 1.5);
    ctx.lineTo(sx, sy + 4);
    ctx.stroke();
  }

  /** Stick aim: short direction arrow floating just off the player. */
  drawAimArrow(px: number, py: number, dirX: number, dirY: number): void {
    const { ctx, camera } = this;
    const bx = px + dirX * 16 - camera.x;
    const by = py + dirY * 16 - camera.y;
    ctx.strokeStyle = 'rgba(255, 220, 120, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + dirX * 10 - camera.x, py + dirY * 10 - camera.y);
    ctx.lineTo(bx, by);
    // arrowhead
    const perpX = -dirY;
    const perpY = dirX;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - dirX * 3 + perpX * 2.5, by - dirY * 3 + perpY * 2.5);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - dirX * 3 - perpX * 2.5, by - dirY * 3 - perpY * 2.5);
    ctx.stroke();
  }

  drawBombFx(x: number, y: number, radius: number, alpha: number, color = '255, 160, 40'): void {
    const { ctx, camera } = this;
    ctx.fillStyle = `rgba(${color}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x - camera.x, y - camera.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Magenta corruption vignette; alpha scales with corruption points. */
  drawCorruptionVignette(points: number, time: number): void {
    if (points <= 0) return;
    const { ctx } = this;
    const strength = (points / CORRUPTION_MAX) * 0.55 + 0.04 * Math.sin(time * 2);
    const grad = ctx.createRadialGradient(
      VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.45,
      VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85,
    );
    grad.addColorStop(0, 'rgba(120, 0, 100, 0)');
    grad.addColorStop(1, `rgba(120, 0, 100, ${Math.max(0, strength).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  flashScreen(color: string, alpha: number): void {
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.ctx.globalAlpha = 1;
  }
}
