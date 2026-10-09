/**
 * The headless simulation harness.
 *
 * Runs real matches with no browser, no canvas and no audio, under a seeded
 * `Math.random`, and reports what happened. It drives `advanceFrame` — the same
 * function the browser build's game loop calls — so it always measures the
 * shipping simulation rather than a copy of it.
 */
import { aiLevelFor } from '../game/AIChoice';
import {
  Game, PlayMode, createGame, liveBallCount, lowDensityThreshold, resetField, startMatch,
} from '../game/GameState';
import { LauncherPlayer, Shot } from '../physics/Types';
import { recalcThresholds } from '../physics/Config';
import { aiAim, aiAimProfile, profileNamed } from '../game/AI';
import { AudioStore } from '../audio/SynthEngine';
import { FALLBACK_DT, advanceFrame } from './Frame';
import { installSeededRandom, restoreRandom } from './Rng';
import {
  ConfigSnapshot, KnobContext, KnobValue,
  applyKnobDefaults, applyKnobs, readKnobs, restoreConfig, snapshotConfig,
} from './Knobs';
import {
  Invariants, NO_VIOLATION, PlayerTotals, Sample,
  checkInvariants, playerTotals, sampleField, worstOf,
} from './Metrics';
import { catchUp } from './Stats';

/** Default field size: a 380x620 phone portrait, where the scale factor is 1. */
export const DEFAULT_WIDTH = 380;
export const DEFAULT_HEIGHT = 620;

/**
 * Scoring events from one throw that make it a "long chain".
 *
 * A throw that locks and then booms has 2 events and is an ordinary good shot:
 * across the three shipped presets the median throw scores exactly 2, and the
 * 90th percentile is 7. Eight is therefore the top decile — the cascade a player
 * actually notices, where a boom's debris reaches a second group whose debris
 * reaches a third. Measured at 9.2% of throws under Normal, 11.1% under Relax
 * and 4.3% under Chaos, which is enough spread for the figure to discriminate
 * between presets rather than saturate.
 */
export const LONG_CHAIN = 8;

/**
 * How a launcher is driven.
 *
 * These are proxies for a player, and a weak one is worth naming rather than
 * hiding: `engine-ai` aims at the biggest group at a random power and never
 * checks whether the line is clear, so in a crowded field it bleeds most of a
 * shot's speed into whatever it clips. Where the skill under test is shot
 * selection, no policy here represents it — say so instead of reporting the
 * number as a finding.
 */
export type PolicyName = 'engine-ai' | 'fixed' | 'random' | 'sweep' | string;

/**
 * The AI a policy name seats: a ladder rung (`ai1`, `ai2`, `ai3`, `agi`), a
 * named strategy (`random`, `careless`, `current`, `hard`, `nearest`, `value`,
 * `valueSoft`, `planner`, `agi`), or null for the non-AI policies.
 */
export function policyProfile(policy: PolicyName) {
  return profileNamed(policy);
}

export type Mode = PlayMode | 'idle';

export interface SimOptions {
  /** Seed for the run. The same seed reproduces the run exactly. */
  seed?: number;
  /** Simulated seconds to run. */
  seconds?: number;
  width?: number;
  height?: number;
  /**
   * `solo` one launcher; `duel` two, both harness-driven; `ai` two, with the
   * shipped AI on player 2; `idle` nobody throws — the do-nothing baseline.
   */
  mode?: Mode;
  /** Knob overrides by id, applied on top of the registry defaults. */
  knobs?: Record<string, KnobValue>;
  /** Per-player aim policy. Player 2 is ignored in `ai` mode. */
  policies?: [PolicyName, PolicyName];
  /** The AI ladder rung that plays player 2 in `ai` mode. Defaults to the classic rung. */
  aiLevel?: number;
  /** Fixed frame delta. Defaults to 1/60s. */
  dt?: number;
  /** Frames between field samples. Invariants are always checked every frame. */
  sampleEvery?: number;
  /** Set false to skip invariant checking on long balance runs. */
  invariants?: boolean;
  /** Called after every frame, for custom measurements. */
  onFrame?: (game: Game, frame: number, t: number) => void;
  /**
   * Matches played on the same Game before the measured one, as the app plays
   * match after match on one Game: each runs to its match clock (or `seconds`),
   * then the field is reset the way a new match resets it. A fresh Game per run
   * could never see state a match leaves behind (Bugs 20 and 21).
   */
  priorMatches?: number;
  /** Seconds the launchers hold at the start, as the app's countdown does. Default 0. */
  countdown?: number;
}

