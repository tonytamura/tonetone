/**
 * The simulation CLI: `npm run sim -- <command>`.
 *
 * Every command exits non-zero on failure, so an agent or a CI job can gate on
 * it without parsing the output. `--json` prints machine-readable results for
 * anything that needs to be consumed rather than read.
 *
 * See the Simulation Harness page in Notion for the guide.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  EXTRACTORS, LONG_CHAIN, Mode, PolicyName, RunResult, SimOptions,
  extract, extractorNames, runMany, runSim,
  policyProfile,
} from '../src/sim/Harness';
import {
  KNOBS,
  KnobValue,
  PRESETS,
  parseKnobValue,
  presetIds,
  presetKnobs,
  isKnobId,
} from '../src/sim/Knobs';
import { TOLERANCE, violations } from '../src/sim/Metrics';
import { catchUp, compare, estimate } from '../src/sim/Stats';
import { AI_LEVELS, AI_STRATEGIES, levelIndex } from '../src/game/AI';
import { runPhysicsChecks } from '../src/sim/PhysicsChecks';
import {
  BASELINE_VERSION, BaselineFile, INVARIANT_SCENARIOS,
  diffBaseline, measureBaseline,
} from '../src/sim/Baseline';

const BASELINE_PATH = resolve(process.cwd(), 'tests/sim/baseline.json');

// ---------------------------------------------------------------- arg parsing

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Flags that never take a value.
 *
 * `parseArgs` bound the following token to any `--flag` that was not written as
 * `--flag=value`, so `sweep --json boom=0.2,0.4` handed the knob spec to `--json`
 * and then failed with "sweep needs knob=v1,v2,v3". Naming the boolean flags stops
 * them swallowing the next argument, so flag order no longer matters.
 */
const BOOLEAN_FLAGS = new Set(['json']);

/** The options every command that runs a simulation shares. */
const RUN_FLAGS = [
  'mode', 'policy', 'seed', 'seconds', 'width', 'height', 'preset', 'set', 'invariants', 'ai',
] as const;

/**
 * What each command accepts. A flag outside its command's list is a usage error:
 * one generic parser served every command, so a mistyped `--runs` or a `--metrics`
 * on `run` was accepted and then silently ignored, and the run still reported
 * numbers as though the flag had taken effect.
 */
const COMMAND_FLAGS: Record<string, readonly string[]> = {
  run: [...RUN_FLAGS, 'runs', 'json'],
  sweep: [...RUN_FLAGS, 'runs', 'metrics', 'json'],
  compare: [...RUN_FLAGS, 'runs', 'metrics', 'a', 'b', 'json'],
  ladder: [...RUN_FLAGS, 'runs', 'levels', 'reference', 'json'],
  tournament: [...RUN_FLAGS, 'runs', 'strategies', 'json'],
  invariants: ['seconds', 'json'],
  physics: ['json'],
  baseline: ['tolerance', 'json'],
  knobs: ['json'],
  metrics: ['json'],
  help: [],
};

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const name = a.slice(2);
      if (!BOOLEAN_FLAGS.has(name) && rest[i + 1] && !rest[i + 1].startsWith('--')) {
        flags[name] = rest[++i];
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

/** Reject any flag the command does not declare. */
function checkFlags(args: Args): void {
  const allowed = COMMAND_FLAGS[args.command];
  if (!allowed) return;
  for (const name of Object.keys(args.flags)) {
    if (!allowed.includes(name)) {
      const list = allowed.length ? allowed.map(f => '--' + f).join(', ') : '(none)';
      fail(`unknown flag --${name} for "${args.command}". It accepts: ${list}`);
    }
  }
}

function num(flags: Args['flags'], key: string, fallback: number): number {
  const v = flags[key];
  if (v === undefined) return fallback;
  const n = parseFloat(String(v));
  if (!isFinite(n)) fail(`--${key} needs a number, got "${v}"`);
  return n;
}

function fail(message: string): never {
  console.error('error: ' + message);
  process.exit(2);
}

/** Parse `--set boom=0.6,roll=0.3` into knob values, validated against ranges. */
function parseSet(spec: string | boolean | undefined): Record<string, KnobValue> {
  if (!spec || spec === true) return {};
  const out: Record<string, KnobValue> = {};
  for (const part of String(spec).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) fail(`--set expects knob=value pairs, got "${trimmed}"`);
    const id = trimmed.slice(0, eq).trim();
    try {
      out[id] = parseKnobValue(id, trimmed.slice(eq + 1).trim());
    } catch (e) {
      fail((e as Error).message);
    }
  }
  return out;
}

