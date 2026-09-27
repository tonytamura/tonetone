/**
 * The tutorial's rules: which board each step lays out, which balls the player
 * is dealt, and when a step counts as done.
 *
 * Nothing here draws or listens for input. The page runs this beside
 * `advanceFrame` — `tutorialBeforeFrame`, the real frame, `tutorialAfterFrame`
 * — the same way the countdown and the results effects already run beside it,
 * so the tutorial plays the game that ships rather than a copy of it. That is
 * also what lets `tests/game/Tutorial.test.ts` drive every step headlessly and
 * measure whether it can be won.
 *
 * Design: the Tutorial: Design page in Notion. Three steps, each a small goal
 * met with the real launcher: hit a ball, build a group of four, boom it.
 */
import { Game, resetField, spawn, startMatch } from './GameState';
import { colorOfKind } from './Rules';
import { PhysicsConfig } from '../physics/Config';
import { BallOnDeck } from '../physics/Types';
import { rebuildGroups } from '../physics/RigidBody';
import { boomsOnImpact } from '../physics/LauncherBays';
import { ConfigSnapshot, KNOBS, KnobContext, applyKnob, restoreConfig, snapshotConfig } from '../sim/Knobs';

export type TutorialStep = 'aim' | 'lock' | 'boom';
export const TUTORIAL_STEPS: TutorialStep[] = ['aim', 'lock', 'boom'];

/**
 * The colours, by kind, at the three-colour palette the tutorial forces.
 *
 * The step 1 target is a colour the deck never deals, so the first hit can only
 * knock it. Step 2 builds in `A`, and step 3 throws `B` at the result.
 */
const KIND_A = 0;
const KIND_B = 1;
const KIND_LONE = 2;

/** How big the group has to get in step 2. */
export const LOCK_GOAL = 4;

/**
 * The strength each step teaches, and the one its hint aims with.
 *
 * Soft for the first two: a hard same-colour hit still locks, but it can knock
 * the group into a wall and away. Deep red for the boom, and **not** just red:
 * the arrow turns red when the ball *leaves* fast enough to boom, and it loses
 * speed to drag on the way. Measured on the real loop, a throw at the threshold
 * never booms a group anywhere on the field, on any of three screens; it takes
 * 10% more at 30% of the way up and 21-24% more at 55%. So step 3 cannot say
 * "until the arrow turns red", and `tests/game/Tutorial.test.ts` holds the
 * wording to that measurement.
 */
export const TEACH_STRENGTH: Record<TutorialStep, number> = { aim: 0.3, lock: 0.3, boom: 0.7 };

/**
 * Seconds between a step being met and the next one starting: long enough to
 * see what just happened, and to read the word that marks it.
 */
export const STEP_BEAT = 1.4;

/**
 * Rain is suppressed by an interval no tutorial will reach. `rainInterval` 0
 * means automatic rain, not none, and automatic rain fires on a sparse field,
 * which is exactly what a tutorial board is.
 */
const NO_RAIN = 1e9;

/** A group moving slower than this, in px/s, has not been hit. */
const STRUCK_SPEED = 5;

/**
 * A step's board: an anchor as a fraction of the field, and each ball as an
 * offset from it in ball radii, so the shape holds on any screen. `fy` is
 * measured from the top; the player's launcher is at the bottom.
 */
interface Layout {
  fx: number;
  fy: number;
  balls: { dx: number; dy: number; kind: number }[];
  /** Pairs of indices into `balls` that start bonded. */
  bonds: [number, number][];
}

/**
 * Spacing between bonded neighbours, in radii. `fits` refuses a ball closer
 * than 2R + 0.5px to another, so a touching pair has to sit just over 2R apart.
 */
const TOUCH = 2.06;

