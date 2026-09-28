import { Ball, Group, LauncherPlayer } from '../physics/Types';
import { aimAt, launchPointOf, launchSpeedOf } from '../physics/LauncherBays';
import { PhysicsConfig } from '../physics/Config';
import { boomPay, lockPay, peelPay } from './Rules';
import type { Game } from './GameState';
import { Candidate, PlanJob } from './AIPlanner';

export function aiAim(p: LauncherPlayer, groups: Group[], balls: Ball[], width: number, height: number, twoPlayer: boolean) {
  let best: Group | null = null, most = 0;
  for (const g of groups) {
    if (!g.members.length || g.members[0].ghost) continue;
    if (g.members.length > most) { most = g.members.length; best = g; }
  }

  const tempP = { ...p };

  if (best && most >= 2) {
    // NOTE: `rebuildGroups` mints new Group objects on every bond, boom, peel
    // and spawn, so this identity check rarely holds and `_targetStrength` is
    // re-rolled far more often than "once per target" suggests. Keying on
    // something stable (the lowest member id) makes it behave as written, but
    // that is a balance change, not a cleanup: it moved 119 baseline metrics,
    // in no consistent direction. Decide the feel first, then re-save.
    if ((p as any)._targetGroup !== best) {
      (p as any)._targetGroup = best;
      (p as any)._targetStrength = 0.35 + Math.random() * 0.65;
    }
    aimAt(tempP, best.com.x, best.com.y, width, height, twoPlayer);
    tempP.strength = (p as any)._targetStrength;
    p._idleDeg = undefined;
  } else {
    const m = launchPointOf(p, width, height);
    let near: Ball | null = null, gap = Infinity;
    for (const b of balls) {
      if (b.ghost) continue;
      const d = Math.hypot(b.x - m.x, b.y - m.y);
      if (d < gap) { gap = d; near = b; }
    }
    if (near) {
      if ((p as any)._targetGroup !== near) {
        (p as any)._targetGroup = near;
        (p as any)._targetStrength = 0.35 + Math.random() * 0.65;
      }
      aimAt(tempP, near.x, near.y, width, height, twoPlayer);
      tempP.strength = (p as any)._targetStrength;
      p._idleDeg = undefined;
    } else {
      (p as any)._targetGroup = null;
      // Empty court: select a single idle angle per empty state instead of randomizing every frame
      if (p._idleDeg === undefined) {
        p._idleDeg = Math.random() * 40 - 20;
      }
      tempP.aimDeg = p._idleDeg;
      tempP.strength = 0.7;
    }
  }

  // Smoothly interpolate aim angle and power so the AI arrow rotates fluidly
  p.aimDeg += (tempP.aimDeg - p.aimDeg) * 0.15;
  p.strength += (tempP.strength - p.strength) * 0.15;
}

// ---------------------------------------------------------------- the ladder

/**
 * One rung of the AI ladder: how well an AI plays, as data.
 *
 * Every level plays the same game with the same launcher, reload and power: a
 * harder AI chooses and aims better, it never gets a rule the player lacks.
 * Adding a level is adding a row here. Design and measurements: the AI ladder
 * task in Notion.
 */
export interface AiProfile {
  id: string;
  label: string;
  /**
   * Play exactly as the AI shipped before the ladder did (`aiAim` above): the
   * biggest group, a random strength, no line check. The baseline's `ai`
   * scenarios run this rung, so the ladder cannot move them.
   */
  classic?: boolean;
  /** `biggest`: the largest group, any colour. `value`: what the loaded ball would score on it. */
  target: 'biggest' | 'value';
  /**
   * `random`: 0.35-1.0 per target. `intent`: soft to lock, hard enough to
   * arrive booming. `max`: as hard as the bay throws, every time.
   */
  power: 'random' | 'intent' | 'max';
  /** Where on the target to aim: its centre, or the ball the throw meets first. */
  aimPoint?: 'com' | 'nearest';
  /** For `intent`, the speed a lock should arrive at, as a share of the boom speed. */
  lockArrive?: number;
  /** Skip targets with a ball in the way. */
  clearLine: boolean;
  /** Standard deviation of the aim error, in degrees, drawn once per target. */
  aimErrorDeg: number;
  /** Standard deviation of the strength error, drawn once per target. */
  powerError: number;
  /** Share of the way to the wanted aim turned each frame: how fast it settles. */
  turn: number;
  /** Chance, per target, of a careless throw: any angle, any strength. */
  wild?: number;
  /** How much above the boom speed an intended boom should arrive. */
  boomMargin: number;
  /**
   * Think before throwing: once the ring is `window` seconds from full, take
   * the table as it will be at the throw and try candidate throws on copies of
   * it (`AIPlanner`), each followed `seconds` ahead; aim the best found by the
   * time it throws.
   */
  plan?: { window: number; seconds: number; strengths: number[]; grid: number; targets: number; rollouts?: number };
}