export interface RunResult {
  seed: number;
  seconds: number;
  frames: number;
  width: number;
  height: number;
  mode: Mode;
  policies: [PolicyName, PolicyName];
  /** Every knob's value as the run actually saw it. */
  knobs: Record<string, KnobValue>;
  players: [PlayerTotals, PlayerTotals];
  /** Largest group ever boomed. */
  killBig: number;
  /** Groups boomed over the run. */
  killGroups: number;
  /** Balls destroyed over the run. */
  killBalls: number;
  /**
   * Mean group size at the moment of booming. Watch this next to
   * `boomsPerMinute`: frequent booms of 2 balls are not the same game as
   * occasional booms of 9, and the per-minute figure alone cannot tell them apart.
   */
  boomSize: number;
  boomsPerMinute: number;
  /** Throws that left the launcher. */
  throws: number;
  /**
   * Fire attempts a blocked bay refused.
   *
   * A refusal does not consume the reload, so a bay with balls parked in front
   * of it retries on *every* frame until the corridor clears. This is therefore
   * a count of refused frames, not of refused turns: one blocked second is 60.
   * Read `blockedFrac` for the figure with a meaningful denominator.
   */
  blockedThrows: number;
  /**
   * Share of launcher-time spent ready but refused — blocked frames over all
   * frames both bays were live.
   *
   * Normalised by time rather than by fire attempts, because attempts are
   * inflated by the 60Hz retry above: a field that refused 72% of *attempts*
   * turned out to have stopped a launcher for only 1.4% of the match. The
   * time-based figure is the one that describes what a player would feel.
   */
  blockedFrac: number;
  ballsAvg: number;
  ballsMax: number;
  ballsMin: number;
  ballsFinal: number;
  /** Live (non-ghost) balls: the playable material, excluding boom debris. */
  liveAvg: number;
  liveMin: number;
  /**
   * Share of frames spent below the game's own low-density threshold — the
   * point at which auto rain starts refilling the table. High means the field
   * keeps emptying out and the player is waiting for material.
   */
  starvedFrac: number;
  /**
   * Scoring events traceable to one throw, over every throw that reached the
   * field. `chainAvg` counts throws that scored nothing as zero, so it is the
   * mean yield of a throw rather than of a successful one.
   */
  chainAvg: number;
  chainBest: number;
  /** Share of throws whose cascade reached `LONG_CHAIN` scoring events. */
  chainLongFrac: number;
  /**
   * Times the lead changed hands. Only meaningful with two launchers playing;
   * a solo run reports 0.
   */
  leadChanges: number;
  /**
   * White balls drawn over the run, across both players.
   *
   * Only the player who is behind can draw one, so this is a property of the
   * match as much as of the knob: a run that stayed level, or where a score sat
   * at zero, offers fewer draws that are eligible at all.
   */
  whites: number;
  /** Black balls drawn over the run, across both players. */
  blacks: number;
  /** Deck cards drawn over the run, across both players — the denominator. */
  draws: number;
  groupAvg: number;
  groupMax: number;
  /** Worst invariant reading seen on any frame, and when. */
  worst: Invariants;
  worstAt: number;
  /** Scores at the halfway point and at the end, for paired comparisons. */
  halfTimeScores: [number, number];
  finalScores: [number, number];
  samples: Sample[];
  /** True if the match clock ran out before `seconds` elapsed. */
  endedEarly: boolean;
}