export const TUTORIAL_LAYOUTS: Record<TutorialStep, Layout> = {
  // One lone ball about 40% of the way up the field and off-centre, so a
  // straight-up throw misses and the player has to aim.
  aim: { fx: 0.66, fy: 0.6, balls: [{ dx: 0, dy: 0, kind: KIND_LONE }], bonds: [] },
  // A bonded pair, central and a little below the middle. Step 3 booms the
  // group built here without moving it, so this height is chosen for step 3.
  // Measured on the real loop at `TEACH_STRENGTH.boom`, the unbroken run of
  // booming aim angles is 21 / 7 / 11 degrees (380x620 / 768x1024 / 1280x720)
  // 38% of the way up, against 13 / 7 / 11 at 55% up: the phone gains, the
  // others hold. The weakest booming throw also drops from 21-24% over the red
  // threshold to 14-17%.
  lock: {
    fx: 0.5, fy: 0.62,
    balls: [{ dx: -TOUCH / 2, dy: 0, kind: KIND_A }, { dx: TOUCH / 2, dy: 0, kind: KIND_A }],
    bonds: [[0, 1]],
  },
  // Only used when step 2's group did not survive, or when step 3 is entered
  // directly: a diamond of four, the size step 2 builds.
  boom: {
    fx: 0.5, fy: 0.62,
    balls: [
      { dx: -TOUCH / 2, dy: 0, kind: KIND_A },
      { dx: TOUCH / 2, dy: 0, kind: KIND_A },
      { dx: 0, dy: -TOUCH * 0.866, kind: KIND_A },
      { dx: 0, dy: TOUCH * 0.866, kind: KIND_A },
    ],
    bonds: [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3]],
  },
};

const DECKS: Record<TutorialStep, number> = { aim: KIND_A, lock: KIND_A, boom: KIND_B };

/** What happened this frame that the page may want to say something about. */
export type TutorialEvent =
  | { type: 'step'; step: TutorialStep }
  | { type: 'touched' }
  | { type: 'firstLock' }
  | { type: 'tooHard' }
  | { type: 'peel' }
  | { type: 'respawn'; step: TutorialStep }
  | { type: 'stepDone'; step: TutorialStep; lockPts: number; boomPts: number }
  | { type: 'finished' };

interface Counters {
  locks: number;
  booms: number;
  peels: number;
  lockPts: number;
  boomPts: number;
}

export interface Tutorial {
  step: TutorialStep | 'done';
  /** The player has touched the field; releases the step 1 launcher hold. */
  touched: boolean;
  /** The balls the current step is about, by id: what the page highlights. */
  targetIds: number[];
  /** Throws since the current step began. */
  throws: number;
  /** Counts down once a step is met; the next step starts at zero. */
  beat: number;
  /** What the lock step paid, carried to the boom step's card. */
  lockPtsEarned: number;
  firstLockSeen: boolean;
  base: Counters;
  /** Everything `endTutorial` puts back. */
  saved: {
    config: ConfigSnapshot;
    matchLen: number;
    reloadTime: number;
    rainInterval: number;
    rainTimer: number;
    twoPlayer: boolean;
    aiOn: boolean;
  };
  /** Events since the page last drained them. */
  events: TutorialEvent[];
}

function counters(game: Game): Counters {
  const p = game.players[0];
  return { locks: p.locks, booms: p.booms, peels: p.peels, lockPts: p.lockPts, boomPts: p.boomPts };
}

function deckCard(kind: number): BallOnDeck {
  return { kind, color: colorOfKind(kind), special: null };
}

/**
 * Deal the step's colour into every slot of player 1's deck.
 *
 * Only a slot holding the wrong colour is replaced, so a correct card keeps its
 * identity and the strip's chips are not repainted every frame. `drawFor` is
 * never touched: the normal game's draw is exactly as it was.
 */
function enforceDeck(tut: Tutorial, game: Game) {
  if (tut.step === 'done') return;
  const kind = DECKS[tut.step];
  const p = game.players[0];
  for (const slot of ['loaded', 'nextUp', 'then'] as const) {
    const c = p[slot];
    if (!c || c.special || c.kind !== kind) p[slot] = deckCard(kind);
  }
}

/** Remove every ball not in `keep`, and any bond reaching one that is removed. */
function clearExcept(game: Game, keep: Set<number>) {
  const gone = game.balls.filter(b => !keep.has(b.id));
  if (!gone.length) return;
  for (const b of gone) {
    game.byId.delete(b.id);
    game.flashes.push({ x: b.x, y: b.y, t: 0, kind: 'spawn' });
  }
  game.balls = game.balls.filter(b => keep.has(b.id));
  for (const b of game.balls) for (const id of [...b.bonds]) if (!keep.has(id)) b.bonds.delete(id);
  game.groups = rebuildGroups(game.balls, game.byId);
}

