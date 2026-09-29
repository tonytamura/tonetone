import { BoomShape, PopLabel } from '../physics/Types';
import { boomTierWord } from '../game/Rules';

/**
 * The words on a score pop.
 *
 * This is presentation, so it lives with the drawing rather than in the solver
 * that records the event. `tests/graphics/PopText.test.ts` holds the wording.
 */

/**
 * The word beside a boom's points: a size tier, and BOOM! for a white-on-black hit.
 *
 * BOOM! is reserved for the white-on-black hit — the only way a black ball ever
 * leaves the table, and the boom that already gets its own lifted voice. Every
 * other boom shows its tier alone (`+7 DOUBLE`, `+13 SUPER`), so the loudest
 * word in the game stays attached to its rarest event. The two compose: a
 * white-on-black hit that takes 12 balls with it reads `+96 SUPER BOOM!`.
 */
export function boomLabel(count: number, whiteBlack: boolean): string {
  const words = [];
  const tierWord = boomTierWord(count);
  if (tierWord) words.push(tierWord);
  if (whiteBlack) words.push('BOOM!');
  return words.join(' ');
}

/** The points a scoring pop paid, and what its boom earned. */
export function scoreText(points: number, source?: 'lock' | 'boom' | 'peel', boom?: BoomShape): string {
  const label = source === 'boom' && boom ? boomLabel(boom.count, boom.whiteBlack) : '';
  return label ? '+' + points + ' ' + label : '+' + points;
}

/** What to draw for a pop, whichever kind of label it carries. */
export function popText(label: PopLabel): string {
  return 'text' in label ? label.text : scoreText(label.points, label.source, label.boom);
}

/**
 * How big a pop is drawn, as a share of the full size: the bigger the event,
 * the bigger its pop. In a two-minute duel on Normal about 97 pops a minute
 * appear and up to a dozen share the screen, and half of them are worth 1 to 4
 * points; at one size, a +2 for touching two balls looked as loud as a +300
 * boom. Measured over 12 such matches (2,322 pops):
 *
 * | points | share of pops | scale |
 * | 1-4    | 50%           | 0.60  |
 * | 5-14   | 29%           | 0.72  |
 * | 15-49  | 18%           | 0.84  |
 * | 50+    | 4%            | 1     |
 *
 * A pop that carries a word (DOUBLE, SUPER, MEGA, GIGA, BOOM!) is always full
 * size, however much a long throw's decay cut its points: the word is the
 * celebration, and it should never be small. So is a pop of words alone.
 */
export function popScale(label: PopLabel): number {
  if ('text' in label) return 1;
  if (label.source === 'boom' && label.boom && boomLabel(label.boom.count, label.boom.whiteBlack)) return 1;
  const p = label.points;
  return p >= 50 ? 1 : p >= 15 ? 0.84 : p >= 5 ? 0.72 : 0.6;
}
