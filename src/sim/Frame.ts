/**
 * One frame of simulation, with no rendering and no DOM.
 *
 * This is the authoritative game loop. `main.ts` calls `advanceFrame` and then
 * draws; the headless harness calls `advanceFrame` and then measures. Neither
 * one owns a copy of the substep rule, the reload cadence or the rain cadence,
 * so a change to game feel cannot land in the browser while the simulation
 * quietly keeps measuring the old behaviour.
 */
import { PhysicsConfig } from '../physics/Config';
import { stepPhysics } from '../physics/CollisionSolver';
import {
  Game,
  isLowBallDensity,
  spawnRainBall,
  releaseBall,
  syncFromCollisionState,
  throwBall,
  toCollisionState,
} from '../game/GameState';
import { BANK_MAX, BOT_RELEASE_GAP, FIRE_ON_RELEASE } from '../game/Rules';
import { LauncherPlayer } from '../physics/Types';
import { aiAimLevel } from '../game/AI';
import { playSoundEvents } from '../audio/SoundEvents';

/**
 * Frames longer than this are a hitch and are clamped to it, so the match runs
 * slow through the hitch rather than jumping. A missing or non-positive dt
 * becomes FALLBACK_DT.
 */
export const MAX_FRAME_DT = 0.05;
export const FALLBACK_DT = 1 / 60;
export const MAX_SUBSTEPS = 24;

/** Density-based rain interval used when the rain knob is on "auto". */
export const AUTO_RAIN_INTERVAL = 0.7;

export interface FrameHooks {
  /** Called once, after `matchOver` is set, when the match clock runs out. */
  onMatchOver?: (game: Game) => void;
}

export interface FrameResult {
  /** The advanced simulation clock; feed it back in on the next frame. */
  clock: number;
  /** The dt actually simulated, after hitch clamping. */
  dt: number;
  /** Physics substeps taken this frame. */
  substeps: number;
  /** True if the match ended on this frame. */
  matchEnded: boolean;
  /**
   * Launchers that fired this frame — a bay whose reload had run down.
   *
   * A count rather than a flag: in a duel both bays can fire on the same frame,
   * and a flag could only report that *someone* had. One player throwing while
   * the other was blocked then read as a clean frame, which is how the blocked
   * throws of player 2 went unmeasured.
   */
  fired: number;
  /**
   * Fires that actually put a ball on the field. `fired - threw` is how many a
   * blocked bay refused: a launcher can fire and still not throw when resting
   * balls are sitting in front of it.
   */
  threw: number;
  /** True if a rain ball was requested on this frame. */
  rained: boolean;
}

/**
 * Guard a raw frame delta. A stalled main thread, a backgrounded tab or a
 * mismatched clock source can all produce a dt that is zero, negative or huge;
 * a negative dt in particular used to drive the simulation clock backwards and
 * silently disable every collision cooldown.
 */
export function normalizeDt(rawDt: number): number {
  // A long frame is clamped, not replaced: swapping anything over 50ms for
  // 1/60s ran a device stuck at 19fps at 30% speed, a 2:00 match lasting 6:20.
  return !(rawDt > 0) ? FALLBACK_DT : Math.min(rawDt, MAX_FRAME_DT);
}

/**
 * Velocity-based substepping: fast groups get finer steps so nothing tunnels
 * through a ball at high speed. Clamped to 2..MAX_SUBSTEPS steps per frame.
 */
export function substepCount(game: Game, dt: number): number {
  let fastest = 0;
  for (const g of game.groups) fastest = Math.max(fastest, Math.abs(g.vx) + Math.abs(g.vy));
  return Math.max(2, Math.min(MAX_SUBSTEPS, Math.ceil((fastest * dt) / (PhysicsConfig.R * 0.3))));
}

/** The rain interval in force right now, accounting for the "auto" setting. */
export function effectiveRainInterval(game: Game, width: number, height: number): number {
  if (game.rainInterval > 0) return game.rainInterval;
  return isLowBallDensity(game, width, height) ? AUTO_RAIN_INTERVAL : 0;
}

/** How little the AI's aim may move in a frame and still count as settled on its target. */
export const AI_SETTLED_DEG = 0.5;

/**
 * Continuous fire: count down the start hold, and let the reload ring add a ball
 * each time it fills until the bank is full, where the ring rests. A ring with
 * no time (`reload` 0) keeps the bank full.
 */
function refillBank(p: LauncherPlayer, reloadTime: number, dt: number) {
  if (p.hold > 0) p.hold = Math.max(0, p.hold - dt);
  if (reloadTime <= 0) { p.bank = BANK_MAX; return; }
  if (p.bank < BANK_MAX && p.reload <= 0) {
    p.bank++;
    p.reload = p.bank < BANK_MAX ? reloadTime : 0;
  }
}

