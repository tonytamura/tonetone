import { Ball, BoomShape, FLASH_LIFE, Flash, Group, LauncherPlayer, POP_LIFE, Pop, ScoreSource, Shot, SoundEvent } from './Types';
import { PhysicsConfig } from './Config';
import { rebuildGroups, separateGroups, shiftGroup, syncGroup } from './RigidBody';
import { clearExempt, mouthClamp, mouthCollide } from './LauncherBays';
import { NO_CREDIT, SHOT_DECAY, boomPay, boomsOn, lockPay, peelPay } from '../game/Rules';
import { TAU } from '../math';

/**
 * Numbers that shape how the game plays but are not knobs.
 *
 * They stay here rather than in `PhysicsConfig`, which is the tuning surface the
 * panel exposes and the harness snapshots: filling it with solver internals
 * makes the real knobs harder to find. Anything here that becomes worth a slider
 * should move there, and gain an entry in the knob registry with it.
 *
 * Several are numerically equal to unrelated values elsewhere and must not be
 * merged with them: `SPIN_CAP` is 12 like the default ball radius and
 * `RULE_SPEED`, and `SPIN_STOP` is 0.02 like `OVERLAP_SLOP`.
 */

/** Debris never leaves a boom slower than this (x SC), so a boom always scatters. */
const DEBRIS_MIN_SPEED = 200;
/** One ball in ten keeps whatever speed the boom gave it. See Scoring in Notion. */
const DEBRIS_UNCAPPED_FRACTION = 0.1;
/**
 * The rest are held just under the boom threshold (x BOOM_SPEED).
 *
 * Debris that can boom on its own turns one throw into a runaway chain; the
 * uncapped tenth is what keeps the occasional one possible.
 */
const DEBRIS_SPEED_CAP = 0.95;

/** A peeled ball is kicked out at least this fast (x SC). */
const PEEL_MIN_SPEED = 90;
/** The floor of the kick's range, as a fraction of the impact that caused it. */
const PEEL_IMPACT_LO = 0.35;
/** The kick's range is never narrower than this, so it keeps some spread. */
const PEEL_SPEED_SPAN = 30;
/** The ceiling of the kick's range, as a fraction of the impact. */
const PEEL_IMPACT_HI = 1.4;

/** A white ball always strikes at least this hard (x BOOM_SPEED), so it never fails to boom. */
const WHITE_HIT_IMPACT = 1.2;

/**
 * How long one pair of balls is ignored after it scores, in seconds.
 *
 * Two groups in contact stay in contact for many substeps; without this, one
 * touch would score on every one of them.
 */
const PAIR_COOLDOWN = 0.2;
/** Above this many remembered pairs, sweep out the ones whose balls are gone. */
const LAST_HIT_SWEEP_AT = 150;
/** If the sweep did not get it under control, drop the lot. */
const LAST_HIT_CLEAR_AT = 500;

/** Spin slower than this (rad/s) is treated as none, so groups come to rest. */
const SPIN_STOP = 0.02;
/** Spin is clamped here (rad/s); past it a group is a blur and reads as a glitch. */
const SPIN_CAP = 12;

/** How many passes `relax` makes at the overlaps each substep. */
export const RELAX_ITERATIONS = 24;
/** Overlap, in px, that `relax` leaves alone rather than pushing apart. */
const OVERLAP_SLOP = 0.02;

/** Seconds a rain ball stays intangible after it appears, blinking in. */
export const RAIN_GRACE = 1.0;
/** It blinks three times over that second, so one blink lasts this long. */
export const RAIN_BLINK = RAIN_GRACE / 3;