function parsePreset(spec: string | boolean | undefined): Record<string, KnobValue> {
  if (!spec || spec === true) return {};
  const id = String(spec).trim();
  if (!PRESETS[id]) fail(`Unknown preset "${id}". Known presets: ${presetIds().join(', ')}`);

  // Everything the preset declares except its match length. A harness run is
  // endless unless `match` is asked for, and handing the clock over here would
  // quietly truncate any run longer than the preset's match: the frames after
  // the clock expires are a frozen field, and they would dilute every per-minute
  // figure measured over them. `--set match=180` is still there for anyone who
  // wants the clock as well.
  const { match: _match, ...rest } = presetKnobs(id);
  return rest;
}

function simOptionsFrom(args: Args): SimOptions {
  const mode = String(args.flags.mode ?? 'solo') as Mode;
  if (!['solo', 'duel', 'ai', 'idle'].includes(mode)) fail(`--mode must be solo, duel, ai or idle`);
  const policy = String(args.flags.policy ?? 'engine-ai') as PolicyName;
  if (!['engine-ai', 'fixed', 'random', 'sweep'].includes(policy) && !policyProfile(policy)) {
    fail(`--policy must be engine-ai, fixed, random, sweep, a rung (${AI_LEVELS.map(l => l.id).join(', ')}) or a strategy (${Object.keys(AI_STRATEGIES).join(', ')})`);
  }
  const aiFlag = args.flags.ai;
  const aiLevel = aiFlag === undefined ? undefined : levelIndex(String(aiFlag));
  if (aiLevel !== undefined && aiLevel < 0) fail(`--ai must be one of ${AI_LEVELS.map(l => l.id).join(', ')}`);
  return {
    mode,
    seed: num(args.flags, 'seed', 1),
    seconds: num(args.flags, 'seconds', 60),
    width: num(args.flags, 'width', 380),
    height: num(args.flags, 'height', 620),
    // A preset is the same declaration the tuning panel reads, so `--preset relax`
    // measures the game a player picking Relax gets. `--set` wins over it, which
    // is what makes "this preset, but with one knob moved" expressible.
    knobs: { ...parsePreset(args.flags.preset), ...parseSet(args.flags.set) },
    policies: [policy, policy],
    aiLevel,
    invariants: args.flags.invariants !== 'false',
  };
}

// ------------------------------------------------------------------- printing