const CLASSIC: Omit<AiProfile, 'id' | 'label'> = {
  target: 'biggest', power: 'random', clearLine: false, aimErrorDeg: 0, powerError: 0, turn: 0.15, boomMargin: 1,
};

/**
 * The ladder, weakest first. The tenth rung is AGI.
 *
 * Measured, not assumed (the AI ladder task in Notion has every figure). In
 * this game aim precision and rule-of-thumb shot choice hardly move a result:
 * an AI with 14 degrees of aim error played the pre-ladder AI to 53% ±8, and
 * ones that picked targets by the pay table and threw softly to lock lost to
 * it (25-31%). What does move it is how many throws are careless, at the
 * bottom, and simulating throws before choosing one, at the top.
 *
 * Win rates against AI5, the pre-ladder AI, 30-60 matches each, both seats:
 * AI1 10% ±6, AI2 17% ±5, AI3 22% ±5, AI4 37% ±6, AI6 67% ±9, AI7 80% ±7,
 * AI8 57% ±9, AI9 70% ±9, AGI 80% ±7. The bottom five are in order. Above AI5
 * every planner beats it, but the planners cannot be told apart from each other
 * inside the noise, except AGI, whose score margin (+229 ±47) is the largest by
 * far. They are ordered by how much each thinks.
 */
const WILD: Omit<AiProfile, 'id' | 'label' | 'wild'> = { ...CLASSIC };
const PLAN = (targets: number, grid: number, seconds: number, rollouts = 1): Omit<AiProfile, 'id' | 'label'> => ({
  ...CLASSIC, turn: 0.35, plan: { window: 2, seconds, strengths: [1], grid, targets, rollouts },
});

export const AI_LEVELS: AiProfile[] = [
  { id: 'ai1', label: 'AI1', ...WILD, wild: 1 },
  { id: 'ai2', label: 'AI2', ...WILD, wild: 0.85 },
  { id: 'ai3', label: 'AI3', ...WILD, wild: 0.6 },
  { id: 'ai4', label: 'AI4', ...WILD, wild: 0.3 },
  { id: 'ai5', label: 'AI5', ...CLASSIC, classic: true },
  { id: 'ai6', label: 'AI6', ...PLAN(4, 0, 1.2) },
  { id: 'ai7', label: 'AI7', ...PLAN(6, 5, 1.2) },
  { id: 'ai8', label: 'AI8', ...PLAN(6, 5, 1.2, 3) },
  { id: 'ai9', label: 'AI9', ...PLAN(6, 9, 1.5) },
  { id: 'agi', label: 'AGI', ...PLAN(6, 9, 1.5, 3) },
];

/** The rung that plays as the pre-ladder AI did. */
export const CLASSIC_LEVEL = AI_LEVELS.findIndex(l => l.classic);

export function levelIndex(id: string): number {
  return AI_LEVELS.findIndex(l => l.id === id);
}

/** Win: one rung up. Loss: one down. Draw: stay. The ends hold. */
export function ladderStep(level: number, mine: number, theirs: number): number {
  const top = AI_LEVELS.length - 1;
  if (mine > theirs) return Math.min(top, level + 1);
  if (mine < theirs) return Math.max(0, level - 1);
  return level;
}

interface AiState {
  key: number;
  errDeg: number;
  errPow: number;
  idleDeg?: number;
  /** A planning AI's decision for the coming throw, and the job making it. */
  planned?: Candidate;
  job?: PlanJob;
  /** This target's careless angle, when the throw is a wild one. */
  wildDeg?: number;
}

function stateOf(p: LauncherPlayer): AiState {
  const any = p as any;
  if (!any._ai) any._ai = { key: -1, errDeg: 0, errPow: 0 } as AiState;
  return any._ai;
}