export interface CollisionState {
  balls: Ball[];
  groups: Group[];
  flashes: Flash[];
  pops: Pop[];
  /** Sounds this frame earned, drained by the frame loop after the last substep. */
  sounds: SoundEvent[];
  byId: Map<number, Ball>;
  lastHit: Map<string, number>;
  players: LauncherPlayer[];
  /**
   * The launchers on the table, whose mouths balls bounce off: both in a
   * two-player match, only the bottom one in solo. Not `players`, which always
   * holds two for scoring: taking the mouths from it left an invisible wall at
   * the top of a solo table (Bug 16).
   */
  bays: LauncherPlayer[];
  nextId: number;
  killBig: number;
  killGroups: number;
  killBalls: number;
}

/**
 * The four neighbour cells swept from each cell. Together with the cell's own
 * members they visit every pair within one cell width exactly once. Held at
 * module level so the sweep allocates nothing per call.
 */
const NEIGHBOUR_X = [0, 1, 1, 1];
const NEIGHBOUR_Y = [1, -1, 0, 1];

/**
 * A cell's key as one number: string keys built by concatenation cost 2.4x the
 * sweep at 250 balls, and `relax` runs it up to 200 times a frame. The offset
 * keeps cells just outside the field (a ball pushed past a wall) positive.
 */
const CELL_SPAN = 1 << 12;
const cellKey = (cx: number, cy: number) => (cx + CELL_SPAN / 2) * CELL_SPAN + (cy + CELL_SPAN / 2);

export function forEachPair(balls: Ball[], fn: (a: Ball, b: Ball) => void) {
  const cell = 2 * PhysicsConfig.R + 2;
  const grid = new Map<number, Ball[]>();
  // Cell coordinates are remembered alongside their buckets rather than parsed
  // back out of the keys. `relax` runs this sweep RELAX_ITERATIONS times per substep,
  // and re-splitting every key on every pass costs more than carrying them.
  const buckets: Ball[][] = [];
  const cellX: number[] = [];
  const cellY: number[] = [];

  for (const b of balls) {
    const cx = Math.floor(b.x / cell), cy = Math.floor(b.y / cell);
    const key = cellKey(cx, cy);
    const arr = grid.get(key);
    if (arr) arr.push(b);
    else {
      const fresh = [b];
      grid.set(key, fresh);
      buckets.push(fresh); cellX.push(cx); cellY.push(cy);
    }
  }

  for (let c = 0; c < buckets.length; c++) {
    const arr = buckets[c];
    const cx = cellX[c], cy = cellY[c];

    // Pairs inside this cell. Previously this was a self-lookup back into the
    // grid for a bucket already in hand.
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) fn(arr[i], arr[j]);
    }

    for (let n = 0; n < 4; n++) {
      const other = grid.get(cellKey(cx + NEIGHBOUR_X[n], cy + NEIGHBOUR_Y[n]));
      if (!other) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < other.length; j++) fn(arr[i], other[j]);
      }
    }
  }
}

/**
 * Pay `who` for one scoring event. When the event came from a throw, each
 * further event that throw causes pays SHOT_DECAY times the one before, so a
 * ball that keeps bumping into things does not keep earning full value.
 */
export function award(state: CollisionState, who: number, points: number, x: number, y: number, source?: ScoreSource, shot?: Shot, boom?: BoomShape) {
  if (!(who >= 0) || !state.players[who] || points <= 0) return;
  if (shot) {
    points = Math.round(points * Math.pow(SHOT_DECAY, shot.events));
    shot.events++;
    if (points <= 0) return;
  }
  const p = state.players[who];
  p.score += points;
  if (source) {
    if (source === 'lock') p.lockPts += points;
    else if (source === 'boom') p.boomPts += points;
    else if (source === 'peel') p.peelPts += points;
  }
  state.pops.push({ x, y, t: 0, label: { points, source, boom }, who });
  if (state.pops.length > 40) state.pops.shift();
}

/** Everything but the group and the impact that a boom needs. */
export interface BoomOptions {
  /** Player to pay, or `NO_CREDIT`/omitted for nobody. */
  credit?: number;
  /** A white ball striking a black one: the only boom that destroys a black ball. */
  isWhiteHit?: boolean;
  /** The throw this boom traces back to, so SHOT_DECAY can be applied. */
  shot?: Shot;
}