function table(headers: string[], rows: (string | number)[][]): void {
  const cells = [headers, ...rows.map(r => r.map(String))];
  const widths = headers.map((_, i) => Math.max(...cells.map(r => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(line(headers));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of cells.slice(1)) console.log(line(r));
}

function fixed(v: number, places = 2): string {
  return Number.isFinite(v) ? v.toFixed(places) : String(v);
}

/** A 0..1 share as a percentage, for the rate metrics. */
function pct(v: number, places = 1): string {
  return fixed(v * 100, places) + '%';
}

/**
 * One estimate as `mean ± standard error`. Written out at four call sites before,
 * which is how `compare` and `sweep` came to print it three slightly different ways.
 */
function estimateText(mean: number, stderr: number, signed = false): string {
  const sign = signed && mean >= 0 ? '+' : '';
  return `${sign}${fixed(mean)} ±${fixed(stderr)}`;
}

function invariantLine(r: RunResult): string {
  const bad = violations(r.worst);
  const detail = `overlap ${fixed(r.worst.overlap, 4)}px, frozen ${r.worst.frozen.toExponential(1)}px, outside ${fixed(r.worst.outside, 4)}px`;
  return bad.length ? `FAIL at t=${fixed(r.worstAt)}s — ${bad.join('; ')}` : `ok (${detail})`;
}

// ------------------------------------------------------------------- commands

function cmdRun(args: Args): number {
  const opts = simOptionsFrom(args);
  const runs = Math.max(1, num(args.flags, 'runs', 1));
  const results = runs === 1 ? [runSim(opts)] : runMany(opts, runs, opts.seed);

  if (args.flags.json) {
    console.log(JSON.stringify(runs === 1 ? results[0] : results, (k, v) => (k === 'samples' ? undefined : v), 2));
    return results.every(r => violations(r.worst).length === 0) ? 0 : 1;
  }

  for (const r of results) {
    console.log(`\n${r.mode} ${r.width}x${r.height} seed=${r.seed} ${fixed(r.seconds, 1)}s (${r.frames} frames)`);
    const overrides = Object.entries(opts.knobs || {});
    if (overrides.length) console.log('knobs: ' + overrides.map(([k, v]) => `${k}=${v}`).join(' '));

    // A report for a person, not a metric map: per-player columns, and rows
    // that combine several fields. See the note on EXTRACTORS in
    // src/sim/Harness.ts for why this is not folded into it.
    table(
      ['metric', 'p1', 'p2', 'total'],
      [
        ['score', r.players[0].score, r.players[1].score, r.players[0].score + r.players[1].score],
        ['locks', r.players[0].locks, r.players[1].locks, r.players[0].locks + r.players[1].locks],
        ['booms', r.players[0].booms, r.players[1].booms, r.players[0].booms + r.players[1].booms],
        ['peels', r.players[0].peels, r.players[1].peels, r.players[0].peels + r.players[1].peels],
        ['best group', r.players[0].best, r.players[1].best, Math.max(r.players[0].best, r.players[1].best)],
      ]
    );
    console.log('');
    table(
      ['field', 'value'],
      [
        ['booms', r.killGroups],
        ['balls destroyed', r.killBalls],
        ['mean boom size', fixed(r.boomSize)],
        ['booms per minute', fixed(r.boomsPerMinute)],
        ['biggest boom', r.killBig],
        ['balls (avg / max / final)', `${fixed(r.ballsAvg, 1)} / ${r.ballsMax} / ${r.ballsFinal}`],
        ['live balls (avg / min)', `${fixed(r.liveAvg, 1)} / ${r.liveMin}`],
        ['starved (below rain line)', pct(r.starvedFrac)],
        ['largest group (avg / max)', `${fixed(r.groupAvg, 2)} / ${r.groupMax}`],
        ['chain depth (avg / best)', `${fixed(r.chainAvg, 2)} / ${r.chainBest}`],
        [`long chains (>=${LONG_CHAIN} events)`, pct(r.chainLongFrac)],
        ['throws (fired / blocked)', `${r.throws} / ${r.blockedThrows} (${pct(r.blockedFrac)})`],
        ...(r.mode === 'duel' || r.mode === 'ai'
          ? [
              ['lead changes', String(r.leadChanges)],
              ['catch-up', fixed(catchUp(r.halfTimeScores, r.finalScores), 1)],
            ] as (string | number)[][]
          : []),
        ['invariants', invariantLine(r)],
      ]
    );
    if (r.boomSize > 0 && r.boomSize < 3) {
      console.log(`\nnote: mean boom size is ${fixed(r.boomSize)} — booms are frequent but trivial.`);
      console.log('      Watch this next to booms-per-minute; the rate alone hides it.');
    }
  }

  return results.every(r => violations(r.worst).length === 0) ? 0 : 1;
}

function cmdSweep(args: Args): number {
  const spec = args.positional[0];
  if (!spec || !spec.includes('=')) {
    fail('sweep needs knob=v1,v2,v3 — for example: sweep boom=0.2,0.4,0.6');
  }
  const id = spec.slice(0, spec.indexOf('='));
  if (!isKnobId(id)) fail(`Unknown knob "${id}". Try: npm run sim -- knobs`);
  // `parseSet` catches this and `cmdSweep` did not, so an out-of-range sweep value
  // exited 1 with a stack trace where the same value via `--set` exited 2 with a
  // one-line usage error.
  const values = spec.slice(spec.indexOf('=') + 1).split(',').map(v => {
    try {
      return parseKnobValue(id, v.trim());
    } catch (e) {
      return fail((e as Error).message);
    }
  });

  // Floored at 2, as `compare` is: a single run has no standard error to report,
  // and printing "±0.00" under a header about 2x the error invites exactly the
  // overreading the whole harness exists to prevent.
  const runs = Math.max(2, num(args.flags, 'runs', 5));
  const metricNames = String(args.flags.metrics ?? 'booms,boomSize,score,ballsAvg,groupMax')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const m of metricNames) if (!EXTRACTORS[m]) fail(`Unknown metric "${m}". Known: ${extractorNames().join(', ')}`);

  const base = simOptionsFrom(args);
  const rows: (string | number)[][] = [];
  const json: any[] = [];
  let ok = true;

  for (const v of values) {
    const results = runMany({ ...base, knobs: { ...(base.knobs || {}), [id]: v } }, runs, base.seed);
    const row: (string | number)[] = [`${id}=${v}`];
    const entry: any = { knob: id, value: v, runs, metrics: {} };

    for (const m of metricNames) {
      const est = estimate(results.map(extract(m)));
      row.push(estimateText(est.mean, est.stderr));
      entry.metrics[m] = { mean: est.mean, stderr: est.stderr, n: est.n };
    }
    const bad = results.filter(r => violations(r.worst).length);
    row.push(bad.length ? `${bad.length}/${runs} FAIL` : 'ok');
    if (bad.length) ok = false;
    entry.invariantFailures = bad.length;

    rows.push(row);
    json.push(entry);
  }

  if (args.flags.json) {
    console.log(JSON.stringify(json, null, 2));
    return ok ? 0 : 1;
  }

  console.log(`\nsweep ${id} — ${runs} runs per value, ${base.seconds}s each, mode=${base.mode}`);
  console.log('values are mean ± standard error; differences smaller than 2x the error are noise\n');
  table(['knob', ...metricNames, 'invariants'], rows);
  return ok ? 0 : 1;
}

function cmdCompare(args: Args): number {
  const a = parseSet(args.flags.a);
  const b = parseSet(args.flags.b);
  if (!Object.keys(a).length && !Object.keys(b).length) {
    fail('compare needs --a "knob=value" and --b "knob=value"');
  }
  const runs = Math.max(2, num(args.flags, 'runs', 20));
  const base = simOptionsFrom(args);
  const metricNames = String(args.flags.metrics ?? 'booms,boomSize,score,groupMax')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const m of metricNames) if (!EXTRACTORS[m]) fail(`Unknown metric "${m}". Known: ${extractorNames().join(', ')}`);

  const ra = runMany({ ...base, knobs: { ...(base.knobs || {}), ...a } }, runs, base.seed);
  const rb = runMany({ ...base, knobs: { ...(base.knobs || {}), ...b } }, runs, base.seed);

  const rows: (string | number)[][] = [];
  const json: any = { a, b, runs, metrics: {} };

  for (const m of metricNames) {
    // The same seeds on both sides: paired.
    const c = compare(ra.map(extract(m)), rb.map(extract(m)), true);
    rows.push([
      m,
      estimateText(c.a.mean, c.a.stderr),
      estimateText(c.b.mean, c.b.stderr),
      estimateText(c.delta, c.stderr, true),
      c.verdict,
    ]);
    json.metrics[m] = c;
  }

  // Paired catch-up statistic: only meaningful when both launchers are playing.
  if (base.mode === 'duel' || base.mode === 'ai') {
    const gains = (rs: RunResult[]) => rs.map(r => catchUp(r.halfTimeScores, r.finalScores));
    const c = compare(gains(ra), gains(rb), true);
    const ea = estimate(gains(ra)), eb = estimate(gains(rb));
    json.catchUp = { a: ea, b: eb, comparison: c };
    rows.push([
      'catch-up (paired)',
      estimateText(ea.mean, ea.stderr),
      `${fixed(eb.mean)} ±${fixed(eb.stderr)}`,
      `${c.delta >= 0 ? '+' : ''}${fixed(c.delta)} ±${fixed(c.stderr)}`,
      c.verdict,
    ]);
  }

  if (args.flags.json) {
    console.log(JSON.stringify(json, null, 2));
    return 0;
  }

  const label = (o: Record<string, KnobValue>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ') || 'defaults';
  console.log(`\ncompare — ${runs} runs each, ${base.seconds}s, mode=${base.mode}`);
  console.log(`  A: ${label(a)}`);
  console.log(`  B: ${label(b)}`);
  console.log('\n"inside the noise" means the difference is smaller than 2x its standard error.');
  console.log('Do not report such a difference as an effect.\n');
  table(['metric', 'A', 'B', 'B - A', 'verdict'], rows);
  if (base.mode === 'duel' || base.mode === 'ai') {
    console.log('\ncatch-up measures each match against itself: ground the half-time trailer');
    console.log('recovered by the end. Positive is rubber banding, negative is snowballing.');
  }
  return 0;
}

/**
 * Seat each rung of the AI ladder against the one below it, in both seats, and
 * say whether the higher one wins more than the noise allows.
 *
 * A match is a real one: the preset's clock (2:00 unless --set match= says
 * otherwise) with specials on, as players get them. A win counts 1, a draw 0.5.
 * The verdict is on the win rate minus 50%, and needs 2x its standard error.
 * `--reference engine-ai` adds each rung's win rate against that fixed opponent,
 * the one curve the whole ladder can be read from.
 */
function cmdLadder(args: Args): number {
  const runs = Math.max(2, num(args.flags, 'runs', 20));
  const base = simOptionsFrom(args);
  const match = Number((base.knobs && base.knobs.match) ?? presetKnobs(String(args.flags.preset ?? 'normal')).match ?? 120);
  const common: SimOptions = {
    ...base, mode: 'duel', seconds: match + 1, invariants: false,
    knobs: { ...(base.knobs || {}), match },
  };
  const ids = args.flags.levels ? String(args.flags.levels).split(',') : AI_LEVELS.map(l => l.id);
  for (const id of ids) if (!policyProfile(id)) fail(`unknown level or strategy "${id}"`);
  const reference = args.flags.reference ? String(args.flags.reference) : null;
  if (reference && !policyProfile(reference)) fail(`unknown reference "${reference}"`);

  /** hi against lo, `runs` seeds in each seat: hi's results. */
  function seat(hi: string, lo: string) {
    const outcome: number[] = [], margin: number[] = [];
    for (let i = 0; i < runs; i++) {
      for (const hiFirst of [true, false]) {
        const r = runSim({ ...common, seed: base.seed! + i, policies: hiFirst ? [hi, lo] : [lo, hi] });
        const mine = r.finalScores[hiFirst ? 0 : 1], theirs = r.finalScores[hiFirst ? 1 : 0];
        outcome.push(mine > theirs ? 1 : mine < theirs ? 0 : 0.5);
        margin.push(mine - theirs);
      }
    }
    const w = estimate(outcome.map(x => x - 0.5));
    return {
      winRate: w.mean + 0.5, stderr: w.stderr, verdict: w.verdict === 'higher' ? 'beats' : w.verdict === 'lower' ? 'LOSES' : 'inside the noise',
      draws: outcome.filter(x => x === 0.5).length, margin: estimate(margin),
    };
  }

  const rows: (string | number)[][] = [];
  const json: any = { runs, match, preset: args.flags.preset ?? 'normal', steps: [], reference: {} };
  for (let i = 1; i < ids.length; i++) {
    const st = seat(ids[i], ids[i - 1]);
    json.steps.push({ hi: ids[i], lo: ids[i - 1], ...st });
    rows.push([`${ids[i]} v ${ids[i - 1]}`, `${fixed(st.winRate * 100, 0)}% \u00b1${fixed(st.stderr * 100, 0)}`, st.draws,
      `${st.margin.mean >= 0 ? '+' : ''}${fixed(st.margin.mean, 0)} \u00b1${fixed(st.margin.stderr, 0)}`, st.verdict]);
  }
  const refRows: (string | number)[][] = [];
  if (reference) {
    for (const id of ids) {
      if (id === reference) continue;
      const st = seat(id, reference);
      json.reference[id] = st;
      refRows.push([`${id} v ${reference}`, `${fixed(st.winRate * 100, 0)}% \u00b1${fixed(st.stderr * 100, 0)}`, st.draws,
        `${st.margin.mean >= 0 ? '+' : ''}${fixed(st.margin.mean, 0)} \u00b1${fixed(st.margin.stderr, 0)}`, st.verdict]);
    }
  }
  if (args.flags.json) { console.log(JSON.stringify(json, null, 2)); return 0; }
  console.log(`\nladder \u2014 ${runs} seeds x 2 seats per pairing, ${match}s matches, preset ${json.preset}`);
  console.log('A step counts only when the win rate clears 50% by 2x its standard error.\n');
  table(['pairing', 'win rate', 'draws', 'score margin', 'verdict'], rows);
  if (refRows.length) { console.log(''); table(['against the reference', 'win rate', 'draws', 'score margin', 'verdict'], refRows); }
  return 0;
}

/**
 * Every strategy against every other, in both seats, and the longest chain in
 * which each beats the one before head to head by 2 standard errors: the test a
 * ladder of AIs has to pass.
 */
function cmdTournament(args: Args): number {
  const runs = Math.max(2, num(args.flags, 'runs', 20));
  const base = simOptionsFrom(args);
  const match = Number((base.knobs && base.knobs.match) ?? presetKnobs(String(args.flags.preset ?? 'normal')).match ?? 120);
  const common: SimOptions = { ...base, mode: 'duel', seconds: match + 1, invariants: false, knobs: { ...(base.knobs || {}), match } };
  const ids = args.flags.strategies ? String(args.flags.strategies).split(',') : Object.keys(AI_STRATEGIES);
  for (const id of ids) if (!policyProfile(id)) fail(`unknown strategy "${id}"`);

  type Cell = { win: number; stderr: number; margin: number };
  const W: Record<string, Record<string, Cell>> = {};
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    const out: number[] = [], margin: number[] = [];
    for (let k = 0; k < runs; k++) for (const aFirst of [true, false]) {
      const r = runSim({ ...common, seed: base.seed! + k, policies: aFirst ? [a, b] : [b, a] });
      const mine = r.finalScores[aFirst ? 0 : 1], theirs = r.finalScores[aFirst ? 1 : 0];
      out.push(mine > theirs ? 1 : mine < theirs ? 0 : 0.5);
      margin.push(mine - theirs);
    }
    const w = estimate(out), m = estimate(margin);
    (W[a] ||= {})[b] = { win: w.mean, stderr: w.stderr, margin: m.mean };
    (W[b] ||= {})[a] = { win: 1 - w.mean, stderr: w.stderr, margin: -m.mean };
  }
  const avg = (s: string) => ids.filter(t => t !== s).reduce((acc, t) => acc + W[s][t].win, 0) / (ids.length - 1);
  const order = [...ids].sort((x, y) => avg(x) - avg(y));
  const beats = (x: string, y: string) => W[x][y].win - 0.5 > 2 * W[x][y].stderr;
  let chain: string[] = [];
  const grow = (c: string[]) => {
    if (c.length > chain.length) chain = [...c];
    for (const s of order) if (!c.includes(s) && beats(s, c[c.length - 1])) grow([...c, s]);
  };
  for (const s of order) grow([s]);

  if (args.flags.json) { console.log(JSON.stringify({ runs, match, order, matrix: W, chain }, null, 2)); return 0; }
  console.log(`\ntournament \u2014 ${runs} seeds x 2 seats per pairing, ${match}s matches, preset ${args.flags.preset ?? 'normal'}`);
  console.log('Row beats column, win % \u00b1 SE; + or - where it clears 2 SE.\n');
  const cell = (x: string, y: string) => {
    const c = W[x][y];
    const sig = Math.abs(c.win - 0.5) > 2 * c.stderr ? (c.win > 0.5 ? '+' : '-') : ' ';
    return `${fixed(c.win * 100, 0)}${sig}\u00b1${fixed(c.stderr * 100, 0)}`;
  };
  table(['', ...order, 'average'], order.map(x => [x, ...order.map(y => (x === y ? '\u2014' : cell(x, y))), `${fixed(avg(x) * 100, 0)}%`]));
  console.log(`\nLongest chain, each beating the one before by 2 SE head to head:\n  ${chain.join(' < ')}`);
  return 0;
}

