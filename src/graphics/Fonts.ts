/**
 * One type system for every surface.
 *
 * The canvas cannot read the CSS custom properties in `index.css`, so the two
 * halves of the UI have to agree by hand. These stacks mirror `--font-ui` and
 * `--font-display` there; change both together or the HUD and the playfield
 * drift apart again.
 *
 * Weights are limited to the ones the `@font-face` rules at the top of
 * `index.css` ship (400-800 for Outfit, italic 800-900 for Montserrat; both
 * files are variable fonts cut to those ranges). Asking for a weight outside them
 * gets a synthesised approximation, which is how the old `500` and `900`
 * declarations ended up rendering as something else entirely.
 */
export const UI_FONT_STACK =
  "'Outfit', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

export const DISPLAY_FONT_STACK = "'Montserrat', 'Outfit', sans-serif";

/** UI text: ball labels, score pops, menu items. */
export function uiFont(weight: number, sizePx: number | string): string {
  return `${weight} ${sizePx}px ${UI_FONT_STACK}`;
}

/** The Tone Boom wordmark only — nothing else uses the display face. */
export function logoFont(sizePx: number | string): string {
  return `italic 900 ${sizePx}px ${DISPLAY_FONT_STACK}`;
}
