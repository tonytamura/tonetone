import { describe, it, expect } from 'vitest';
import { AIM_HOT, BALL_RGB, CYAN, FIELD_BG, PINK, Rgb, WHITE } from '../../src/graphics/Palette';

/**
 * The ball palette's separation, measured the way the "Tune the ball colours
 * for better separation" task defines it, so no later edit can quietly undo it.
 *
 * - ΔE is CIEDE2000 on CIELAB (D65) from sRGB; the reference pairs below are
 *   Sharma, Wu & Dalal (2005).
 * - Colour blindness is Machado, Oliveira & Fernandes (2009) at full severity,
 *   applied in linear sRGB.
 * - "Worst case" is the smallest distance across normal vision, protanopia and
 *   deuteranopia, which together cover most colour blindness.
 *
 * Slots 1–4 must be told apart by colour; from five colours every ball carries
 * its shape (`graphics/BallMarks.ts`), so slots 5–6 are held to normal vision.
 */

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const unlin = (v: number) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };

type Lab = [number, number, number];
function lab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(lin);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = f(r * 0.2126729 + g * 0.7151522 + b * 0.0721750);
  const z = f((r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dLp = L2 - L1, dCp = C2p - C1p, dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lbp - 50) ** 2 / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

type Matrix = [number, number, number][];
const PROTAN: Matrix = [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]];
const DEUTAN: Matrix = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
const simulate = (rgb: Rgb, m: Matrix): Rgb => {
  const l = rgb.map(lin);
  return m.map(r => unlin(r[0] * l[0] + r[1] * l[1] + r[2] * l[2])) as unknown as Rgb;
};

const luminance = (rgb: Rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: Rgb, b: Rgb) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** The marks' inks, as `inkOn` picks between them. */
const INKS: Rgb[] = [[30, 6, 58], [255, 255, 255]];

const worst = (a: Rgb, b: Rgb) => Math.min(
  deltaE(lab(a), lab(b)),
  deltaE(lab(simulate(a, PROTAN)), lab(simulate(b, PROTAN))),
  deltaE(lab(simulate(a, DEUTAN)), lab(simulate(b, DEUTAN))),
);
function closest(n: number, d: (a: Rgb, b: Rgb) => number): number {
  let m = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) m = Math.min(m, d(BALL_RGB[i], BALL_RGB[j]));
  return m;
}
const hueOf = (rgb: Rgb) => { const [, a, b] = lab(rgb); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };

describe('the ball palette', () => {
  it('measures CIEDE2000 as Sharma, Wu & Dalal publish it', () => {
    expect(deltaE([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE([50, -1, 2], [50, 0, 0])).toBeCloseTo(2.3669, 4);
    expect(deltaE([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 4);
  });

  it('keeps three and four colours apart by colour alone, for normal, protan and deutan vision', () => {
    // 20.8 when set; the palette before measured 6.1 and 3.4. Under 10 is easy to confuse.
    expect(closest(3, worst)).toBeGreaterThanOrEqual(20);
    expect(closest(4, worst)).toBeGreaterThanOrEqual(20);
  });

  it('keeps every colour apart for normal vision at six', () => {
    expect(closest(6, (a, b) => deltaE(lab(a), lab(b)))).toBeGreaterThanOrEqual(20);
  });

  it('stands out against the board, and takes a readable shape', () => {
    for (const c of BALL_RGB) {
      expect(contrast(c, FIELD_BG), String(c)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...INKS.map(i => contrast(c, i))), String(c)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stays clear of the players, the aim arrow and the white ball', () => {
    for (const c of BALL_RGB) {
      const L = lab(c), h = hueOf(c);
      expect(deltaE(L, lab(CYAN)), String(c)).toBeGreaterThanOrEqual(20);
      expect(deltaE(L, lab(PINK)), String(c)).toBeGreaterThanOrEqual(20);
      expect(deltaE(L, lab(AIM_HOT)), String(c)).toBeGreaterThanOrEqual(25);
      expect(deltaE(L, lab(WHITE)), String(c)).toBeGreaterThanOrEqual(25);
      // Out of the cyan and pink hue families, whatever ΔE says.
      expect(h >= 162 && h <= 230, `${c} in the cyan family`).toBe(false);
      expect(h >= 330 || h <= 25, `${c} in the pink family`).toBe(false);
    }
  });

  it('never lets a ghost read as a live ball of another colour', () => {
    const ghost = (c: Rgb): Rgb => c.map((v, i) => 0.34 * v + 0.66 * FIELD_BG[i]) as unknown as Rgb;
    for (const a of BALL_RGB) for (const b of BALL_RGB) {
      if (a !== b) expect(deltaE(lab(ghost(a)), lab(b))).toBeGreaterThanOrEqual(10);
    }
  });
});