function cmdInvariants(args: Args): number {
  const seconds = num(args.flags, 'seconds', 60);
  const rows: (string | number)[][] = [];
  let ok = true;

  for (const s of INVARIANT_SCENARIOS) {
    const r = runSim({ ...s.opts, seconds });
    const bad = violations(r.worst);
    if (bad.length) ok = false;
    rows.push([
      s.label,
      fixed(r.worst.overlap, 4),
      r.worst.frozen.toExponential(1),
      fixed(r.worst.outside, 4),
      bad.length ? 'FAIL: ' + bad.join('; ') : 'ok',
    ]);
  }

  if (args.flags.json) {
    console.log(JSON.stringify({ ok, tolerance: TOLERANCE, rows }, null, 2));
    return ok ? 0 : 1;
  }

  console.log(`\ninvariants — every frame of every scenario, ${seconds}s each`);
  console.log(`tolerance: overlap <= ${TOLERANCE.overlap}px, frozen == 0, outside <= ${TOLERANCE.outside}px\n`);
  table(['scenario', 'overlap', 'frozen', 'outside', 'verdict'], rows);
  console.log(ok ? '\nall scenarios within tolerance' : '\nINVARIANTS VIOLATED');
  return ok ? 0 : 1;
}

function cmdPhysics(args: Args): number {
  const checks = runPhysicsChecks();
  const ok = checks.every(c => c.pass);

  if (args.flags.json) {
    console.log(JSON.stringify({ ok, checks }, null, 2));
    return ok ? 0 : 1;
  }

  console.log('\nphysics — textbook results for an impulse solver at restitution 1\n');
  table(
    ['check', 'measured', 'expected', 'tol', 'unit', ''],
    checks.map(c => [
      c.name,
      c.measured.toPrecision(6),
      String(c.expected),
      String(c.tolerance),
      c.unit,
      c.pass ? 'ok' : 'FAIL',
    ])
  );
  console.log(ok ? '\nall physics checks pass' : '\nPHYSICS CHECKS FAILED');
  return ok ? 0 : 1;
}

