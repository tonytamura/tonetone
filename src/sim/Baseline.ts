/**
 * Simulation baselines.
 *
 * Because every run is seeded, a fixed set of scenarios produces byte-identical
 * numbers on an unchanged build. That turns a vague question — "did my edit
 * change how the game plays?" — into an exact one. A pure refactor reproduces
 * the baseline exactly; a retune shows precisely which metrics moved and by how
 * much; an accident shows movement where the author expected none.
 *
 * The scenario list deliberately spans field sizes. Speeds are written in px/s,
 * so they behave differently on a shorter field, and a whole class of feel bugs
 * only appears when the same shot is measured at two heights.
 */
import { RunResult, SimOptions, runSim } from './Harness';
import { presetKnobs } from './Knobs';
import { levelIndex } from '../game/AI';

const withoutMatch = (id: string) => { const k = presetKnobs(id); delete k.match; return k; };

export interface BaselineScenario {
  label: string;
  opts: SimOptions;
}

export const BASELINE_SCENARIOS: BaselineScenario[] = [
  { label: 'solo/380x620/s1', opts: { mode: 'solo', seed: 1, seconds: 60 } },
  { label: 'solo/380x620/s2', opts: { mode: 'solo', seed: 2, seconds: 60 } },
  { label: 'solo/380x620/s3', opts: { mode: 'solo', seed: 3, seconds: 60 } },
  { label: 'duel/380x620/s1', opts: { mode: 'duel', seed: 1, seconds: 60 } },
  { label: 'duel/380x620/s2', opts: { mode: 'duel', seed: 2, seconds: 60 } },
  { label: 'ai/380x620/s1', opts: { mode: 'ai', seed: 1, seconds: 60 } },
  { label: 'ai/380x620/s2', opts: { mode: 'ai', seed: 2, seconds: 60 } },
  { label: 'idle/380x620/s1', opts: { mode: 'idle', seed: 1, seconds: 60 } },
  // A short field: px/s speeds cross it faster, which is where feel bugs hide.
  { label: 'solo/380x460/s1', opts: { mode: 'solo', seed: 1, seconds: 60, height: 460 } },
  // A tablet-sized field.
  { label: 'duel/768x1024/s1', opts: { mode: 'duel', seed: 1, seconds: 60, width: 768, height: 1024 } },
  // Version 3: what the scenarios above could not see. Every one of them played
  // the pre-ladder AI, automatic fire, no match clock and three colours, on a
  // fresh Game — breaking every ladder rung moved no row at all.
  { label: 'ai/ai1/380x620/s1', opts: { mode: 'ai', aiLevel: levelIndex('ai1'), seed: 1, seconds: 60 } },
  { label: 'ai/ai2/380x620/s1', opts: { mode: 'ai', aiLevel: levelIndex('ai2'), seed: 1, seconds: 60 } },
  { label: 'ai/ai3/380x620/s1', opts: { mode: 'ai', aiLevel: levelIndex('ai3'), seed: 1, seconds: 60 } },
  { label: 'ai/agi/380x620/s1', opts: { mode: 'ai', aiLevel: levelIndex('agi'), seed: 1, seconds: 30 } },
  { label: 'fire/duel/380x620/s1', opts: { mode: 'duel', seed: 1, seconds: 60, knobs: { fire: 1 } } },
  { label: 'fire/ai/ai3/380x620/s1', opts: { mode: 'ai', aiLevel: levelIndex('ai3'), seed: 1, seconds: 60, knobs: { fire: 1 } } },
  // A match clock that runs out inside the window: the end, and what stops at it.
  { label: 'match45/duel/380x620/s1', opts: { mode: 'duel', seed: 1, seconds: 60, knobs: { match: 45 } } },
  { label: 'cascade/duel/380x620/s1', opts: { mode: 'duel', seed: 1, seconds: 60, knobs: withoutMatch('cascade') } },
  { label: 'rally/duel/380x620/s1', opts: { mode: 'duel', seed: 1, seconds: 60, knobs: withoutMatch('rally') } },
  // The match after a match, on the same Game, after the app's countdown.
  { label: 'second/ai/ai2/380x620/s1', opts: { mode: 'ai', aiLevel: levelIndex('ai2'), seed: 1, seconds: 45, priorMatches: 1, countdown: 3, knobs: { match: 45 } } },
];

const chaos = withoutMatch('chaos');

/**
 * The invariants gate runs these on top of the baseline scenarios.
 *
 * Each is a seed that once put a rain ball down inside a rigid group, which no
 * baseline seed happens to do. Chaos seed 19 left an 8.4px overlap for a frame;
 * forced rain seed 8 wedged a ball 12.6px deep for three seconds. They are here
 * rather than in the baseline so that adding them does not move it.
 */