function applyPolicy(
  policy: PolicyName,
  p: LauncherPlayer,
  game: Game,
  width: number,
  height: number,
  t: number,
  dt: number
): void {
  switch (policy) {
    case 'engine-ai':
      aiAim(p, game.groups, game.balls, width, height, game.twoPlayer, dt);
      return;
    case 'random':
      p.aimDeg = Math.random() * 180 - 90;
      p.strength = Math.random();
      return;
    case 'sweep':
      // A slow oscillation across the full aim span, at steady three-quarter power.
      p.aimDeg = Math.sin(t * 0.7 + (p.side > 0 ? 0 : Math.PI / 2)) * 80;
      p.strength = 0.75;
      return;
    case 'fixed':
      return;
    default: {
      const prof = policyProfile(policy);
      if (prof) aiAimProfile(p, game, width, height, prof, dt);
      return;
    }
  }
}

/**
 * Run one simulated match and report on it.
 *
 * Module-level config (`PhysicsConfig`, the Rules palette, `AudioStore`) is
 * shared mutable state, so the run snapshots it, and restores it along with
 * `Math.random` even if the simulation throws.
 */
export function runSim(opts: SimOptions = {}): RunResult {
  const seed = opts.seed ?? 1;
  const seconds = opts.seconds ?? 60;
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const mode = opts.mode ?? 'solo';
  const dt = opts.dt ?? FALLBACK_DT;
  const sampleEvery = opts.sampleEvery ?? 30;
  const wantInvariants = opts.invariants !== false;
  const policies: [PolicyName, PolicyName] = opts.policies ?? ['engine-ai', 'engine-ai'];

  const snapshot: ConfigSnapshot = snapshotConfig();
  const soundWas = AudioStore.soundOn;

  try {
    // No AudioContext exists under node, so the voices would no-op anyway; turning
    // sound off makes that explicit and keeps the run free of audio side effects.
    AudioStore.soundOn = false;
    installSeededRandom(seed);
    recalcThresholds(height);

    const game = createGame();
    game.twoPlayer = mode === 'duel' || mode === 'ai';
    game.aiOn = mode === 'ai';
    if (opts.aiLevel !== undefined) game.aiLevel = opts.aiLevel;
    // The harness's players are policies, not fingers: under continuous fire
    // they release by themselves. `idle` has nobody throwing at all.
    game.bots = mode === 'idle' ? [false, false] : [true, true];

    const ctx: KnobContext = { game, height };
    applyKnobDefaults(ctx);
    // Balance runs are windowed by `seconds`, so the match clock is off unless the
    // caller explicitly asked for a match length.
    if (!opts.knobs || !('match' in opts.knobs)) game.matchLen = 0;
    if (opts.knobs) applyKnobs(opts.knobs, ctx);
    recalcThresholds(height);
    // The `ailevel` knob forces a rung as it does in the game, unless the caller seats one.
    if (game.aiOn && opts.aiLevel === undefined) game.aiLevel = aiLevelFor(game.aiLevel);

    let clock = 0;
    const totalFrames = Math.max(1, Math.round(seconds / dt));
    for (let m = 0; m < (opts.priorMatches ?? 0); m++) {
      resetField(game, width, height);
      startMatch(game, opts.countdown ?? 0);
      for (let f = 0; f < totalFrames && !game.matchOver; f++) {
        if (mode !== 'idle') {
          applyPolicy(policies[0], game.players[0], game, width, height, f * dt, dt);
          if (game.twoPlayer && !game.aiOn) applyPolicy(policies[1], game.players[1], game, width, height, f * dt, dt);
        }
        clock = advanceFrame(game, dt, width, height, clock).clock;
      }
    }

    resetField(game, width, height);
    // Countdown 0 by default: the harness fires on the first frame. The browser
    // holds fire for one reload instead (`countdown` models it), so a measured
    // match is very slightly longer than a played one at the same `seconds`.
    startMatch(game, opts.countdown ?? 0);
    // `idle` never fires a throw: lock all reload timers at Infinity so the
    // launcher bays never become ready. (game.turnT was removed in the
    // simultaneous-play refactor; this is the current equivalent guard.)
    if (mode === 'idle') {
      for (const p of game.players) p.reload = Infinity;
    }

    // Half-time of the match itself when it is shorter than the window: taken
    // from `seconds` alone, a 60s match in a 180s window read its half-time at
    // 90s, after it had ended, and catch-up became the final lead.
    const matchFrames = game.matchLen > 0 ? Math.round(game.matchLen / dt) : totalFrames;
    const halfFrame = Math.floor(Math.min(totalFrames, matchFrames) / 2);

    let worst: Invariants = NO_VIOLATION;
    let worstAt = 0;
    const samples: Sample[] = [];
    let ballsSum = 0, ballsMax = 0, ballsMin = Infinity;
    let liveSum = 0, liveMin = Infinity, starvedFrames = 0;
    let groupSum = 0, groupMax = 0, groupFrames = 0;
    let throws = 0, blockedThrows = 0;
    let leadChanges = 0, leadSign = 0;
    const starveAt = lowDensityThreshold(width, height);
    /**
     * Every throw's tally object, gathered off the balls that carry it.
     *
     * `Shot.events` is incremented in place by the solver and only ever grows,
     * so holding the object is enough to read a chain's final depth after the
     * run: there is no need to poll the number. Collecting them here rather than
     * counting inside the solver keeps the measurement out of the shipping
     * physics — the baseline is unmoved by the act of measuring it.
     */
    const shots = new Set<Shot>();
    /**
     * Deck cards already counted, per player.
     *
     * A draw is a fresh `BallOnDeck` object, and `loaded = nextUp` moves that
     * same object down the deck, so identity is what separates a new draw from a
     * card sliding forward. Counting here rather than inside `drawFor` keeps the
     * measurement out of the shipping rules, the way `shots` does for chains.
     */
    const drawn: [Set<object>, Set<object>] = [new Set(), new Set()];
    let whites = 0, blacks = 0;
    let halfTimeScores: [number, number] = [0, 0];
    let endedEarly = false;
    let frame = 0;

    for (; frame < totalFrames; frame++) {
      const t = frame * dt;

      if (mode !== 'idle') {
        applyPolicy(policies[0], game.players[0], game, width, height, t, dt);
        // In `ai` mode advanceFrame drives player 2 itself; doing it here too
        // would apply the AI's smoothing twice per frame.
        if (game.twoPlayer && !game.aiOn) {
          applyPolicy(policies[1], game.players[1], game, width, height, t, dt);
        }
      }

      const res = advanceFrame(game, dt, width, height, clock);
      clock = res.clock;

      throws += res.threw;
      blockedThrows += res.fired - res.threw;

      let inv: Invariants = NO_VIOLATION;
      if (wantInvariants) {
        inv = checkInvariants(game, width, height);
        // `worst` is the component-wise high-water mark over the whole run, so
        // `worstAt` has to be the moment that mark was last raised. It used to
        // be the moment a separate composite score peaked, which could name a
        // different frame than the one `worst` actually describes.
        const merged = worstOf(worst, inv);
        if (
          merged.overlap !== worst.overlap ||
          merged.frozen !== worst.frozen ||
          merged.outside !== worst.outside
        ) {
          worstAt = t;
        }
        worst = merged;
      }

      ballsSum += game.balls.length;
      if (game.balls.length > ballsMax) ballsMax = game.balls.length;
      if (game.balls.length < ballsMin) ballsMin = game.balls.length;

      const live = liveBallCount(game);
      liveSum += live;
      if (live < liveMin) liveMin = live;
      if (live < starveAt) starvedFrames++;

      for (const b of game.balls) if (b.shot) shots.add(b.shot);

      // A lead change is a sign flip of the score difference. A tie is not a
      // change of hands on its own — the lead has to come out the other side —
      // so a zero gap holds the previous sign rather than clearing it.
      if (game.twoPlayer) {
        const gap = game.players[0].score - game.players[1].score;
        const sign = gap > 0 ? 1 : gap < 0 ? -1 : 0;
        if (sign !== 0) {
          if (leadSign !== 0 && sign !== leadSign) leadChanges++;
          leadSign = sign;
        }
      }

      let frameMax = 0;
      for (const g of game.groups) if (g.members.length > frameMax) frameMax = g.members.length;
      groupSum += frameMax;
      groupFrames++;
      if (frameMax > groupMax) groupMax = frameMax;

      if (frame % sampleEvery === 0) {
        // `inv` is this frame's reading, taken above; nothing has moved since.
        samples.push(sampleField(game, t, inv));
      }
      if (frame === halfFrame) {
        halfTimeScores = [game.players[0].score, game.players[1].score];
      }

      // Only the decks in play: solo's second launcher never throws, and counting
      // its untouched deck put 12% more draws under whiteFrac than solo made.
      for (let i = 0; i < (game.twoPlayer ? 2 : 1); i++) {
        const p = game.players[i];
        for (const slot of ['loaded', 'nextUp', 'then'] as const) {
          const card = p[slot];
          if (!card || drawn[i].has(card)) continue;
          drawn[i].add(card);
          if (card.special === 'white') whites++;
          else if (card.special === 'black') blacks++;
        }
      }

      opts.onFrame?.(game, frame, t);

      if (game.matchOver) { endedEarly = true; frame++; break; }
    }

    const elapsed = frame * dt;
    const minutes = elapsed / 60 || 1 / 60;

    const depths = [...shots].map(sh => sh.events);
    const chainAvg = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
    const chainBest = depths.reduce((a, b) => Math.max(a, b), 0);
    const chainLongFrac = depths.length
      ? depths.filter(d => d >= LONG_CHAIN).length / depths.length
      : 0;
    // Launcher-frames available over the run: one per active bay per frame.
    const launcherFrames = Math.max(1, frame) * (game.twoPlayer ? 2 : 1);

    return {
      seed,
      seconds: elapsed,
      frames: frame,
      width,
      height,
      mode,
      policies,
      knobs: readKnobs(ctx),
      players: [playerTotals(game, 0), playerTotals(game, 1)],
      killBig: game.killBig,
      killGroups: game.killGroups,
      killBalls: game.killBalls,
      boomSize: game.killGroups ? game.killBalls / game.killGroups : 0,
      boomsPerMinute: game.killGroups / minutes,
      throws,
      blockedThrows,
      blockedFrac: blockedThrows / launcherFrames,
      ballsAvg: ballsSum / Math.max(1, frame),
      ballsMax,
      ballsMin: Number.isFinite(ballsMin) ? ballsMin : 0,
      ballsFinal: game.balls.length,
      liveAvg: liveSum / Math.max(1, frame),
      liveMin: Number.isFinite(liveMin) ? liveMin : 0,
      starvedFrac: starvedFrames / Math.max(1, frame),
      chainAvg,
      chainBest,
      chainLongFrac,
      leadChanges,
      whites,
      blacks,
      draws: drawn[0].size + drawn[1].size,
      groupAvg: groupSum / Math.max(1, groupFrames),
      groupMax,
      worst,
      worstAt,
      halfTimeScores,
      finalScores: [game.players[0].score, game.players[1].score],
      samples,
      endedEarly,
    };
  } finally {
    restoreRandom();
    restoreConfig(snapshot);
    AudioStore.soundOn = soundWas;
  }
}

