/**
 * Every colour the game names, declared once.
 *
 * Before this file there were 101 hex literals in `src` naming 54 distinct
 * colours, plus 85 `rgb()`/`rgba()` literals — `MenuScreen.ts` alone held 75 of
 * the hex ones. A colour with a role was therefore spelled out wherever it was
 * used, and the copies had already drifted: player 1 was `#00e5ff` on their
 * launcher and `#4ff0ff` everywhere else.
 *
 * A colour earns a place here when it has a **role** — a player, the brand, the
 * backdrop, the ink. One-off gradient stops in the menu's artwork (the logo
 * balls, the speaker cone, the rays) stay local to the artwork that draws them:
 * they are shapes, not a palette.
 *
 * This module imports nothing, so anything may import it.
 */

export type Rgb = readonly [number, number, number];

/** `#rrggbb`, lower case. */
export function hex(c: Rgb): string {
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

/** `rgb(r,g,b)`. */
export function rgb(c: Rgb): string {
  return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
}

/**
 * `rgba(r,g,b,a)`.
 *
 * This is what stops an alpha variant from being a separate literal:
 * `rgba(0, 247, 255, 0.45)` is `rgba(MENU_CYAN, 0.45)`, and a reader can see
 * which named colour it is a fade of.
 */
export function rgba(c: Rgb, alpha: number): string {
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
}

/**
 * A colour `t` of the way from `a` to `b`, per channel, rounded to whole bytes.
 *
 * Channels are mixed as they are stored, so a ramp between two saturated hues
 * passes through a pale middle rather than around the colour wheel. That is what
 * the aim arrow wants — `WHITE` to `AIM_HOT` reads as heating up — and it is not
 * what a hue sweep would want.
 */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

// ── Brand and UI ───────────────────────────────────────────────────────────
// These four are mirrored by custom properties in `index.css`, and
// `tests/graphics/Palette.test.ts` fails if the two copies disagree.

/**
 * `--cyan`. Player 1, everywhere: launcher, aim arrow, score pops, HUD titles.
 *
 * This was `#4ff0ff` until 2026-09-19, with the launcher wearing a second cyan
 * `#00e5ff` of its own. The two were merged onto the launcher's deeper shade.
 * One thing that moved with it: the player's cyan is now CIEDE2000 5.1 from the
 * cyan **ball** `#42D4F4`, where it was 8.5 — and the cyan ball is on the table
 * whenever `colours` is 6, which all three of Cascade, Drift and Rally set.
 * That distance belongs to the ball-colour task; it is recorded here because
 * this is the colour that moved.
 */
export const CYAN: Rgb = [0x00, 0xe5, 0xff];
/** `--pink`. Player 2. */
export const PINK: Rgb = [0xff, 0x1a, 0xd9];
/** `--void`. The page behind everything. */
export const VOID: Rgb = [0x12, 0x07, 0x26];
/** `--ink`. Body text. */
export const INK: Rgb = [0xf3, 0xe7, 0xff];

// ── Canvas ─────────────────────────────────────────────────────────────────

/** The field's backdrop, painted flat once the match is over. */
export const FIELD_BG: Rgb = [0x14, 0x0a, 0x2b];

/**
 * The far end of the aim arrow's power ramp.
 *
 * The arrow is `WHITE` for every throw that will not boom, and from the boom
 * threshold up it reddens towards this, reaching it at the hardest throw the
 * bay can make. So most of a booming throw's range is a pale red — `#ffe7e7`
 * just past the threshold, `#ff8787` at seven tenths — and pure red is reserved
 * for full power.
 *
 * Two earlier cuts on 2026-09-19 are worth knowing about, because each was
 * wrong in a way the next one over-corrected:
 *
 * 1. The ramp ran across the range *below* the threshold and held flat red
 *    above it, which put the whole colour change where nothing was at stake.
 * 2. Turning it around, the arrow snapped to a coral `AIM_WARN` `#ff6b52` the
 *    moment it booked, to mark the threshold — and that made the low end of
 *    the booming range far too red. Tony: "it should be whiter near 0.4".
 *
 * So the snap is gone and the ramp starts at white — which leaves the boom
 * threshold invisible in the shaft, since at strength 0.30 the arrow is 99%
 * white where the old pink switch made that moment unmistakable. **The glow
 * carries it instead**: `drawAim` paints a white halo while the throw is safe
 * and a red one the moment it would boom, growing from 14px to 32px as the
 * throw hardens. Shaft for how hard, halo for whether — two channels, so
 * neither has to be read against the other.
 *
 * Red belongs to nothing else on the table: this is CIEDE2000 39.2 from `PINK`,
 * 63.7 from `CYAN`, and 39.0 from its nearest ball, the gold.
 */
export const AIM_HOT: Rgb = [0xff, 0x00, 0x00];

// ── Menu ───────────────────────────────────────────────────────────────────
// The menu screen keeps two brand colours of its own. A third, `#ff00aa`, was
// ΔE 7.5 from `PINK` and close enough to be the same intent; it was merged into
// `PINK` on 2026-09-19. These two are far enough from the brand pair to be
// deliberate, and the logo's split gradient needs the range.

/** The menu's cyan, ΔE 7.0 from `CYAN`. */
export const MENU_CYAN: Rgb = [0x00, 0xf7, 0xff];
/** The menu's deep pink, ΔE 15.5 from `PINK` — clearly a different colour. */
export const MENU_PINK_DEEP: Rgb = [0xff, 0x00, 0x7f];

// ── Neutrals ───────────────────────────────────────────────────────────────

export const WHITE: Rgb = [0xff, 0xff, 0xff];
export const BLACK: Rgb = [0x00, 0x00, 0x00];

// ── Ball colours ───────────────────────────────────────────────────────────
/**
 * The ball colours, in slot order: vaporwave, tuned for separation
 * (2026-09-30, the "Tune the ball colours for better separation" task).
 *
 * Vaporwave cannot be told apart by colour alone for a colour-blind player —
 * its yellow and mint collapse under protanopia, its violet and blue under
 * protanopia and deuteranopia — so the palette works in two parts:
 *
 * - **Slots 1–4 are separated by colour.** Each was moved at most CIEDE2000 10
 *   from its vaporwave original to push the closest pair apart for normal,
 *   protan and deutan vision: 20.8 at worst with three or four colours in play,
 *   where the palette before this measured 6.1 and 3.4.
 * - **Slots 5–6 lean on shape.** From five colours every ball carries its shape
 *   (`graphics/BallMarks.ts`), so violet and azure may share a hue family.
 *
 * Every colour is also kept clear of the players' cyan and pink, of the aim
 * arrow's red and of the board. `tests/graphics/BallPalette.test.ts` holds all
 * of it, so a later edit cannot quietly undo it.
 */
export const BALL_RGB: Rgb[] = [
  [0xef, 0xb2, 0x07], // Amber
  [0x9c, 0x04, 0xef], // Violet
  [0x6e, 0xfd, 0xc0], // Mint
  [0xe8, 0xb0, 0xff], // Lavender
  [0x0d, 0x8c, 0xef], // Azure
  [0xff, 0xb3, 0x8a], // Peach
];

/**
 * The same colours as CSS strings.
 *
 * A ball carries its colour as a string — it is handed straight to `fillStyle`
 * and compared against other balls' — so the string form is the one the game
 * uses, and the triples above are what it is built from.
 */
export const BALL_COLORS: string[] = BALL_RGB.map(hex);
/** The black special ball's colour, as a ball carries it. */
export const BLACK_HEX = hex(BLACK);
/** The white special ball's colour, as a ball carries it. */
export const WHITE_HEX = hex(WHITE);