/** A standard normal draw, from the (seeded, in the harness) `Math.random`. */
function gauss(): number {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * The strength that launches a ball at `speed`: `launchSpeedOf` solved for
 * strength. Clamped to what the bay can do.
 */
export function strengthForSpeed(speed: number): number {
  const c = PhysicsConfig;
  const base = speed / (c.DUEL_POWER * c.SC * c.KICK);
  const t = (base - c.THROW_MIN) / (c.THROW_MAX - c.THROW_MIN);
  return Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1 / c.POWER_CURVE)));
}

/**
 * The launch speed that still has `arrive` px/s left after `distance` px.
 * Drag keeps DRAG of the speed each second, so dv/dx = ln(DRAG): a ball loses
 * the same speed for every pixel it rolls, whatever its speed.
 */
export function launchSpeedToArrive(arrive: number, distance: number): number {
  return arrive - Math.log(PhysicsConfig.DRAG) * distance;
}

interface Choice { key: number; x: number; y: number; strength: number; value: number }

/**
 * What the loaded ball would score on group `g` if it hit the ball `at`, and
 * how hard to throw it: a lock wants to arrive softly, a boom hard enough.
 * Value is the pay table's own figure, discounted by distance, since a long
 * throw drifts, slows and meets more of the table on its way.
 */
function valueOn(
  loaded: { kind: number; special: string | null } | null, g: Group, at: Ball, distance: number, prof: AiProfile, height: number
): { value: number; strength: number } {
  const live = g.members.filter(m => !m.ghost);
  const n = live.length;
  const nonBlack = live.filter(m => m.special !== 'black').length;
  const boomAt = PhysicsConfig.BOOM_SPEED * prof.boomMargin;
  const soft = strengthForSpeed(launchSpeedToArrive(PhysicsConfig.BOOM_SPEED * (prof.lockArrive ?? 0.45), distance));
  const hard = strengthForSpeed(launchSpeedToArrive(boomAt, distance));
  const reachable = launchSpeedOf({ strength: 1 } as LauncherPlayer) >= launchSpeedToArrive(boomAt, distance);
  const near = 1 / (1 + Math.pow(distance / (height * 0.7), 2));

  if (!loaded) return { value: n * near, strength: hard };
  if (loaded.special === 'white') return { value: boomPay(Math.max(1, nonBlack)) * near, strength: soft };
  if (loaded.special === 'black') return { value: lockPay(1, 1, n) * near, strength: soft };
  const sameKind = live.some(m => m.special !== 'black' && m.kind === loaded.kind) || nonBlack === 0;
  if (sameKind || at.special === 'black') return { value: lockPay(1, at.special === 'black' ? 1 : 0, n) * near, strength: soft };
  if (n >= PhysicsConfig.MIN_BOOM && reachable) return { value: boomPay(nonBlack) * near, strength: hard };
  return { value: peelPay(n) * 0.3 * near, strength: hard };
}

/** Whether any live ball outside `g` lies across the line from `from` to `to`. */
function lineBlocked(balls: Ball[], g: Group, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const R = PhysicsConfig.R;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len2 = dx * dx + dy * dy || 1;
  for (const b of balls) {
    if (b.ghost || b.group === g) continue;
    const t = ((b.x - from.x) * dx + (b.y - from.y) * dy) / len2;
    if (t <= 0 || t >= 1) continue;
    const px = from.x + t * dx, py = from.y + t * dy;
    if (Math.hypot(b.x - px, b.y - py) < 2 * R * 0.95) return true;
  }
  return false;
}

function chooseTarget(p: LauncherPlayer, game: Game, width: number, height: number, prof: AiProfile): Choice | null {
  const mouth = launchPointOf(p, width, height);
  let best: Choice | null = null;
  for (const g of game.groups) {
    const live = g.members.filter(m => !m.ghost);
    if (!live.length) continue;
    if (prof.target === 'biggest') {
      if (live.length < 2) continue;
      const d = Math.hypot(g.com.x - mouth.x, g.com.y - mouth.y);
      const v = valueOn(p.loaded, g, live[0], d, prof, height);
      const c: Choice = { key: Math.min(...live.map(m => m.id)), x: g.com.x, y: g.com.y, strength: v.strength, value: live.length };
      if (!best || c.value > best.value) best = c;
      continue;
    }
    // By value: aim at the ball the throw would meet first, the one nearest the
    // bay, or the nearest one it can boom when the group carries a black.
    let at = live[0], atD = Infinity;
    for (const m of live) {
      const d = Math.hypot(m.x - mouth.x, m.y - mouth.y);
      if (d < atD) { atD = d; at = m; }
    }
    const point = prof.aimPoint === 'com' ? g.com : at;
    if (prof.clearLine && lineBlocked(game.balls, g, mouth, point)) continue;
    const v = valueOn(p.loaded, g, at, atD, prof, height);
    const c: Choice = { key: Math.min(...live.map(m => m.id)), x: point.x, y: point.y, strength: v.strength, value: v.value };
    if (!best || c.value > best.value) best = c;
  }
  if (best || prof.target === 'biggest') return best;
  return null;
}

