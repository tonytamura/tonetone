/**
 * Hand-built fields for isolating the collision solver from the game rules.
 *
 * A sandbox is created with an empty `players` array, so the launcher bays
 * cannot clamp or bounce anything, and every ball gets a distinct `kind`, so no
 * bond can form and no group can break. What remains is the impulse solver on
 * its own, which is the only way to check it against textbook results.
 */
import { Ball, Group } from '../physics/Types';
import { PhysicsConfig } from '../physics/Config';
import { CollisionState, stepPhysics } from '../physics/CollisionSolver';
import { makeGroup } from '../physics/RigidBody';
import { ConfigSnapshot, restoreConfig, snapshotConfig } from './Knobs';
import { installSeededRandom, restoreRandom } from './Rng';

export interface Sandbox {
  state: CollisionState;
  width: number;
  height: number;
  /** Advance by dt with a single physics step — no substepping, for repeatability. */
  step(dt: number): void;
  /** Advance by `seconds` in steps of `dt`. */
  run(seconds: number, dt?: number): void;
  groupOf(id: number): Group;
  ball(id: number): Ball;
}

export interface SandboxOptions {
  width?: number;
  height?: number;
  /** Physics overrides. Defaults are the frictionless, perfectly elastic case. */
  config?: Partial<typeof PhysicsConfig>;
  seed?: number;
}

/** A ball with no bonds and a caller-chosen kind. */
export function makeBall(id: number, x: number, y: number, kind = id): Ball {
  return {
    id,
    x,
    y,
    kind,
    special: null,
    color: '#888888',
    credit: -1,
    bonds: new Set(),
    group: null as any,
  };
}

/**
 * Bond a set of balls into one rigid group without going through the collision
 * path, so a group can be built at an exact geometry.
 */
export function weld(balls: Ball[], vx = 0, vy = 0, av = 0): Group {
  for (const a of balls) {
    for (const b of balls) if (a !== b) a.bonds.add(b.id);
  }
  const g = makeGroup(balls, vx, vy);
  g.av = av;
  for (const b of balls) b.group = g;
  return g;
}

/** A group of one, free to move on its own. */
export function loose(b: Ball, vx = 0, vy = 0): Group {
  const g = makeGroup([b], vx, vy);
  b.group = g;
  return g;
}

/**
 * Build a sandbox around a set of pre-grouped balls, run `fn`, and restore the
 * shared physics config and `Math.random` afterwards.
 */
export function withSandbox<T>(
  balls: Ball[],
  groups: Group[],
  opts: SandboxOptions,
  fn: (sb: Sandbox) => T
): T {
  const snap: ConfigSnapshot = snapshotConfig();
  installSeededRandom(opts.seed ?? 1);
  try {
    // The textbook case: perfectly elastic, no drag, nothing parks.
    Object.assign(PhysicsConfig, {
      REST: 1,
      REST_WALL: 1,
      DRAG: 1,
      STOP: 0,
      SPIN: 1,
      SC: 1,
      RULE_SPEED: 12,
      SPEED_CAP: 1e9,
      ...(opts.config || {}),
    });

    const width = opts.width ?? 2000;
    const height = opts.height ?? 2000;

    const byId = new Map<number, Ball>();
    for (const b of balls) byId.set(b.id, b);

    const state: CollisionState = {
      balls,
      groups,
      flashes: [],
      pops: [],
      sounds: [],
      byId,
      lastHit: new Map(),
      // No launchers: the bays cannot interfere with an isolated measurement.
      players: [],
      bays: [],
      nextId: balls.length + 1,
      killBig: 0,
      killGroups: 0,
      killBalls: 0,
    };

    let clock = 0;
    const sb: Sandbox = {
      state,
      width,
      height,
      step(dt: number) {
        clock += dt;
        stepPhysics(state, dt, clock, width, height);
      },
      run(seconds: number, dt = 1 / 240) {
        const n = Math.max(1, Math.round(seconds / dt));
        for (let i = 0; i < n; i++) sb.step(dt);
      },
      groupOf(id: number) {
        return byId.get(id)!.group;
      },
      ball(id: number) {
        return byId.get(id)!;
      },
    };

    return fn(sb);
  } finally {
    restoreRandom();
    restoreConfig(snap);
  }
}

/** Total linear momentum of the field. */
export function totalMomentum(groups: Group[]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const g of groups) { x += g.mass * g.vx; y += g.mass * g.vy; }
  return { x, y };
}

/** Total kinetic energy, translational plus rotational. */
export function totalEnergy(groups: Group[]): number {
  let e = 0;
  for (const g of groups) {
    e += 0.5 * g.mass * (g.vx * g.vx + g.vy * g.vy);
    e += 0.5 * g.inertia * g.av * g.av;
  }
  return e;
}

/** Angular momentum about the origin. */
export function totalAngularMomentum(groups: Group[]): number {
  let l = 0;
  for (const g of groups) {
    l += g.mass * (g.com.x * g.vy - g.com.y * g.vx);
    l += g.inertia * g.av;
  }
  return l;
}

/** The pairwise distances within a group, for rigidity checks. */
export function pairwiseDistances(g: Group): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.members.length; i++) {
    for (let j = i + 1; j < g.members.length; j++) {
      const a = g.members[i], b = g.members[j];
      out.push(Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return out;
}

/** Largest absolute change between two distance lists. */
export function maxDrift(before: number[], after: number[]): number {
  let d = 0;
  for (let i = 0; i < before.length; i++) d = Math.max(d, Math.abs(after[i] - before[i]));
  return d;
}