/**
 * Whether a launcher nobody is touching lets go now: it has a ball, it is past
 * the start hold, and `BOT_RELEASE_GAP` has passed since its last throw. The AI
 * also waits for its aim to settle and, when it plans, for the plan.
 */
function botReleases(p: LauncherPlayer, clock: number, isAi: boolean, aiSettled: boolean): boolean {
  if (p.bank <= 0 || p.hold > 0 || clock - p.lastThrowAt < BOT_RELEASE_GAP) return false;
  // A planning profile holds its release in either seat: a harness bot playing
  // AGI from seat 1 used to throw before its plan was made, so tournaments
  // under continuous fire were not seat-symmetric.
  if (p.holdFire) return false;
  return !isAi || aiSettled;
}

/**
 * Advance the whole game by one frame: physics substeps, reload timers, AI aim,
 * ball rain, turn firing and the match clock.
 */
export function advanceFrame(
  game: Game,
  rawDt: number,
  width: number,
  height: number,
  clock: number,
  hooks?: FrameHooks
): FrameResult {
  if (game.paused) {
    return { clock, dt: 0, substeps: 0, matchEnded: false, fired: 0, threw: 0, rained: false };
  }

  const dt = normalizeDt(rawDt);
  const substeps = substepCount(game, dt);
  const h = dt / substeps;

  const colState = toCollisionState(game);
  if (!game.matchOver) {
    for (let i = 0; i < substeps; i++) {
      clock += h;
      stepPhysics(colState, h, clock, width, height);
    }
    // Once per frame, not once per substep: the solver records the sounds it earned
    // and this is the only place they are played. Keeping it here rather than inside
    // the substep loop means a group that booms is heard once.
    playSoundEvents(colState.sounds, width);
  } else {
    clock += dt;
  }
  syncFromCollisionState(game, colState);
  game.clock = clock;

  // Once the match is over the launchers rest: no ring filling and, under
  // continuous fire, no bank refilling behind the results (Tony, 2026-09-30).
  if (!game.matchOver) {
    for (const p of game.players) if (p.reload > 0) p.reload = Math.max(0, p.reload - dt);
    if (FIRE_ON_RELEASE) for (const p of game.players) refillBank(p, game.reloadTime, dt);
  }

  let aiSettled = false;
  if (game.aiOn && !game.matchOver) {
    const before = game.players[1].aimDeg;
    aiAimLevel(game.players[1], game, width, height, game.aiLevel, dt);
    // Settled is a turn rate, not a per-frame step: at 120Hz each frame moves half as far.
    aiSettled = Math.abs(game.players[1].aimDeg - before) < AI_SETTLED_DEG * dt * 60;
  }

  let fired = 0;
  let threw = 0;
  let rained = false;

  if (!game.matchOver) {
    const rainEvery = effectiveRainInterval(game, width, height);
    if (rainEvery > 0) {
      game.rainTimer += dt;
      if (game.rainTimer >= rainEvery) {
        game.rainTimer %= rainEvery;
        spawnRainBall(game, width, height);
        rained = true;
      }
    } else {
      game.rainTimer = 0;
    }

    const activePlayers = game.twoPlayer ? game.players : [game.players[0]];
    for (const p of activePlayers) {
      if (FIRE_ON_RELEASE) {
        const i = game.players.indexOf(p);
        const isAi = game.aiOn && i === 1;
        if ((isAi || game.bots[i]) && botReleases(p, clock, isAi, aiSettled)) p.releases = 1;
        // Every release waiting is thrown now, one ball each, while the bank lasts.
        // A release with the bank empty is spent, not saved for the next ball; a
        // blocked one keeps its ball and drops the rest of the burst.
        while (p.releases > 0) {
          p.releases--;
          if (p.bank <= 0 || p.hold > 0) { p.releases = 0; break; }
          fired++;
          if (releaseBall(p, game, width, height, clock)) threw++;
          else { p.releases = 0; break; }
        }
      } else if (p.reload <= 0) {
        fired++;
        if (throwBall(p, game, width, height)) threw++;
      }
    }
  }

  let matchEnded = false;
  if (game.matchRunning && !game.matchOver && game.matchLen > 0) {
    game.matchT += dt;
    if (game.matchT >= game.matchLen) {
      game.matchOver = true;
      game.matchRunning = false;
      matchEnded = true;
      hooks?.onMatchOver?.(game);
    }
  }

  return { clock, dt, substeps, matchEnded, fired, threw, rained };
}
