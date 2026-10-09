/**
 * The shape on a ball: one per colour slot, so colours can be told apart
 * without relying on their hue.
 *
 * The ball colours are vaporwave, and vaporwave cannot be separated by colour
 * alone for a colour-blind player: its yellows and mints collapse together under
 * protanopia, and its violets and blues under both protanopia and deuteranopia.
 * The palette is tuned so that up to four colours stay apart by colour
 * (`tests/graphics/BallPalette.test.ts`); the shapes are there for five and six
 * colours, and for anyone who wants them. They are off unless the `labels`
 * setting turns them on, in every mode.
 *
 * They replaced the digits 1–6. A digit needs a font at about 8px to be read,
 * so it was hidden below radius 11; a shape is a few strokes and reads at
 * radius 8, the smallest ball the `size` knob allows.
 */
import { slotOfKind } from '../game/Rules';
import { inkOn } from './Sprites';
import { TAU } from '../math';

/**
 * The shape each colour slot carries, in slot order.
 *
 * Each differs from every other in something that survives a small ball: a
 * filled triangle, a bar, a hollow ring, a cross of two strokes, two dots, and
 * the plain ball. Tony found a diamond too like the square (the same outline
 * turned 45°), and then the square too like a dot: at radius 8 both are a
 * filled blob. The first slot, the commonest colour, carries no shape at all,
 * which is itself the easiest mark to tell from the rest.
 */
export const MARK_SHAPES = ['none', 'triangle', 'bar', 'ring', 'plus', 'dots'] as const;
export type MarkShape = (typeof MARK_SHAPES)[number];

/**
 * Whether the balls carry their shapes, for the `labels` setting: 1 on, anything
 * else off. They were briefly automatic from five colours, which put them on the
 * six-colour presets unasked; they are off by default in every mode now (Tony,
 * 2026-10-09).
 */
export function marksShown(mode: number): boolean {
  return mode === 1;
}

/** The shape for a ball of `kind`, or null for the black and white specials, which need none. */
export function markOfKind(kind: number): MarkShape | null {
  const slot = slotOfKind(kind);
  return slot < 0 ? null : MARK_SHAPES[slot % MARK_SHAPES.length];
}

/**
 * Draw the shape for `kind` on a ball of radius `R` at (x, y), in the ink that
 * reads on `color`. The caller sets any alpha.
 */
export function drawBallMark(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, R: number, color: string) {
  const shape = markOfKind(kind);
  if (!shape) return;
  const s = R * 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = ctx.strokeStyle = inkOn(color);
  ctx.lineWidth = Math.max(1, s * 0.42);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'none': break;
    case 'triangle': ctx.moveTo(0, -s); ctx.lineTo(s * 0.95, s * 0.72); ctx.lineTo(-s * 0.95, s * 0.72); ctx.closePath(); ctx.fill(); break;
    case 'bar': ctx.rect(-s, -s * 0.3, s * 2, s * 0.6); ctx.fill(); break;
    case 'ring': ctx.arc(0, 0, s * 0.78, 0, TAU); ctx.stroke(); break;
    case 'plus': ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.stroke(); break;
    case 'dots': ctx.arc(-s * 0.55, 0, s * 0.36, 0, TAU); ctx.moveTo(s * 0.91, 0); ctx.arc(s * 0.55, 0, s * 0.36, 0, TAU); ctx.fill(); break;
  }
  ctx.restore();
}