/**
 * Run the same configuration across consecutive seeds. One run of a chaotic
 * simulation is an anecdote; the repeat count is what makes it a measurement.
 */
export function runMany(opts: SimOptions, runs: number, firstSeed = 1): RunResult[] {
  const out: RunResult[] = [];
  for (let i = 0; i < runs; i++) out.push(runSim({ ...opts, seed: firstSeed + i }));
  return out;
}

/** Pull one number out of each run, for the statistics helpers. */
export type Extractor = (r: RunResult) => number;

/**
 * The metrics `sweep` and `compare` can be pointed at, by name.
 *
 * There are three maps from a name to a number in this project, and they look
 * alike enough to invite merging. They should not be merged, and this is the
 * reason, recorded at all three so it is not rediscovered:
 *
 * - **`EXTRACTORS`** (`sim/Harness.ts`) is a **menu** a person picks from for
 *   `sweep` and `compare`. Full precision; sums the two players together.
 * - **`digest`** (`sim/Baseline.ts`) is an **exact-reproducibility fingerprint**
 *   behind `BASELINE_VERSION`. It rounds each field to a chosen number of
 *   places — that rounding is its tolerance — keeps the players apart, and
 *   carries the invariant worsts, which nobody sweeps.
 * - **`cmdRun`'s table** (`scripts/sim.ts`) is a **report for a human**, with
 *   per-player columns and composite rows like `balls (avg / max / final)`.
 *
 * Merging any two makes one of them stop being what it is, and merging anything
 * into `digest` changes what every refactor in this project is measured against.
 */