export function boomGroup(state: CollisionState, g: Group, impact: number, opts: BoomOptions = {}) {
  const { credit, isWhiteHit = false, shot } = opts;
  const members = g.members.slice();
  if (!members.length) return;

  const destroyedMembers = isWhiteHit ? members : members.filter(b => b.special !== 'black');
  const survivingMembers = isWhiteHit ? [] : members.filter(b => b.special === 'black');
  // Only a white ball destroys a black one, and only ever here: every other
  // path filters blacks out of `destroyedMembers`. That boom gets its own voice,
  // and the only BOOM! on the board. Computed here because both the pop text and
  // the voice below need it.
  const whiteBlack = isWhiteHit && destroyedMembers.some(b => b.special === 'black');

  if (!destroyedMembers.length) return;

  state.killGroups++;
  state.killBalls += destroyedMembers.length;
  if (destroyedMembers.length > state.killBig) state.killBig = destroyedMembers.length;

  const who = credit === undefined ? NO_CREDIT : credit;
  const count = destroyedMembers.length;
  if (state.players[who]) {
    state.players[who].destroyed += count;
    state.players[who].booms++;
  }

  let ax = 0, ay = 0;
  for (const b of destroyedMembers) { ax += b.x; ay += b.y; }
  award(state, who, boomPay(count), ax / count, ay / count, 'boom', shot, { count, whiteBlack });

  for (const b of destroyedMembers) {
    for (const id of b.bonds) {
      const o = state.byId.get(id);
      if (o) o.bonds.delete(b.id);
    }
    b.bonds.clear();
    b.ghost = true; b.age = 0; b.pure = false;
    b.credit = who; b.shot = shot;
    state.flashes.push({ x: b.x, y: b.y, t: 0, kind: 'break' });
  }

  for (const b of survivingMembers) {
    for (const id of Array.from(b.bonds)) {
      const o = state.byId.get(id);
      if (!o || o.ghost) {
        b.bonds.delete(id);
      }
    }
  }

  state.groups = rebuildGroups(state.balls, state.byId);

  // `ax` and `count` above are this same centroid sum over this same array.
  const n = count;
  const voice = destroyedMembers.find(m => !m.special) || destroyedMembers[0];
  state.sounds.push({ type: 'boom', x: ax / n, kind: voice.kind, size: n, whiteBlack });

  for (const b of destroyedMembers) {
    const dir = Math.random() * TAU;
    let sp = Math.max(
      DEBRIS_MIN_SPEED * PhysicsConfig.SC,
      impact * (PhysicsConfig.GHOST_SPREAD_LO + Math.random() * (PhysicsConfig.GHOST_SPREAD_HI - PhysicsConfig.GHOST_SPREAD_LO))
    );
    if (Math.random() >= DEBRIS_UNCAPPED_FRACTION) {
      sp = Math.min(sp, PhysicsConfig.BOOM_SPEED * DEBRIS_SPEED_CAP);
    }
    b.group.vx = Math.cos(dir) * sp;
    b.group.vy = Math.sin(dir) * sp;
  }
}

/** Everything but the ball and the impact that a peel needs. */
export interface PeelOptions {
  /** Player to pay, or `NO_CREDIT`/omitted for nobody. */
  credit?: number;
  /** The throw this peel traces back to, so SHOT_DECAY can be applied. */
  shot?: Shot;
}