/**
 * Lay out a step's board and return the new balls' ids, in layout order.
 *
 * A ball that will not fit (something already there) is skipped rather than
 * forced; the caller clears the field first, so on a real board that only
 * happens if the layout itself overlaps, which the tests would catch.
 */
function layOut(game: Game, layout: Layout, width: number, height: number): number[] {
  const R = PhysicsConfig.R;
  const ids: number[] = [];
  for (const b of layout.balls) {
    const x = layout.fx * width + b.dx * R;
    const y = layout.fy * height + b.dy * R;
    const before = game.nextId;
    const ok = spawn(game, x, y, 0, 0,
      { dir: 0, speed: 0, kind: b.kind, color: colorOfKind(b.kind), special: null }, width, height);
    ids.push(ok ? before : -1);
  }
  for (const [i, j] of layout.bonds) {
    const a = game.byId.get(ids[i]), c = game.byId.get(ids[j]);
    if (a && c) { a.bonds.add(c.id); c.bonds.add(a.id); }
  }
  game.groups = rebuildGroups(game.balls, game.byId);
  return ids.filter(id => id >= 0);
}

/** The group the step is about, found through its first surviving target. */
function targetGroup(tut: Tutorial, game: Game) {
  for (const id of tut.targetIds) {
    const b = game.byId.get(id);
    if (b) return b.group;
  }
  return null;
}

/**
 * Start `step`. Everything on the field but the balls in `keep` is cleared, and
 * the step's layout is placed unless `keep` already holds its target.
 */
export function beginStep(tut: Tutorial, game: Game, step: TutorialStep, width: number, height: number, keep: number[] = []) {
  tut.step = step;
  tut.throws = 0;
  tut.beat = 0;
  tut.firstLockSeen = false;
  clearExcept(game, new Set(keep));
  tut.targetIds = keep.length ? keep : layOut(game, TUTORIAL_LAYOUTS[step], width, height);
  tut.base = counters(game);
  enforceDeck(tut, game);
  tut.events.push({ type: 'step', step });
}

/**
 * Enter the tutorial on `game`: a solo field, the gameplay knobs at their
 * defaults, no match clock and no rain, and step 1 laid out.
 *
 * Gameplay knobs are forced because a player who has moved them in Options
 * could make a step impossible — with `boom` at 100% nothing booms at all. Knobs
 * marked `cosmetic` (sound, ball numbers, the damage panel) are left alone: they
 * cannot break a step, and resetting someone's volume to teach them is rude.
 * `endTutorial` restores all of it.
 */
export function startTutorial(game: Game, width: number, height: number, first: TutorialStep = 'aim'): Tutorial {
  const tut: Tutorial = {
    step: first,
    touched: false,
    targetIds: [],
    throws: 0,
    beat: 0,
    lockPtsEarned: 0,
    firstLockSeen: false,
    base: counters(game),
    saved: {
      config: snapshotConfig(),
      matchLen: game.matchLen,
      reloadTime: game.reloadTime,
      rainInterval: game.rainInterval,
      rainTimer: game.rainTimer,
      twoPlayer: game.twoPlayer,
      aiOn: game.aiOn,
    },
    events: [],
  };

  const ctx: KnobContext = { game, height };
  for (const def of Object.values(KNOBS)) {
    if (!def.cosmetic) applyKnob(def, def.default, ctx);
  }
  // Specials would deal a black or white into a step that is about colours.
  applyKnob(KNOBS.specials, 0, ctx);

  game.twoPlayer = false;
  game.aiOn = false;
  resetField(game);
  game.matchLen = 0;
  game.rainInterval = NO_RAIN;
  startMatch(game, 0);

  beginStep(tut, game, first, width, height);
  return tut;
}

/** Put back everything `startTutorial` changed. The field is left to the caller. */
export function endTutorial(tut: Tutorial, game: Game) {
  restoreConfig(tut.saved.config);
  game.matchLen = tut.saved.matchLen;
  game.reloadTime = tut.saved.reloadTime;
  game.rainInterval = tut.saved.rainInterval;
  game.rainTimer = tut.saved.rainTimer;
  game.twoPlayer = tut.saved.twoPlayer;
  game.aiOn = tut.saved.aiOn;
}

