/**
 * The top of the AI ladder thinks before it throws: it tries candidate throws
 * on a copy of the table, with the game's own physics, and aims the one that
 * scored the most.
 *
 * This predicts; it does not play. It steps the same `stepPhysics` with the
 * same substep rule (`substepCount`) and launches with the same `throwBall` as
 * the real frame, on a copy, and nothing it does reaches the game: the copy's
 * sound events are dropped, its scores are thrown away, and the shared
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
 * How long, in milliseconds, planning may take in one frame. Unlimited by
 * default, which is what the harness uses: every candidate is tried on the
 * frame planning starts, so a seeded run is exactly reproducible. The page sets
 * a budget, and planning then spreads over the frames before the throw; a slow
 * device tries fewer candidates rather than dropping frames.
 */
let frameBudgetMs = Infinity;
export function setPlannerBudget(ms: number) {
  frameBudgetMs = ms;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
  private clock = 0;
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
    this.advanceLeft = Math.max(0, Math.round(untilThrow / FALLBACK_DT));
    this.rng = seed >>> 0;
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

  /** Work until done or until this frame's budget is spent. */
  run(): void {
    const start = now();
    const spent = () => now() - start > frameBudgetMs;
    const shared = Math.random;
    Math.random = () => this.next();
    try {
      // First carry the copy forward to the moment of the throw. Nobody else
      // throws in it, and no rain falls: only the planner's own throw is modelled.
      while (this.advanceLeft > 0) {
        this.step(this.base, this.baseState);
        this.advanceLeft--;
        if (this.advanceLeft % 8 === 0 && spent()) return;
      }
      while (!this.done) {
        if (!this.sim) {
          const c = this.candidates[this.idx];
          this.rng = (this.seed + this.roll * 0x9e3779b9) >>> 0;
          const sim = cloneForPlanning(this.base);
          const p = sim.players[this.who];
          p.aimDeg = c.aimDeg;
          p.strength = c.strength;
          p.reload = 0;
          this.simBefore = p.score;
          if (!throwBall(p, sim, this.width, this.height)) { this.idx++; continue; }
          this.sim = sim;
          this.simState = toCollisionState(sim);
          this.simFrames = Math.round(this.seconds / FALLBACK_DT);
        }
        while (this.simFrames > 0) {
          this.step(this.sim, this.simState!);
          this.simFrames--;
          if (this.simFrames % 8 === 0 && spent()) return;
        }
        this.total += this.sim.players[this.who].score - this.simBefore;
        this.sim = null;
        this.simState = null;
        if (++this.roll < this.rollouts) continue;
        const c = this.candidates[this.idx];
        const score = this.total / this.rollouts;
        if (!this.best || score > this.best.score) this.best = { ...c, score };
        this.roll = 0;
        this.total = 0;
        this.idx++;
        if (spent()) return;
      }
    } finally {
      Math.random = shared;
    }
  }
}
