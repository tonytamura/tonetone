/**
 * The top of the AI ladder thinks before it throws: it tries each candidate
 * throw on a copy of the table, with the game's own physics, and keeps the one
 * that scored the most.
 *
 * This predicts; it does not play. It steps the same `stepPhysics` with the
 * same substep rule (`substepCount`) and launches with the same `throwBall` as
 * the real frame, on a copy, and nothing it does reaches the game: no sound is
 * played (the copy's sound events are dropped), no score is kept, and the
 * shared `Math.random` is swapped for a private generator while it runs, so a
 * seeded harness run draws exactly the same numbers with or without it.
 */
import { Game, syncFromCollisionState, throwBall, toCollisionState } from './GameState';
import { Ball, Group, LauncherPlayer, Shot } from '../physics/Types';
import { stepPhysics } from '../physics/CollisionSolver';
import { FALLBACK_DT, substepCount } from '../sim/Frame';

/** A copy of the table deep enough that simulating it cannot touch the original. */
export function cloneForPlanning(game: Game): Game {
  const shots = new Map<Shot, Shot>();
  const copyShot = (s: Shot | undefined) => {
    if (!s) return undefined;
    let c = shots.get(s);
    if (!c) { c = { ...s }; shots.set(s, c); }
    return c;
  };
  const ballOf = new Map<Ball, Ball>();
  const balls = game.balls.map(b => {
    const c: Ball = { ...b, bonds: new Set(b.bonds), shot: copyShot(b.shot), _pg: undefined };
    ballOf.set(b, c);
    return c;
  });
  const groupOf = new Map<Group, Group>();
  const groups = game.groups.map(g => {
    const c: Group = {
      ...g,
      members: g.members.map(m => ballOf.get(m) ?? m),
      offsets: g.offsets.map(o => ({ ...o })),
      com: { ...g.com },
    };
    groupOf.set(g, c);
    return c;
  });
  for (const [orig, c] of ballOf) c.group = groupOf.get(orig.group) ?? c.group;
  return {
    ...game,
    balls,
    groups,
    byId: new Map(balls.map(b => [b.id, b])),
    players: game.players.map(p => ({ ...p })),
    flashes: [],
    pops: [],
    lastHit: new Map(game.lastHit),
  };
}

/** Run `fn` with `Math.random` replaced by a private, seeded generator. */
function withPrivateRandom<T>(seed: number, fn: () => T): T {
  const shared = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = shared;
  }
}

/**
 * What player `who` scores in the next `seconds` if it throws now at `aimDeg`
 * and `strength`, and nobody else throws.
 */
export function scoreThrow(
  game: Game, who: number, aimDeg: number, strength: number, seconds: number, width: number, height: number
): number {
  const sim = cloneForPlanning(game);
  const p: LauncherPlayer = sim.players[who];
  p.aimDeg = aimDeg;
  p.strength = strength;
  p.reload = 0;
  const before = p.score;
  if (!throwBall(p, sim, width, height)) return -1;
  const state = toCollisionState(sim);
  let clock = 0;
  const frames = Math.round(seconds / FALLBACK_DT);
  for (let f = 0; f < frames; f++) {
    const n = substepCount(sim, FALLBACK_DT);
    for (let i = 0; i < n; i++) {
      clock += FALLBACK_DT / n;
      stepPhysics(state, FALLBACK_DT / n, clock, width, height);
    }
    state.sounds.length = 0;
    syncFromCollisionState(sim, state);
  }
  return p.score - before;
}

export interface Candidate { aimDeg: number; strength: number }

/**
 * The best of `candidates` for player `who`, by what each scores over
 * `seconds`, or null if none can be thrown. Every candidate sees the same
 * private random numbers, so they are compared on the table, not on luck.
 */
export function bestThrow(
  game: Game, who: number, candidates: Candidate[], seconds: number, width: number, height: number, seed: number
): (Candidate & { score: number }) | null {
  let best: (Candidate & { score: number }) | null = null;
  for (const c of candidates) {
    const s = withPrivateRandom(seed, () => scoreThrow(game, who, c.aimDeg, c.strength, seconds, width, height));
    if (s < 0) continue;
    if (!best || s > best.score) best = { ...c, score: s };
  }
  return best;
}