function cmdBaseline(args: Args): number {
  const action = args.positional[0] ?? 'check';
  if (action === 'save') {
    const file = measureBaseline();
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(file, null, 2) + '\n');
    console.log(`saved ${file.scenarios.length} scenarios to ${BASELINE_PATH}`);
    console.log('Commit this file alongside the change that justifies it.');
    return 0;
  }

  if (action !== 'check') fail('baseline takes "save" or "check"');
  if (!existsSync(BASELINE_PATH)) {
    console.error(`no baseline at ${BASELINE_PATH} — create one with: npm run sim -- baseline save`);
    return 2;
  }

  const saved: BaselineFile = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (saved.version !== BASELINE_VERSION) {
    console.error(`baseline is version ${saved.version}, this build expects ${BASELINE_VERSION} — re-save it`);
    return 2;
  }

  const tolerance = num(args.flags, 'tolerance', 0);
  const fresh = measureBaseline();
  const rows = diffBaseline(saved, fresh, tolerance);
  const breaking = rows.filter(r => !r.within);

  if (args.flags.json) {
    console.log(JSON.stringify({ ok: breaking.length === 0, tolerance, rows }, null, 2));
    return breaking.length ? 1 : 0;
  }

  if (!rows.length) {
    console.log(`\nbaseline matches exactly across ${saved.scenarios.length} scenarios.`);
    console.log('The change did not alter simulation behaviour.');
    return 0;
  }

  console.log(`\nbaseline differs — ${rows.length} metric(s) moved (tolerance ${tolerance}%)\n`);
  table(
    ['scenario', 'metric', 'before', 'after', 'delta', '%'],
    rows.map(r => [
      r.label, r.metric, r.before, r.after,
      `${r.delta >= 0 ? '+' : ''}${fixed(r.delta, 4)}`,
      r.percent === null ? '—' : `${r.percent >= 0 ? '+' : ''}${fixed(r.percent, 1)}%`,
    ])
  );
  console.log('\nIf these changes are what you intended, re-save the baseline:');
  console.log('  npm run sim -- baseline save');
  console.log('If any of them are a surprise, that is the bug.');
  return breaking.length ? 1 : 0;
}

