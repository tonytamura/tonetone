/**
 * Which AI plays vs AI matches, when it is not the ladder's choice.
 *
 * The `ailevel` knob (Custom only) sets it: 0 leaves the ladder in charge, and
 * n forces rung n (1 = the weakest) so a player can feel one level match after
 * match. A forced match neither moves the ladder nor sets a record. The game
 * and the harness both pick the level through `aiLevelFor`; the harness used to
 * ignore the knob, so a `sweep ailevel=…` measured the classic AI every time.
 */
export let FORCED_AI_LEVEL = 0;

export function setForcedAiLevel(v: number) {
  FORCED_AI_LEVEL = Math.max(0, Math.round(v));
}

/** The `game.aiLevel` a vs AI match plays: the forced rung if one is set, else `otherwise`. */
export function aiLevelFor(otherwise: number): number {
  return FORCED_AI_LEVEL > 0 ? FORCED_AI_LEVEL - 1 : otherwise;
}