export function detach(state: CollisionState, b: Ball, impact?: number, opts: PeelOptions = {}) {
  const { credit, shot } = opts;
  const c = credit !== undefined ? credit : NO_CREDIT;
  if (state.players[c]) state.players[c].peels++;
  award(state, c, peelPay(b.group.members.length), b.x, b.y, 'peel', shot);

  for (const id of b.bonds) {
    const o = state.byId.get(id);
    if (o) o.bonds.delete(b.id);
  }
  b.bonds.clear();
  state.groups = rebuildGroups(state.balls, state.byId);

  const hit = impact || PhysicsConfig.KICKOUT_MIN;
  const lo = Math.max(PEEL_MIN_SPEED * PhysicsConfig.SC, hit * PEEL_IMPACT_LO);
  const hi = Math.max(lo + PEEL_SPEED_SPAN, Math.min(PhysicsConfig.KICKOUT_MAX, hit * PEEL_IMPACT_HI));
  const dir = Math.random() * TAU;
  const speed = (lo + Math.random() * (hi - lo)) * PhysicsConfig.KICK;
  b.group.vx = Math.cos(dir) * speed;
  b.group.vy = Math.sin(dir) * speed;

  state.flashes.push({ x: b.x, y: b.y, t: 0, kind: 'break' });
  state.sounds.push({ type: 'peel', x: b.x, kind: b.kind });
}

export function ageGhosts(state: CollisionState, dt: number) {
  let dead: Ball[] | null = null;
  for (const b of state.balls) {
    if (!b.ghost) continue;
    b.age = (b.age || 0) + dt;
    if (b.age > PhysicsConfig.GHOST_LIFE) (dead || (dead = [])).push(b);
  }
  if (dead) {
    for (const b of dead) {
      state.byId.delete(b.id);
      for (const id of b.bonds) {
        const o = state.byId.get(id);
        if (o) o.bonds.delete(b.id);
      }
      b.bonds.clear();
    }
    // One filtering pass, rather than an indexOf scan of the whole field for
    // each expiring ghost. Array order is preserved, which the broadphase relies on.
    const gone = new Set(dead);
    state.balls = state.balls.filter(b => !gone.has(b));
    state.groups = rebuildGroups(state.balls, state.byId);
  }

  if (state.lastHit.size > LAST_HIT_SWEEP_AT) {
    for (const [key] of state.lastHit) {
      const pipe = key.indexOf('|');
      if (pipe > 0) {
        const idA = +key.slice(0, pipe);
        const idB = +key.slice(pipe + 1);
        if (!state.byId.has(idA) || !state.byId.has(idB)) {
          state.lastHit.delete(key);
        }
      }
    }
    if (state.lastHit.size > LAST_HIT_CLEAR_AT) {
      state.lastHit.clear();
    }
  }
}

export function resolveWalls(g: Group, width: number, height: number) {
  const R = PhysicsConfig.R;
  for (let axis = 0; axis < 2; axis++) {
    let deep = 0, hit: Ball | null = null, nx = 0, ny = 0;
    for (const b of g.members) {
      if (axis === 0) {
        if (R - b.x > deep) { deep = R - b.x; hit = b; nx = 1; ny = 0; }
        if (b.x - (width - R) > deep) { deep = b.x - (width - R); hit = b; nx = -1; ny = 0; }
      } else {
        if (R - b.y > deep) { deep = R - b.y; hit = b; nx = 0; ny = 1; }
        if (b.y - (height - R) > deep) { deep = b.y - (height - R); hit = b; nx = 0; ny = -1; }
      }
    }
    if (!hit) continue;
    shiftGroup(g, nx * deep, ny * deep);

    const rx = hit.x - nx * R - g.com.x, ry = hit.y - ny * R - g.com.y;
    const vn = (g.vx - g.av * ry) * nx + (g.vy + g.av * rx) * ny;
    if (vn >= 0) continue;
    const rn = rx * ny - ry * nx;
    const invI = PhysicsConfig.SPIN / g.inertia;
    const j = (-(1 + PhysicsConfig.REST_WALL) * vn) / (1 / g.mass + rn * rn * invI);
    g.vx += (j * nx) / g.mass; g.vy += (j * ny) / g.mass;
    g.av += j * rn * invI;
  }
}

