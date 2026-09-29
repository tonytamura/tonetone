/**
 * The Records screen's celebration: rings that bloom and fade, and words that
 * rise, around and over the card while it is open.
 *
 * It opens with a burst — a ring of flashes, four booms a beat apart and a note
 * — and then goes quiet: the rings and words carry on without a sound, so a
 * player who opens the screen to check one number is not kept listening to
 * fireworks. The words are the player's own: their best solo score, their best
 * share of wins, the highest AI they have beaten. With no records there are no
 * words, only the rings.
 *
 * Rings and words avoid the card where there is room outside it, and are drawn
 * faint where they have to cross it, so the numbers on the card stay readable.
 * Under "reduce motion" nothing moves; the opening burst is still heard.
 */
import { Records, winShare } from './Records';
import { drawRippleRing, FLASH_SPECS, RESULTS_RING } from '../graphics/VisualFX';
import { FLASH_LIFE, POP_LIFE } from '../physics/Types';
import { uiFont } from '../graphics/Fonts';
import { hex, MENU_CYAN } from '../graphics/Palette';
import { P_COLOR } from '../graphics/Renderer';
import { AudioStore } from '../audio/SynthEngine';
import { playNote, playRandomGameBoom } from '../audio/Voices';

/**
 * The words a player's records earn, as they float: the best solo score, the
 * best share of wins against a person or an AI, and the highest AI beaten.
 */
export function recordWords(records: Records, ais: { id: string; label: string }[]): string[] {
  const words: string[] = [];
  const solo = Object.values(records.solo);
  if (solo.length) words.push(`${Math.max(...solo)}!`);
  const shares = [...Object.values(records.duel), ...Object.values(records.vsAi)]
    .filter(t => t.p1 + t.p2 > 0 && t.p1 > 0)
    .map(t => winShare(t));
  if (shares.length) words.push(`${Math.max(...shares.map(s => parseInt(s, 10)))}%!`);
  for (let i = ais.length - 1; i >= 0; i--) {
    if ((records.vsAi[ais[i].id]?.p1 ?? 0) > 0) { words.push(`${ais[i].label}!`); break; }
  }
  return words;
}

/** How many booms open the screen, and how far apart. */
export const OPENING_BOOMS_MS = [0, 260, 560, 900];

interface Ring { x: number; y: number; t: number; kind: keyof typeof FLASH_SPECS }
interface Word { x: number; y: number; t: number; text: string; color: string }

/** The ball radius the rings are measured against: a little bigger than a ball, so they read at a glance. */
const R = 18;
const FLASH_KINDS: (keyof typeof FLASH_SPECS)[] = ['bond', 'break', 'spawn'];
const reduceMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Start the celebration on `canvas`, which covers the screen, around `card`.
 * Returns the function that stops it.
 */
export function startRecordsCelebration(canvas: HTMLCanvasElement, card: HTMLElement | null, words: string[]): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  // The burst. The screen was opened by a tap, so the audio is awake.
  if (AudioStore.soundOn) {
    OPENING_BOOMS_MS.forEach((ms, i) => timers.push(setTimeout(() => {
      playRandomGameBoom((i % 2 ? 0.5 : -0.5) * Math.random(), 'celebration');
    }, ms)));
    timers.push(setTimeout(() => playNote(0.8, 0, 'bond', { boost: 0.6 }), 120));
  }
  const stopTimers = () => timers.forEach(clearTimeout);
  const ctx = canvas.getContext('2d');
  if (!ctx || reduceMotion()) return stopTimers;

  const rings: Ring[] = [];
  const pops: Word[] = [];
  let raf = 0;
  let last = performance.now();
  let nextRing = 0;
  let nextWord = 350;
  let clock = 0;
  let W = 0, H = 0;

  const fit = () => {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const cardRect = () => card?.getBoundingClientRect() ?? null;
  const onCard = (x: number, y: number) => {
    const r = cardRect();
    return !!r && x > r.left && x < r.right && y > r.top && y < r.bottom;
  };
  /** A spot on screen, outside the card where there is room for `pad` around it. */
  const spot = (pad: number) => {
    const r = cardRect();
    const bands: { x0: number; x1: number; y0: number; y1: number }[] = [];
    if (r) {
      if (r.top > pad * 2) bands.push({ x0: pad, x1: W - pad, y0: pad, y1: r.top - pad });
      if (H - r.bottom > pad * 2) bands.push({ x0: pad, x1: W - pad, y0: r.bottom + pad, y1: H - pad });
      if (r.left > pad * 2) bands.push({ x0: pad, x1: r.left - pad, y0: pad, y1: H - pad });
      if (W - r.right > pad * 2) bands.push({ x0: r.right + pad, x1: W - pad, y0: pad, y1: H - pad });
    }
    const b = bands.length ? bands[Math.floor(Math.random() * bands.length)] : { x0: pad, x1: W - pad, y0: pad, y1: H - pad };
    return { x: b.x0 + Math.random() * Math.max(0, b.x1 - b.x0), y: b.y0 + Math.random() * Math.max(0, b.y1 - b.y0) };
  };
  const addRing = (anywhere = false) => {
    const p = anywhere ? { x: Math.random() * W, y: Math.random() * H } : spot(R * 4);
    rings.push({ ...p, t: 0, kind: FLASH_KINDS[Math.floor(Math.random() * FLASH_KINDS.length)] });
  };

  fit();
  // The opening: a ring of flashes around the whole screen at once.
  for (let i = 0; i < 10; i++) addRing(i % 2 === 0);

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt * 1000;
    fit();
    for (const r of rings) r.t += dt;
    for (const w of pops) w.t += dt;
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t >= FLASH_LIFE) rings.splice(i, 1);
    for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t >= POP_LIFE * 1.6) pops.splice(i, 1);

    if (clock >= nextRing && rings.length < 8) { addRing(); nextRing = clock + 320 + Math.random() * 520; }
    if (words.length && clock >= nextWord && pops.length < 4) {
      const p = spot(40);
      const text = words[Math.floor(Math.random() * words.length)];
      pops.push({ ...p, t: 0, text, color: Math.random() < 0.5 ? P_COLOR[0] : hex(MENU_CYAN) });
      nextWord = clock + 650 + Math.random() * 700;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      const card = onCard(r.x, r.y);
      ctx.globalAlpha = card ? 0.35 : 1;
      drawRippleRing(ctx, FLASH_SPECS[r.kind], r.x, r.y, R, r.t / FLASH_LIFE, RESULTS_RING);
      // Twice where it is clear of the card: added light, so a ring on the dark
      // backdrop glows instead of reading as a faint outline.
      if (!card) drawRippleRing(ctx, FLASH_SPECS[r.kind], r.x, r.y, R, r.t / FLASH_LIFE, RESULTS_RING);
    }
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const w of pops) {
      const k = w.t / (POP_LIFE * 1.6);
      ctx.globalAlpha = Math.max(0, 1 - k * k) * (onCard(w.x, w.y) ? 0.45 : 1);
      ctx.font = uiFont(800, (22 + 10 * (1 - k)).toFixed(1));
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = w.color;
      ctx.fillText(w.text, w.x, w.y - k * 40);
      ctx.shadowBlur = 4;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(w.text, w.x, w.y - k * 40);
    }
    ctx.restore();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopTimers();
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, W, H);
  };
}
