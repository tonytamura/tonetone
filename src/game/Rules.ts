import { BallOnDeck, Group, LauncherPlayer, SpecialBallType } from '../physics/Types';
import { MessageKey, t } from '../i18n/I18n';
import { PhysicsConfig } from '../physics/Config';
import { BALL_COLORS, BLACK_HEX, WHITE_HEX } from '../graphics/Palette';

/**
 * The fewest colours the game will play with. The first three of `BALL_COLORS`
 * are chosen to be the best-separated trio, so this is where a match starts.
 */
export const MIN_COLORS = 3;

/**
 * The most colours the game will play with: however many the palette holds.
 *
 * Derived rather than written as 6, so adding a ball colour raises the ceiling
 * in the clamp, the palette fallback and the `colours` knob at once instead of
 * in whichever of the three someone remembers.
 */
export const MAX_COLORS = BALL_COLORS.length;

export const PALETTES: Record<number, number[]> = {
  3: [0, 1, 2],
  4: [0, 1, 2, 3],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

export let COLORS = 3;
export let SPECIALS = true;

/**
 * White's share of the special-ball slot, for the player who is behind.
 *
 * A draw first rolls one slot against the colours (`1 / (COLORS + 1)`); this is
 * the odds that the slot, once hit, actually yields a white rather than nothing.
 * So the chance of drawing a white while behind is `WHITE_ODDS / (COLORS + 1)`
 * — 18.8% per draw at the 0.75 default and three colours.
 *
 * 0.5 was the original hard-coded value (`1 / (2 * (COLORS + 1))`, 12.5%). It
 * left 8.5% ±2.0% of solo matches with no white at all; 0.75 takes that to
 * 2.5% ±1.1% and moves nothing else outside the noise. Measured over 200 solo
 * matches per value — see the Scoring page in Notion, §9.
 *
 * Black is deliberately not symmetric: it takes two slots out of `COLORS + 2`
 * for the player ahead, and is left alone here. The same §9 has why the
 * assignment runs this way round.
 */
export let WHITE_ODDS = 0.75;

// Scoring pays for what a shot changed, not for the size of whatever it touched.
// See the Scoring page in Notion for the measurements behind these rules.

/** Per ball a lock adds, before the growth for the size of the group it joins. */
export const PAY_LOCK = 3;
/** Per ball destroyed, before the size bonus. */
export const PAY_BOOM = 5;
/** Per peel, before the growth for the size of the group the ball was knocked off. */
export const PAY_PEEL = 5;
/** Lock multiplier when one of the two balls that touched is black. */
export const PAY_BLACK = 2;
/** Lock multiplier when a black ball locks onto another black ball. */
export const PAY_BLACK_PAIR = 4;
/** A boom of N balls pays each ball max(1, N / BOOM_BONUS_FROM) times the base. */
export const BOOM_BONUS_FROM = 3;

/**
 * Each further scoring event from the same throw pays this fraction of the one
 * before. One deliberate shot earns full value; a ball wandering the table for
 * seconds does not keep earning it. 1 turns the decay off.
 */
export let SHOT_DECAY = 0.5;

export function setShotDecay(v: number) {
  SHOT_DECAY = Math.max(0, Math.min(1, v));
}

/**
 * A lock pays for the balls it adds (`joined`, the smaller side of the merge),
 * and each one pays more the bigger the group it joins (`target`, the larger
 * side): `PAY_LOCK × joined × (1 + target) / 2`. Two single balls pay 3; one
 * ball onto an 8-ball group pays 14.
 *
 * `blacks` is how many of the two balls that touched are black: 0, 1 or 2.
 */
export function lockPay(joined: number, blacks: number, target: number): number {
  const mult = blacks >= 2 ? PAY_BLACK_PAIR : blacks === 1 ? PAY_BLACK : 1;
  return Math.round(PAY_LOCK * joined * ((1 + target) / 2) * mult);
}

/**
 * A peel knocks one ball off a group of `size` balls (counting the ball that
 * leaves) and pays `PAY_PEEL × (1 + size) / 2`: 10 off a 3-ball group, 23 off
 * an 8-ball group. Paying more than this let random bumping outscore aimed
 * play in solo; see the Scoring page in Notion, §11 Peel Growth.
 */
export function peelPay(size: number): number {
  return Math.round(PAY_PEEL * (1 + size) / 2);
}

export function boomPay(count: number, payScale = 1): number {
  return Math.round(PAY_BOOM * count * Math.max(1, count / BOOM_BONUS_FROM) * payScale);
}

/**
 * The player id that means "nobody is paid for this".
 *
 * `award` already declines any id that isn't a real player, so this is a name for
 * an existing rule rather than a new one. It was the bare literal -1 in three
 * places and an omitted argument in a fourth, which read as an oversight instead
 * of a decision.
 */
export const NO_CREDIT = -1;

/**
 * Does a hit of `impact` on `group` blow the whole group up, rather than peel a
 * single ball off it?
 *
 * The solver decides this in two different branches — a ball breaking out of a
 * group, and a ghost ball striking a real one — and the two had the same pair of
 * comparisons written out separately. A rule change would have landed in one and
 * not the other, so the test lives here, once.
 */
export function boomsOn(impact: number, group: Group): boolean {
  return impact >= PhysicsConfig.BOOM_SPEED && group.members.length >= PhysicsConfig.MIN_BOOM;
}

/**
 * The boom-size tiers, smallest threshold first: how many balls a boom has to
 * take to earn each word.
 *
 * One table serves both the word on the pop and the voice the boom is
 * synthesized with. These were two tables — `BOOM_LABEL_TIERS` in the solver and
 * an if-ladder in the boom voice — kept in step only by a comment saying they
 * matched. Moving a threshold in one and not the other would have put a MEGA
 * word on a SUPER sound.
 */
export const BOOM_TIERS: readonly { readonly min: number; readonly word: MessageKey }[] = [
  { min: 5, word: 'tier.double' },
  { min: 10, word: 'tier.super' },
  { min: 15, word: 'tier.mega' },
  { min: 20, word: 'tier.giga' },
];

/** Tier count including tier 0, the boom too small to earn a word. */
export const BOOM_TIER_COUNT = BOOM_TIERS.length + 1;

/** Which tier a boom of `count` balls falls in: 0 (smallest) up to `BOOM_TIERS.length`. */
export function boomTierOf(count: number): number {
  let tier = 0;
  for (let i = 0; i < BOOM_TIERS.length; i++) if (count >= BOOM_TIERS[i].min) tier = i + 1;
  return tier;
}

/** The word a boom of `count` balls earns, or '' when it is below the first tier. */
export function boomTierWord(count: number): string {
  const tier = boomTierOf(count);
  return tier === 0 ? '' : t(BOOM_TIERS[tier - 1].word);
}

export function setColorsCount(count: number) {
  COLORS = Math.max(MIN_COLORS, Math.min(MAX_COLORS, count));
}

export function setSpecialsToggle(enabled: boolean) {
  SPECIALS = enabled;
}

export function setWhiteOdds(odds: number) {
  WHITE_ODDS = Math.max(0, Math.min(1, odds));
}

export function colorOfKind(k: number): string {
  const set = PALETTES[COLORS] || PALETTES[MAX_COLORS];
  return BALL_COLORS[set[((k % set.length) + set.length) % set.length]];
}

export function randomKind(): number {
  return Math.floor(Math.random() * COLORS);
}

export function toneOfKind(k: number): number {
  return COLORS > 1 ? (k % COLORS) / (COLORS - 1) : 0.5;
}

export function kindLabel(k: number): string {
  return k < 0 ? '\u2605' : String((k % COLORS) + 1);
}

/**
 * Draws a ball for a player.
 * Note: Special balls (black/white) will NOT appear when players are at a draw in 2P mode (equal score, gap === 0) or when score is 0.
 * In solo mode, the player acts as winner and loser simultaneously once score > 0.
 * Black balls go to the player ahead, at twice the weight of any single colour.
 * White balls go to the player behind, at a rate set by the `white` knob.
 * The reverse assignment snowballed matches: see the Scoring page in
 * Notion, §9 Special Balls and Catch-Up.
 */
export function drawFor(p?: LauncherPlayer, playersList?: LauncherPlayer[], twoPlayerMode?: boolean): BallOnDeck {
  if (SPECIALS && p) {
    const isTwoPlayer = twoPlayerMode && playersList && playersList.length >= 2;
    let gap = 0;
    let canSpawn = false;

    if (isTwoPlayer) {
      const me = playersList.indexOf(p);
      if (me !== -1 && playersList[me] && playersList[1 - me]) {
        const s1 = playersList[me].score;
        const s2 = playersList[1 - me].score;
        gap = s1 - s2;
        canSpawn = s1 > 0 && s2 > 0 && gap !== 0;
      }
    } else {
      canSpawn = p.score > 0;
      gap = Math.random() < 0.5 ? 1 : -1;
    }

    if (canSpawn) {
      // Black (player ahead, gap > 0) carries twice the weight of any single colour: 2 / (COLORS + 2).
      // White (player behind, gap < 0) takes WHITE_ODDS of one slot: WHITE_ODDS / (COLORS + 1).
      const special: SpecialBallType = gap > 0
        ? (Math.floor(Math.random() * (COLORS + 2)) >= COLORS ? 'black' : null)
        : (Math.floor(Math.random() * (COLORS + 1)) === COLORS && Math.random() < WHITE_ODDS ? 'white' : null);
      if (special) return { kind: -1, special, color: special === 'black' ? BLACK_HEX : WHITE_HEX };
    }
  }
  const kind = randomKind();
  return { kind, color: colorOfKind(kind), special: null };
}