/**
 * Aim player `p` as the AI at `level` would. The classic rung is `aiAim` itself,
 * call for call, so the pre-ladder AI and every baseline that measures it are
 * exactly as they were.
 */
/** The throws a planning AI tries: at each of the biggest groups, and across a coarse fan. */
function planCandidates(p: LauncherPlayer, game: Game, width: number, height: number, plan: NonNullable<AiProfile['plan']>): Candidate[] {
  const out: Candidate[] = [];
  const angles: number[] = [];
  const groups = game.groups
    .filter(g => g.members.length && !g.members[0].ghost)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, plan.targets);
  for (const g of groups) {
    const t = { ...p };
    aimAt(t, g.com.x, g.com.y, width, height, game.twoPlayer);
    angles.push(t.aimDeg);
  }
  for (let i = 0; i < plan.grid; i++) angles.push(-80 + (160 * i) / Math.max(1, plan.grid - 1));
  for (const a of angles) for (const s of plan.strengths) out.push({ aimDeg: a, strength: s });
  return out;
}

export function aiAimLevel(p: LauncherPlayer, game: Game, width: number, height: number, level: number) {
  const prof = AI_LEVELS[Math.max(0, Math.min(AI_LEVELS.length - 1, level))];
  if (prof.classic) {
    aiAim(p, game.groups, game.balls, width, height, game.twoPlayer);
    return;
  }
  const st = stateOf(p);
  const want = { ...p };
  if (prof.plan) {
    // One job per reload: started when the ring is `window` from full, worked
    // on each frame, and its best so far aimed at the moment of the throw.
    if (p.reload > prof.plan.window) { st.job = undefined; st.planned = undefined; }
    else {
      if (!st.job) {
        const who = game.players.indexOf(p);
        st.job = new PlanJob(game, who, planCandidates(p, game, width, height, prof.plan), prof.plan.seconds,
          p.reload, width, height, game.nextId * 7919, prof.plan.rollouts ?? 1);
      }
      if (!st.job.done) st.job.run();
      if (st.job.best) st.planned = st.job.best;
    }
    if (st.planned) {
      p.aimDeg += (st.planned.aimDeg - p.aimDeg) * prof.turn;
      p.strength += (st.planned.strength - p.strength) * prof.turn;
      return;
    }
  }
  const choice = chooseTarget(p, game, width, height, prof);
  if (choice) {
    if (st.key !== choice.key) {
      st.key = choice.key;
      st.errDeg = gauss() * prof.aimErrorDeg;
      st.errPow = gauss() * prof.powerError;
      if (prof.power === 'random') st.errPow += 0.35 + Math.random() * 0.65;
      st.wildDeg = prof.wild && Math.random() < prof.wild ? Math.random() * 170 - 85 : undefined;
      if (st.wildDeg !== undefined) st.errPow = Math.random();
    }
    aimAt(want, choice.x, choice.y, width, height, game.twoPlayer);
    want.aimDeg = st.wildDeg ?? Math.max(-90, Math.min(90, want.aimDeg + st.errDeg));
    const base = prof.power === 'max' ? 1 : prof.power === 'random' ? 0 : choice.strength;
    want.strength = st.wildDeg !== undefined ? st.errPow : Math.max(0, Math.min(1, base + st.errPow));
    st.idleDeg = undefined;
  } else {
    // Nothing worth a throw: settle on one idle angle rather than wander.
    st.key = -1;
    if (st.idleDeg === undefined) st.idleDeg = Math.random() * 40 - 20;
    want.aimDeg = st.idleDeg;
    want.strength = 0.7;
  }
  p.aimDeg += (want.aimDeg - p.aimDeg) * prof.turn;
  p.strength += (want.strength - p.strength) * prof.turn;
}