/** The player's first touch: the step 1 launcher starts reloading. */
export function noteTouch(tut: Tutorial) {
  if (tut.touched) return;
  tut.touched = true;
  tut.events.push({ type: 'touched' });
}

/**
 * Run before `advanceFrame`.
 *
 * Holds the launcher full in step 1 until the player has touched the field, so
 * the first ball to fly is always one they aimed, and keeps the deck dealt.
 */
export function tutorialBeforeFrame(tut: Tutorial, game: Game) {
  if (tut.step === 'done') return;
  const p = game.players[0];
  if (tut.step === 'aim' && !tut.touched) p.reload = game.reloadTime;
  // Between steps nothing should fly into the next board before it is laid.
  if (tut.beat > 0) p.reload = Math.max(p.reload, Math.min(game.reloadTime, tut.beat + 0.5));
  enforceDeck(tut, game);
}

/**
 * Run after `advanceFrame`, with its `dt` and `threw`.
 *
 * Reads what the frame did against the step's goal, and starts the next step
 * once the beat after a success has run out.
 */
export function tutorialAfterFrame(tut: Tutorial, game: Game, width: number, height: number, dt: number, threw: number) {
  if (tut.step === 'done') return;
  enforceDeck(tut, game);
  const p = game.players[0];
  const now = counters(game);

  if (tut.beat > 0) {
    tut.beat -= dt;
    if (tut.beat > 0) return;
    if (tut.step === 'aim') beginStep(tut, game, 'lock', width, height);
    else if (tut.step === 'lock') {
      // Read the group again now rather than at the moment it reached four: a
      // ball still in flight during the beat may have locked on since, and it
      // belongs to the group the player built. An empty list lays out a fresh
      // group of four instead.
      const built = targetGroup(tut, game);
      beginStep(tut, game, 'boom', width, height, built ? built.members.map(m => m.id) : []);
    } else { tut.step = 'done'; tut.events.push({ type: 'finished' }); }
    return;
  }

  if (threw > 0) {
    tut.throws += threw;
    if (tut.step === 'lock' && boomsOnImpact(p, false)) tut.events.push({ type: 'tooHard' });
  }

  const g = targetGroup(tut, game);

  if (tut.step === 'aim') {
    if (!g) { beginStep(tut, game, 'aim', width, height); tut.events.push({ type: 'respawn', step: 'aim' }); return; }
    if (Math.hypot(g.vx, g.vy) > STRUCK_SPEED) succeed(tut, now);
    return;
  }

  if (tut.step === 'lock') {
    const size = g ? g.members.length : 0;
    if (size < 2) { beginStep(tut, game, 'lock', width, height); tut.events.push({ type: 'respawn', step: 'lock' }); return; }
    if (size > 2 && !tut.firstLockSeen) { tut.firstLockSeen = true; tut.events.push({ type: 'firstLock' }); }
    if (size >= LOCK_GOAL) {
      tut.lockPtsEarned = now.lockPts - tut.base.lockPts;
      // Step 3 booms this exact group, so it is kept by id: every member, not
      // only the pair the step started with.
      tut.targetIds = g!.members.map(m => m.id);
      succeed(tut, now);
    }
    return;
  }

  // boom
  if (now.booms > tut.base.booms) { succeed(tut, now); return; }
  if (now.peels > tut.base.peels) { tut.base.peels = now.peels; tut.events.push({ type: 'peel' }); }
  const size = g ? g.members.filter(m => !m.ghost).length : 0;
  if (size < 2) { beginStep(tut, game, 'boom', width, height); tut.events.push({ type: 'respawn', step: 'boom' }); }
}

function succeed(tut: Tutorial, now: Counters) {
  if (tut.step === 'done') return;
  tut.beat = STEP_BEAT;
  tut.events.push({
    type: 'stepDone',
    step: tut.step,
    lockPts: tut.step === 'boom' ? tut.lockPtsEarned : now.lockPts - tut.base.lockPts,
    boomPts: now.boomPts - tut.base.boomPts,
  });
}

/** Hand the page this frame's events and forget them. */
export function drainTutorialEvents(tut: Tutorial): TutorialEvent[] {
  const out = tut.events;
  tut.events = [];
  return out;
}