/**
 * Classify every contact this step, then resolve each list in a fixed order.
 *
 * No longer takes a width: the only thing it needed one for was the stereo pan of
 * the sounds it used to play, and sounds are now recorded on `state.sounds` in
 * world coordinates for the frame loop to drain.
 */
export function collide(state: CollisionState, now: number) {
  const R = PhysicsConfig.R;
  const bonds: { a: Ball; b: Ball; credit: number; shot?: Shot }[] = [];
  const breaks: { ball: Ball; impact: number; credit: number; shot?: Shot }[] = [];
  const ghostHits: { gh: Ball; real: Ball; impact: number }[] = [];
  const whiteHits: { w: Ball; other: Ball; impact: number }[] = [];
  const knocks: { x: number; force: number; hitterKind: number; struckKind: number }[] = [];

  forEachPair(state.balls, (a, b) => {
    if (a.group === b.group) return;
    if ((a.rainTime && a.rainTime > 0) || (b.rainTime && b.rainTime > 0)) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= 2 * R) return;

    let nx: number, ny: number;
    if (d < 1e-6) {
      const ang = Math.random() * TAU;
      nx = Math.cos(ang); ny = Math.sin(ang);
    } else {
      nx = dx / d; ny = dy / d;
    }

    const A = a.group, B = b.group;
    const mA = A.mass, mB = B.mass;
    const px = a.x + nx * R, py = a.y + ny * R;
    const rax = px - A.com.x, ray = py - A.com.y;
    const rbx = px - B.com.x, rby = py - B.com.y;
    const vax = A.vx - A.av * ray, vay = A.vy + A.av * rax;
    const vbx = B.vx - B.av * rby, vby = B.vy + B.av * rbx;

    const rvn = (vbx - vax) * nx + (vby - vay) * ny;
    if (rvn > 0) return;

    const pushA = vax * nx + vay * ny;
    const pushB = -(vbx * nx + vby * ny);

    const ran = rax * ny - ray * nx;
    const rbn = rbx * ny - rby * nx;
    const invIA = PhysicsConfig.SPIN / A.inertia, invIB = PhysicsConfig.SPIN / B.inertia;
    const imp = (-(1 + PhysicsConfig.REST) * rvn) / (1 / mA + 1 / mB + ran * ran * invIA + rbn * rbn * invIB);

    A.vx -= (imp * nx) / mA; A.vy -= (imp * ny) / mA; A.av -= imp * ran * invIA;
    B.vx += (imp * nx) / mB; B.vy += (imp * ny) / mB; B.av += imp * rbn * invIB;

    if (a.ghost || b.ghost) {
      if (!(a.ghost && b.ghost)) {
        const gh = a.ghost ? a : b, real = a.ghost ? b : a;
        // Debris only claims a live ball it pushes. A live ball that rolls into
        // debris keeps its own credit instead of passing to whoever boomed it.
        const ghostPush = gh === a ? pushA : pushB, realPush = gh === a ? pushB : pushA;
        if (gh.credit >= 0 && ghostPush >= realPush) { real.credit = gh.credit; real.shot = gh.shot; }
        ghostHits.push({ gh, real, impact: -rvn });
      }
      return;
    }

    if (-rvn < PhysicsConfig.RULE_SPEED * PhysicsConfig.SC) return;
    // Smaller id first: the broadphase visits a pair in either order as the
    // balls change cells, and an ordered key let the 0.2s cooldown be skipped.
    const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
    if (now - (state.lastHit.get(key) || -9) < PAIR_COOLDOWN) return;
    state.lastHit.set(key, now);

    const struck = pushA >= pushB ? b : a;
    const hitter = struck === a ? b : a;
    if (hitter.credit >= 0) { struck.credit = hitter.credit; struck.shot = hitter.shot; }

    if (a.special === 'white' || b.special === 'white') {
      const w = a.special === 'white' ? a : b;
      whiteHits.push({ w, other: w === a ? b : a, impact: -rvn });
      return;
    }

    const sticks = a.special === 'black' || b.special === 'black' || a.kind === b.kind;

    if (sticks) {
      if (!a.bonds.has(b.id)) {
        bonds.push({ a, b, credit: hitter.credit, shot: hitter.shot });
        state.flashes.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 0, kind: 'bond' });
      }
    } else if (struck.bonds.size) {
      breaks.push({ ball: struck, impact: -rvn, credit: hitter.credit, shot: hitter.shot });
    } else {
      knocks.push({
        x: (a.x + b.x) / 2, force: -rvn,
        hitterKind: hitter.kind,
        struckKind: struck.kind,
      });
    }
  });

  for (const k of knocks) {
    state.sounds.push({ type: 'knock', x: k.x, force: k.force, hitterKind: k.hitterKind, struckKind: k.struckKind });
  }

  for (const bond of bonds) {
    const a = bond.a, b = bond.b;
    if (a.group === b.group || a.bonds.has(b.id)) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    if (!separateGroups(a.group, b.group, dx / d, dy / d)) continue;
    // A lock pays for the balls it adds (the smaller side of the merge), more
    // the bigger the group they join (the larger side).
    const joined = Math.min(a.group.members.length, b.group.members.length);
    const target = Math.max(a.group.members.length, b.group.members.length);
    a.bonds.add(b.id); b.bonds.add(a.id);
    state.groups = rebuildGroups(state.balls, state.byId);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const blacks = (a.special === 'black' ? 1 : 0) + (b.special === 'black' ? 1 : 0);
    const viaBlack = blacks > 0;
    // Read after `rebuildGroups` above, so this is the merged group: the lock
    // is scaled by what it produced, not by either side going into it.
    const size = a.group.members.length;
    if (viaBlack) {
      state.sounds.push({ type: 'magnetLock', x: mx, size, bothBlack: blacks >= 2 });
    } else {
      state.sounds.push({ type: 'lock', x: mx, kind: a.kind });
    }
    if (state.players[bond.credit]) {
      state.players[bond.credit].locks++;
      state.players[bond.credit].best = Math.max(state.players[bond.credit].best, size);
    }
    award(state, bond.credit, lockPay(joined, blacks, target), mx, my, 'lock', bond.shot);
  }

  for (const hit of breaks) {
    if (!hit.ball.bonds.size) continue;
    if (hit.ball.special === 'black') continue;
    if (boomsOn(hit.impact, hit.ball.group))
      boomGroup(state, hit.ball.group, hit.impact, { credit: hit.credit, shot: hit.shot });
    else detach(state, hit.ball, hit.impact, { credit: hit.credit, shot: hit.shot });
  }

  for (const h of whiteHits) {
    if (!state.byId.has(h.w.id) || !h.w.special) continue;
    const target = h.other.group;
    if (target && target.members.length && !h.other.ghost) {
      boomGroup(state, target, Math.max(PhysicsConfig.BOOM_SPEED * WHITE_HIT_IMPACT, h.impact), { credit: h.w.credit, isWhiteHit: true, shot: h.w.shot });
    }
    h.w.special = null;
    h.w.ghost = true;
    h.w.age = 0;
    h.w.pure = true;
    state.flashes.push({ x: h.w.x, y: h.w.y, t: 0, kind: 'break' });
    state.groups = rebuildGroups(state.balls, state.byId);
  }

  if (ghostHits.length) {
    const spent = new Set<Ball>();
    for (const h of ghostHits) {
      if (spent.has(h.gh)) continue;
      // The group may have boomed earlier in this same substep (a break or a
      // white hit): its balls are debris now, and booming them again counted
      // one boom twice — two tallies, a second pop and a second sound.
      if (h.real.ghost) continue;
      spent.add(h.gh);
      state.flashes.push({ x: h.gh.x, y: h.gh.y, t: 0, kind: 'spawn' });
      if (h.gh.pure || (h.gh.kind !== h.real.kind && h.real.bonds.size)) {
        if (h.real.special === 'black' && !h.gh.pure) continue;
        if (h.gh.pure || boomsOn(h.impact, h.real.group))
          boomGroup(state, h.real.group, Math.max(PhysicsConfig.BOOM_SPEED, h.impact), { credit: h.gh.credit, isWhiteHit: h.gh.pure, shot: h.gh.shot });
        // A peel caused by debris pays nobody: `credit` is left out on purpose.
        // Only a thrown ball earns, so the chain reaction it started cannot keep
        // paying after it. See Scoring §1 in Notion.
        else detach(state, h.real, h.impact, { credit: NO_CREDIT });
      }
    }
    for (const g of spent) state.byId.delete(g.id);
    state.balls = state.balls.filter(b => !spent.has(b));
    state.groups = rebuildGroups(state.balls, state.byId);
  }
}

