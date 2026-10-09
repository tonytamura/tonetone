/**
 * The top of the AI ladder thinks before it throws: it tries candidate throws
 * on a copy of the table, with the game's own physics, and aims the one that
 * scored the most.
 *
 * This predicts; it does not play. It steps the same `stepPhysics` with the
 * same substep rule (`substepCount`) and launches with the same `throwBall` as
 * the real frame (silently), on a copy, and nothing it does reaches the game: the
 * copy's sound events are dropped, its scores are thrown away, and the shared
 * `Math.random` is swapped for a private generator while it runs, so a seeded
 * harness run draws exactly the same numbers with or without it.
 */
import { Game, syncFromCollisionState, throwBall, toCollisionState } from './GameState';
import { Ball, Group, Shot } from '../physics/Types';
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

export interface Candidate { aimDeg: number; strength: number }

/**
 * How many physics frames the planner may simulate per real frame, in the game
 * and in the harness alike, so the AGI the harness measures is the one that
 * ships, and it plays the same on every device.
 *
 * It used to be 4ms of wall time in the page and unlimited in the harness. A
 * plan is ~4,200 simulated frames at ~0.3ms each on a laptop, so the page's AGI
 * tried about a quarter of its candidates before each throw while the harness's
 * tried them all: the ladder's AGI figures described an AI nobody played.
 *
 * 16 is the least that keeps AGI a rung (2026-10-09, AGI v AI3, 40 two-minute
 * matches): at 8 it won 34% ±7, its first candidates' three tries eating the
 * whole window; at 16 it won 73% ±7. Plans cut to fit 8 (1s look-ahead, 2 or
 * 3 tries) stayed inside the noise, 40-57%. Cost on a laptop: 2.4ms median,
 * 6.5ms p90 per frame while planning, which runs only against AGI.
 */
export const PLAN_FRAMES_PER_FRAME = 16;
let frameBudget = PLAN_FRAMES_PER_FRAME;
/** Override the budget, in simulated frames per real frame. Tests use Infinity to plan in one go. */
export function setPlannerBudget(frames: number) {
  frameBudget = frames;
}

/**
 * How much planning got done: jobs started, and candidates tried out of those
 * offered. Under a frame budget on a slow device the second falls short of the
 * third; the page can read these to see how much an AI actually thought.
 */
export const plannerStats = { jobs: 0, tried: 0, offered: 0 };

type ColState = ReturnType<typeof toCollisionState>;

/**
 * One planning job: the table carried forward to the moment the ring fills,
 * then each candidate thrown into a copy of it and followed for `seconds`.
 * Resumable, so it can run a few simulated frames at a time.
 *
 * Every candidate starts the private generator from the same seed, so they are
 * compared on the table, not on how the debris happened to scatter for each.
 */
export class PlanJob {
  private readonly base: Game;
  private readonly baseState: ColState;
  private advanceLeft: number;
  private idx = 0;
  private sim: Game | null = null;
  private simState: ColState | null = null;
  private simFrames = 0;
  private simBefore = 0;
  private roll = 0;
  private total = 0;
  /** The simulated clock: starts at the game's, since `lastHit`'s cooldowns are on it. */
  private clock: number;
  /** The clock at the moment of the throw, where every candidate starts. */
  private throwClock = 0;
  private rng: number;
  best: (Candidate & { score: number }) | null = null;

  constructor(
    game: Game,
    private readonly who: number,
    private readonly candidates: Candidate[],
    private readonly seconds: number,
    /** Seconds until the throw: how far to carry the table forward first. */
    untilThrow: number,
    private readonly width: number,
    private readonly height: number,
    private readonly seed: number,
    /**
     * Tries per candidate, each with its own scatter of debris, averaged. One
     * try reads a throw through a single roll of the dice; more read it better.
     */
    private readonly rollouts = 1,
  ) {
    this.base = cloneForPlanning(game);
    this.baseState = toCollisionState(this.base);
    // Pair cooldowns are stamped on the game's clock. Starting at 0 put every
    // pair that had collided this match in cooldown for the whole plan, so in
    // the imagined throws they never locked, boomed or peeled again: 18% of
    // candidate scores were wrong, and 1 decision in 6.
    this.clock = this.throwClock = game.clock;
    this.advanceLeft = Math.max(0, Math.round(untilThrow / FALLBACK_DT));
    this.rng = seed >>> 0;
    plannerStats.jobs++;
    plannerStats.offered += candidates.length;
  }

  get done(): boolean {
    return this.idx >= this.candidates.length && !this.sim;
  }

  /** mulberry32, on the job's own state. */
  private next(): number {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private step(g: Game, st: ColState) {
    const n = substepCount(g, FALLBACK_DT);
    for (let i = 0; i < n; i++) {
      this.clock += FALLBACK_DT / n;
      stepPhysics(st, FALLBACK_DT / n, this.clock, this.width, this.height);
    }
    st.sounds.length = 0;
    syncFromCollisionState(g, st);
  }

  /** Work until done or until this frame's budget of simulated frames is spent. */
  run(): void {
    let frames = 0;
    const spent = () => ++frames >= frameBudget;
    const shared = Math.random;
    Math.random = () => this.next();
    try {
      // First carry the copy forward to the moment of the throw. Nobody else
      // throws in it, and no rain falls: only the planner's own throw is modelled.
      while (this.advanceLeft > 0) {
        this.step(this.base, this.baseState);
        this.advanceLeft--;
        this.throwClock = this.clock;
        if (spent()) return;
      }
      while (!this.done) {
        if (!this.sim) {
          const c = this.candidates[this.idx];
          this.rng = (this.seed + this.roll * 0x9e3779b9) >>> 0;
          const sim = cloneForPlanning(this.base);
          // Every try starts at the moment of the throw: carrying the clock on
          // from the last try left later candidates on a different footing.
          this.clock = this.throwClock;
          const p = sim.players[this.who];
          p.aimDeg = c.aimDeg;
          p.strength = c.strength;
          p.reload = 0;
          this.simBefore = p.score;
          // Silent: an imagined throw must not be heard.
          if (!throwBall(p, sim, this.width, this.height, { silent: true })) { this.idx++; continue; }
          this.sim = sim;
          this.simState = toCollisionState(sim);
          this.simFrames = Math.round(this.seconds / FALLBACK_DT);
        }
        while (this.simFrames > 0) {
          this.step(this.sim, this.simState!);
          this.simFrames--;
          if (spent()) return;
        }
        this.total += this.sim.players[this.who].score - this.simBefore;
        this.sim = null;
        this.simState = null;
        if (++this.roll < this.rollouts) continue;
        const c = this.candidates[this.idx];
        const score = this.total / this.rollouts;
        if (!this.best || score > this.best.score) this.best = { ...c, score };
        plannerStats.tried++;
        this.roll = 0;
        this.total = 0;
        this.idx++;
      }
    } finally {
      Math.random = shared;
    }
  }
}