function cmdKnobs(args: Args): number {
  if (args.flags.json) {
    console.log(JSON.stringify(
      Object.values(KNOBS).map(k => ({
        id: k.id, group: k.group, kind: k.kind,
        min: k.kind === 'range' ? k.min : undefined,
        max: k.kind === 'range' ? k.max : undefined,
        step: k.kind === 'range' ? k.step : undefined,
        default: k.default,
        options: k.kind === 'select' ? k.options : undefined,
        cosmetic: !!k.cosmetic,
      })), null, 2));
    return 0;
  }
  console.log('\nknobs — usable as --set id=value, or as a sweep target\n');
  table(
    ['id', 'group', 'range', 'default', 'affects sim'],
    Object.values(KNOBS).map(k => [
      k.id,
      k.group,
      k.kind === 'select' ? (k.options || []).join('|') : `${k.min} .. ${k.max} step ${k.step}`,
      String(k.default),
      k.cosmetic ? 'no' : 'yes',
    ])
  );
  return 0;
}

function cmdMetrics(args: Args): number {
  if (args.flags.json) {
    console.log(JSON.stringify(extractorNames(), null, 2));
    return 0;
  }
  console.log('\nmetrics — usable as --metrics a,b,c on sweep and compare\n');
  for (const name of extractorNames()) console.log('  ' + name);
  return 0;
}