export function relax(state: CollisionState, iterations: number, width: number, height: number) {
  const R = PhysicsConfig.R;
  const min = 2 * R, EDGE = 0.05;

  // Clamp everything out of launch bays before the iteration loop,
  // in case stepPhysics movement already drove a ball inside.
  for (const g of state.groups) {
    resolveWalls(g, width, height);
    mouthClamp(g, state.bays, width, height);
  }

  for (let it = 0; it < iterations; it++) {
    for (const g of state.groups) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const m of g.members) {
        x0 = Math.min(x0, m.x - R); x1 = Math.max(x1, m.x + R);
        y0 = Math.min(y0, m.y - R); y1 = Math.max(y1, m.y + R);
      }
      g._x0 = x0; g._x1 = x1; g._y0 = y0; g._y1 = y1;
    }

    let moved = false;
    forEachPair(state.balls, (a, b) => {
      if (a.group === b.group) return;
      if ((a.rainTime && a.rainTime > 0) || (b.rainTime && b.rainTime > 0)) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) return;
      let d = Math.sqrt(d2), nx: number, ny: number;
      if (d < 1e-6) { const ang = Math.random() * TAU; nx = Math.cos(ang); ny = Math.sin(ang); d = 0; }
      else { nx = dx / d; ny = dy / d; }
      const push = min - d;
      if (push <= OVERLAP_SLOP) return;

      const A = a.group, B = b.group;
      const wA = 1 / A.members.length, wB = 1 / B.members.length;
      const freeX = (g: Group, dir: number) => !((dir < 0 && (g._x0 || 0) <= EDGE) || (dir > 0 && (g._x1 || 0) >= width - EDGE));
      const freeY = (g: Group, dir: number) => !((dir < 0 && (g._y0 || 0) <= EDGE) || (dir > 0 && (g._y1 || 0) >= height - EDGE));
      const corr = push * 0.85;

      const axW = freeX(A, -nx) ? wA : 0, bxW = freeX(B, nx) ? wB : 0;
      if (axW + bxW > 0) {
        const s = (corr * nx) / (axW + bxW);
        shiftGroup(A, -s * axW, 0); shiftGroup(B, s * bxW, 0);
      }
      const ayW = freeY(A, -ny) ? wA : 0, byW = freeY(B, ny) ? wB : 0;
      if (ayW + byW > 0) {
        const s = (corr * ny) / (ayW + byW);
        shiftGroup(A, 0, -s * ayW); shiftGroup(B, 0, s * byW);
      }
      moved = true;

      // Re-clamp both groups against the launch bay after each pair shift,
      // so that inter-ball pressure cannot drive a group through the mouth boundary.
      mouthClamp(A, state.bays, width, height);
      mouthClamp(B, state.bays, width, height);
    });

    for (const g of state.groups) {
      resolveWalls(g, width, height);
      mouthClamp(g, state.bays, width, height);
      resolveWalls(g, width, height);
    }
    if (!moved) break;
  }
}