export const EXTRACTORS: Record<string, Extractor> = {
  score: r => r.players[0].score + r.players[1].score,
  p1score: r => r.players[0].score,
  p2score: r => r.players[1].score,
  booms: r => r.killGroups,
  boomSize: r => r.boomSize,
  boomsPerMinute: r => r.boomsPerMinute,
  ballsDestroyed: r => r.killBalls,
  biggestBoom: r => r.killBig,
  locks: r => r.players[0].locks + r.players[1].locks,
  peels: r => r.players[0].peels + r.players[1].peels,
  ballsAvg: r => r.ballsAvg,
  ballsFinal: r => r.ballsFinal,
  groupAvg: r => r.groupAvg,
  groupMax: r => r.groupMax,
  bestGroup: r => Math.max(r.players[0].best, r.players[1].best),
  throws: r => r.throws,

  // The five qualities a preset is judged on, each as one number.
  /** Long chains: mean and best cascade depth, and how often a cascade runs long. */
  chainAvg: r => r.chainAvg,
  chainBest: r => r.chainBest,
  chainLongFrac: r => r.chainLongFrac,
  /** Blocking: the share of fires the table refused. Lower is better. */
  blockedFrac: r => r.blockedFrac,
  blockedThrows: r => r.blockedThrows,
  /** Density: playable material on the table, and how often it ran out. */
  liveAvg: r => r.liveAvg,
  liveMin: r => r.liveMin,
  starvedFrac: r => r.starvedFrac,
  ballsMin: r => r.ballsMin,
  /**
   * Catch-up: ground the half-time trailer recovered, and lead changes. Both
   * need two launchers; in solo they are a constant 0 and mean nothing.
   */
  catchUp: r => catchUp(r.halfTimeScores, r.finalScores),
  leadChanges: r => r.leadChanges,
  /**
   * Special balls. `whites` is the count over the run, so read it against the
   * run length rather than as a per-match figure unless the run *is* a match.
   * `noWhite` is 0 or 1 per run, which makes its mean across runs the share of
   * matches that produced no white at all — the figure to drive to zero.
   */
  whites: r => r.whites,
  blacks: r => r.blacks,
  noWhite: r => (r.whites === 0 ? 1 : 0),
  whiteFrac: r => (r.draws ? r.whites / r.draws : 0),
};

export function extractorNames(): string[] {
  return Object.keys(EXTRACTORS);
}

export function extract(name: string): Extractor {
  const f = EXTRACTORS[name];
  if (!f) throw new Error(`Unknown metric "${name}". Known metrics: ${extractorNames().join(', ')}`);
  return f;
}