function cmdHelp(): number {
  console.log(`
tone-boom simulation harness

  npm run sim -- <command> [options]

Commands
  run                      Run one configuration and report on it
  sweep <knob>=<v,v,v>     Run a knob across values, with error bars
  compare --a <k=v> --b    Compare two configurations on paired statistics
  ladder                   Seat each AI level against the one below it
  tournament               Every AI strategy against every other
  invariants               Assert the geometric invariants on every frame
  physics                  Assert textbook results for the collision solver
  baseline save|check      Record or verify exact simulation behaviour
  knobs                    List every tunable knob, its range and default
  metrics                  List the metrics sweep and compare can report

Common options
  --mode solo|duel|ai|idle   Who is playing (default solo; idle throws nothing)
  --seed <n>                 Seed (default 1). Runs are exactly reproducible.
  --seconds <n>              Simulated seconds (default 60)
  --width / --height <px>    Field size (default 380x620)
  --preset normal|relax|chaos  Start from a declared preset, minus its match
                             clock (default: normal). See --set to add it back.
  --set a=1,b=2              Knob overrides, applied on top of --preset
  --runs <n>                 Repeats, for sweep and compare
  --metrics a,b,c            Which metrics to report
  --policy engine-ai|fixed|random|sweep|<rung>|<strategy>
                             rungs ai1, ai2, ai3, agi; strategies random,
                             careless, current, hard, nearest, value,
                             valueSoft, planner, agi
  --ai ai1|ai2|ai3|agi       ai mode: which rung plays player 2
  --strategies a,b,c         tournament: which strategies (default all)
  --levels a,b,c             ladder: which levels, in order (default all)
  --reference <level>        ladder: also seat every level against this one
  --json                     Machine-readable output
  --tolerance <pct>          baseline check: allowed drift (default 0, exact)

Examples
  npm run sim -- run --mode ai --seconds 120
  npm run sim -- sweep boom=0.2,0.4,0.6,0.8 --runs 10
  npm run sim -- compare --a kickout=0.5 --b kickout=1.0 --runs 30 --mode duel
  npm run sim -- run --preset chaos --mode duel --seconds 120
  npm run sim -- baseline check

Exit codes: 0 pass, 1 measurement failed, 2 usage error.
`);
  return 0;
}

// ----------------------------------------------------------------------- main

const args = parseArgs(process.argv.slice(2));
const commands: Record<string, (a: Args) => number> = {
  run: cmdRun,
  sweep: cmdSweep,
  compare: cmdCompare,
  ladder: cmdLadder,
  tournament: cmdTournament,
  invariants: cmdInvariants,
  physics: cmdPhysics,
  baseline: cmdBaseline,
  knobs: cmdKnobs,
  metrics: cmdMetrics,
  help: cmdHelp,
};

const handler = commands[args.command];
if (!handler) {
  console.error(`unknown command "${args.command}"`);
  cmdHelp();
  process.exit(2);
}
checkFlags(args);
process.exit(handler(args));
