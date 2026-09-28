/**
 * Which AI plays vs AI matches, when it is not the ladder's choice.
 *
 * The `ailevel` knob (Custom only) sets it: 0 leaves the ladder in charge, and
 * n forces rung n (1 = the weakest) so a player can feel one level match after
 * match. A forced match neither moves the ladder nor sets a record. The harness
 * never uses it; it seats AIs through its own options.
 */
export let FORCED_AI_LEVEL = 0;

export function setForcedAiLevel(v: number) {
  FORCED_AI_LEVEL = Math.max(0, Math.round(v));
}
