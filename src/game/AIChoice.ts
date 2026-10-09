/**
 * Which AI plays vs AI matches, when it is not the ladder's choice.
 *
 * The `ailevel` knob sets it, an everyday option like the volume (no preset
 * resets it): 0 leaves the ladder in charge, and n forces rung n (1 = the
 * weakest) so a player can feel one level match after match. A forced match
 * counts in that AI's tally of wins, but neither moves the ladder nor sets a
 * best score. A Custom mode's match does move the ladder: breaking the AI
 * with odd settings is part of the fun. The game
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
