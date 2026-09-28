import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BALL_COLORS, BALL_RGB, BLACK, BLACK_HEX, CYAN, INK, MENU_CYAN,
  MENU_PINK_DEEP, PINK, Rgb, VOID, WHITE, WHITE_HEX, hex, rgb, rgba,
} from '../../src/graphics/Palette';
import { P_COLOR, P_RGB } from '../../src/graphics/Renderer';

/**
 * The palette exists in two places — this module and `index.css` — because the
 * page is styled by CSS and the field is painted by canvas, and neither can read
 * the other's copy. Two copies of a colour is exactly the problem the palette
 * was made to fix, so they are held together here the way
 * `tests/sim/Knobs.test.ts` holds the knob registry to the markup.
 */
/** The first `:root { … }` block of `index.css`, and everything outside it. */
function splitRoot(): { root: string; rest: string } {
  const src = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
  // Found by name, not taken as the first block: the @font-face rules sit
  // above it.
  const start = src.indexOf(':root {');
  const end = src.indexOf('}', start);
  return { root: src.slice(start, end), rest: src.slice(0, start) + src.slice(end) };
}

function cssVars(): Record<string, string> {
  const { root } = splitRoot();
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

describe('Palette', () => {
  describe('matches the CSS custom properties', () => {
    const mirrored: [string, Rgb][] = [
      ['--cyan', CYAN],
      ['--pink', PINK],
      ['--void', VOID],
      ['--ink', INK],
      ['--menu-cyan', MENU_CYAN],
      ['--menu-pink-deep', MENU_PINK_DEEP],
    ];

    for (const [name, color] of mirrored) {
      it(`${name} agrees with the palette`, () => {
        const vars = cssVars();
        expect(vars[name], `index.css declares no ${name}`).toBeDefined();
        expect(vars[name]).toBe(hex(color));
      });
    }

    it('leaves no brand colour spelled out as a literal outside :root', () => {
      const body = splitRoot().rest;
      const named = [CYAN, PINK, VOID, INK, MENU_CYAN, MENU_PINK_DEEP].map(hex);
      const found = named.filter(h => body.toLowerCase().includes(h));
      expect(found, 'use var(--…) rather than repeating a named colour').toEqual([]);
    });
  });

  describe('string forms', () => {
    it('writes hex in lower case, six digits', () => {
      expect(hex(CYAN)).toBe('#00e5ff');
      expect(hex([0, 0, 0])).toBe('#000000');
      expect(BLACK_HEX).toBe(hex(BLACK));
      expect(WHITE_HEX).toBe(hex(WHITE));
    });

    it('builds rgb() and rgba() from one declaration', () => {
      expect(rgb(MENU_CYAN)).toBe('rgb(0,247,255)');
      expect(rgba(MENU_CYAN, 0.45)).toBe('rgba(0,247,255,0.45)');
    });
  });

  describe('ball colours', () => {
    it('carries the string form of every triple, in order', () => {
      expect(BALL_COLORS).toEqual(BALL_RGB.map(hex));
      expect(BALL_COLORS).toHaveLength(6);
    });

    it('still names the six colours the game shipped with', () => {
      expect(BALL_COLORS).toEqual([
        '#fdbe4e', '#9744ee', '#5dd478', '#4363d8', '#911eb4', '#42d4f4',
      ]);
    });
  });

  describe('player colours', () => {
    it('gives player 1 the cyan and player 2 the pink', () => {
      expect(P_RGB).toEqual([CYAN, PINK]);
      expect(P_COLOR).toEqual([hex(CYAN), hex(PINK)]);
    });
  });
});