export const INVARIANT_SCENARIOS: BaselineScenario[] = [
  ...BASELINE_SCENARIOS,
  { label: 'chaos/duel/380x620/s19', opts: { mode: 'duel', seed: 19, seconds: 60, knobs: chaos } },
  { label: 'rain0.8/duel/380x620/s8', opts: { mode: 'duel', seed: 8, seconds: 60, knobs: { rain: 0.8 } } },
];

/**
 * The numbers a baseline records for each scenario.
 *
 * Each field is rounded deliberately: the number of places is the tolerance
 * this fingerprint allows, and changing one changes what the gate accepts.
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
export function digest(r: RunResult): Record<string, number> {
  return {
    booms: r.killGroups,
    ballsDestroyed: r.killBalls,
    biggestBoom: r.killBig,
    boomSize: round(r.boomSize, 4),
    p1score: r.players[0].score,
    p2score: r.players[1].score,
    p1locks: r.players[0].locks,
    p2locks: r.players[1].locks,
    p1peels: r.players[0].peels,
    p2peels: r.players[1].peels,
    throws: r.throws,
    blockedThrows: r.blockedThrows,
    ballsAvg: round(r.ballsAvg, 4),
    ballsFinal: r.ballsFinal,
    liveAvg: round(r.liveAvg, 4),
    liveMin: r.liveMin,
    starvedFrac: round(r.starvedFrac, 4),
    chainAvg: round(r.chainAvg, 4),
    chainBest: r.chainBest,
    groupAvg: round(r.groupAvg, 4),
    groupMax: r.groupMax,
    worstOverlap: round(r.worst.overlap, 6),
    worstFrozen: round(r.worst.frozen, 9),
    worstOutside: round(r.worst.outside, 6),
  };
}

function round(v: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(v * f) / f;
}

export interface BaselineEntry {
  label: string;
  metrics: Record<string, number>;
}

export interface BaselineFile {
  /** Bumped when the scenario list or digest shape changes, invalidating old files. */
  version: number;
  created: string;
  scenarios: BaselineEntry[];
}

/**
 * 2: the digest gained the density and chain-depth metrics, and `blockedThrows`
 * became a true per-launcher count rather than a per-frame flag.
 * 3: scenarios for the ladder rungs, continuous fire, a match clock that runs
 * out, the Cascade and Rally presets (Rally plays six colours), and a second
 * match on the same Game; and solo stopped counting player 2's idle deck.
 */
export const BASELINE_VERSION = 3;

export function measureBaseline(scenarios = BASELINE_SCENARIOS): BaselineFile {
  return {
    version: BASELINE_VERSION,
    created: new Date().toISOString(),
    scenarios: scenarios.map(s => ({ label: s.label, metrics: digest(runSim(s.opts)) })),
  };
}

export interface DiffRow {
  label: string;
  metric: string;
  before: number;
  after: number;
  delta: number;
  /** Change as a percentage of `before`, or null when `before` is zero. */
  percent: number | null;
  within: boolean;
}

/**
 * Compare a saved baseline against fresh measurements.
 *
 * `tolerancePercent` of 0 demands exact reproduction, which is the right default:
 * the runs are deterministic, so any movement at all is a real behaviour change
 * worth a human's attention.
 */
export function diffBaseline(saved: BaselineFile, fresh: BaselineFile, tolerancePercent = 0): DiffRow[] {
  const rows: DiffRow[] = [];
  const freshByLabel = new Map(fresh.scenarios.map(s => [s.label, s.metrics]));

  for (const entry of saved.scenarios) {
    const after = freshByLabel.get(entry.label);
    if (!after) {
      rows.push({ label: entry.label, metric: '(scenario missing)', before: 0, after: 0, delta: 0, percent: null, within: false });
      continue;
    }
    for (const [metric, before] of Object.entries(entry.metrics)) {
      const now = after[metric];
      if (now === undefined) {
        rows.push({ label: entry.label, metric: metric + ' (missing)', before, after: 0, delta: -before, percent: null, within: false });
        continue;
      }
      const delta = now - before;
      if (delta === 0) continue;
      const percent = before !== 0 ? (delta / Math.abs(before)) * 100 : null;
      const within = percent !== null ? Math.abs(percent) <= tolerancePercent : false;
      rows.push({ label: entry.label, metric, before, after: now, delta, percent, within });
    }
  }

  for (const s of fresh.scenarios) {
    if (!saved.scenarios.some(e => e.label === s.label)) {
      rows.push({ label: s.label, metric: '(new scenario)', before: 0, after: 0, delta: 0, percent: null, within: true });
    }
  }

  return rows;
}