/**
 * Whether a rain ball at the end of its grace would turn solid inside another ball.
 *
 * A rain ball passes through everything while it blinks in, so a group can drift
 * over it, or it over a group. If it turned solid there it would be deep inside a
 * rigid group, where every way out is blocked by another member of the same group
 * and `relax`, which only pushes pairs apart, cannot free it: pushes from opposite
 * members cancel. That was the source of every deep cross-group overlap the
 * harness found, some lasting seconds. Such a ball blinks once more instead and
 * lands when it is clear. Other rain balls do not count, since they are not solid
 * yet; whichever of two overlapping ones lands first holds the other back.
 */
function landsInside(balls: Ball[], b: Ball): boolean {
  const reach = 2 * PhysicsConfig.R - OVERLAP_SLOP;
  for (const o of balls) {
    if (o === b || (o.rainTime && o.rainTime > 0)) continue;
    const dx = o.x - b.x, dy = o.y - b.y;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  return false;
}

export function stepPhysics(state: CollisionState, dt: number, now: number, width: number, height: number) {
  const decay = Math.pow(PhysicsConfig.DRAG, dt);
  for (const g of state.groups) {
    g.vx *= decay; g.vy *= decay; g.av *= decay;
    const sp = Math.hypot(g.vx, g.vy);
    if (sp < PhysicsConfig.STOP * PhysicsConfig.SC) { g.vx = 0; g.vy = 0; }
    else if (sp > PhysicsConfig.SPEED_CAP * PhysicsConfig.SC) {
      const k = (PhysicsConfig.SPEED_CAP * PhysicsConfig.SC) / sp;
      g.vx *= k; g.vy *= k;
    }
    if (Math.abs(g.av) < SPIN_STOP) g.av = 0;
    else if (Math.abs(g.av) > SPIN_CAP) g.av = Math.sign(g.av) * SPIN_CAP;

    // A ball at rest stops carrying credit: whatever sets it moving again is
    // not the throw that last touched it.
    if (!g.vx && !g.vy && !g.av) {
      for (const b of g.members) if (b.credit >= 0) { b.credit = -1; b.shot = undefined; }
    }

    if (g.vx || g.vy) { g.com.x += g.vx * dt; g.com.y += g.vy * dt; }
    if (g.av) {
      g.ang += g.av * dt;
      // `syncGroup` is this exact transform with the sin/cos lifted out of the
      // member loop, where they do not vary. Sharing it leaves one copy of it.
      syncGroup(g);
    } else if (g.vx || g.vy) {
      for (const b of g.members) { b.x += g.vx * dt; b.y += g.vy * dt; }
    }
  }

  for (const g of state.groups) {
    resolveWalls(g, width, height);
    mouthCollide(g, state.bays, width, height);
  }
  collide(state, now);
  relax(state, RELAX_ITERATIONS, width, height);
  for (const b of state.balls) {
    if (b.rainTime && b.rainTime > 0) {
      b.rainTime = Math.max(0, b.rainTime - dt);
      if (b.rainTime === 0) {
        if (landsInside(state.balls, b)) b.rainTime = RAIN_BLINK;
        else delete b.rainTime;
      }
    }
  }
  ageGhosts(state, dt);
  clearExempt(state.balls, state.bays, dt, width, height);
  ageEffects(state, dt);
}

/**
 * Age the flashes and the score pops by `dt`, dropping the expired ones.
 *
 * Both the match and the results celebration spawn these, and both used to run
 * their own copy of this loop — so the two could drift apart in what they
 * counted as expired. `FLASH_LIFE` and `POP_LIFE` were already shared; this
 * makes the lifecycle shared too. The state is typed structurally so the
 * celebration can pass the `Game` straight in.
 */
export function ageEffects(state: { flashes: Flash[]; pops: Pop[] }, dt: number) {
  for (const f of state.pops) f.t += dt;
  if (state.pops.length) state.pops = state.pops.filter(f => f.t < POP_LIFE);
  for (const f of state.flashes) f.t += dt;
  state.flashes = state.flashes.filter(f => f.t < FLASH_LIFE);
}
