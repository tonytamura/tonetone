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
 * Design: the Tutorial: Design page in Notion. Five steps, each a small goal
 * met with the real launcher: hit a ball, build a group of four, boom it, lock
 * a black onto something, and boom that with a white.
 */
import { Game, resetField, spawn, startMatch } from './GameState';
import { colorOfKind } from './Rules';
import { BLACK_HEX, WHITE_HEX } from '../graphics/Palette';
import { PhysicsConfig } from '../physics/Config';
import { BallOnDeck, SpecialBallType } from '../physics/Types';
import { rebuildGroups } from '../physics/RigidBody';
import { boomsOnImpact } from '../physics/LauncherBays';
import { ConfigSnapshot, KNOBS, KnobContext, applyKnob, restoreConfig, snapshotConfig } from '../sim/Knobs';

export type TutorialStep = 'aim' | 'lock' | 'boom' | 'black' | 'white';
export const TUTORIAL_STEPS: TutorialStep[] = ['aim', 'lock', 'boom', 'black', 'white'];

/**
 * The colours, by kind, at the three-colour palette the tutorial forces.
 *
 * The step 1 target is a colour the deck never deals, so the first hit can only
 * knock it. Step 2 builds in `A`, and step 3 throws `B` at the result. The
 * black step gives the black something that is neither, to show it does not
 * care what it touches.
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
 *
 * 0.85 rather than 0.7 because it has to match the words. The arrow reddens
 * from white at the threshold to pure red at full strength, and at 0.7 it is
 * a salmon pink (#ff8787); "deep red" is where it reaches #ff4848, at 0.85.
 *
 * Soft again for black and white: black sticks to whatever it touches at any
 * speed, and white booms whatever it touches at any speed, and both lessons
 * are better learned from a gentle throw that still works.
 */
export const TEACH_STRENGTH: Record<TutorialStep, number> = { aim: 0.3, lock: 0.3, boom: 0.85, black: 0.3, white: 0.3 };

/**
 * Seconds between a step being met and the next one starting: long enough to
 * see what just happened and read the line that marks it. Longer after the
 * boom, whose line quotes what it paid, and after the last step.
 */
export const STEP_BEAT: Record<TutorialStep, number> = { aim: 2.2, lock: 2.2, boom: 3.4, black: 2.6, white: 2.8 };

/**
 * Seconds after a throw that changed nothing before the step says so and asks
 * for another. Long enough for the ball to reach its target and settle.
 */
export const AGAIN_AFTER = 2.5;

/**
 * Rain is suppressed by an interval no tutorial will reach. `rainInterval` 0
 * means automatic rain, not none, and automatic rain fires on a sparse field,
 * which is exactly what a tutorial board is.
 */
const NO_RAIN = 1e9;

/** A group moving slower than this, in px/s, has not been hit. */
const STRUCK_SPEED = 5;

interface LayoutBall {
  dx: number;
  dy: number;
  kind: number;
  special?: SpecialBallType;
}

/**
 * A step's board: an anchor as a fraction of the field, and each ball as an
 * offset from it in ball radii, so the shape holds on any screen. `fy` is
 * measured from the top; the player's launcher is at the bottom.
 */
interface Layout {
  fx: number;
  fy: number;
  balls: LayoutBall[];
  /** Pairs of indices into `balls` that start bonded. */
  bonds: [number, number][];
}

/**
 * Spacing between bonded neighbours, in radii. `fits` refuses a ball closer
 * than 2R + 0.5px to another, so a touching pair has to sit just over 2R apart.
 */
const TOUCH = 2.06;

const PAIR = (kind: number): LayoutBall[] => [{ dx: -TOUCH / 2, dy: 0, kind }, { dx: TOUCH / 2, dy: 0, kind }];

export const TUTORIAL_LAYOUTS: Record<TutorialStep, Layout> = {
  // One lone ball about 40% of the way up the field and off-centre, so a
  // straight-up throw misses and the player has to aim.
  aim: { fx: 0.66, fy: 0.6, balls: [{ dx: 0, dy: 0, kind: KIND_LONE }], bonds: [] },
  // A bonded pair, central and a little below the middle. Step 3 booms the
  // group built here (glided back here after the step, see `glideHome`), so
  // this height is chosen for step 3. Measured on the real loop at strength
  // 0.7, the unbroken run of booming aim angles is 21 / 7 / 11 degrees
  // (380x620 / 768x1024 / 1280x720) 38% of the way up, against 13 / 7 / 11 at
  // 55% up, and the weakest booming throw drops from 21-24% over the red
  // threshold to 14-17%. At the 0.85 step 3 teaches it is 17 / 11 / 17.
  lock: { fx: 0.5, fy: 0.62, balls: PAIR(KIND_A), bonds: [[0, 1]] },
  // Only used when step 2's group did not survive, or when step 3 is entered
  // directly: a diamond of four, the size step 2 builds.
  boom: {
    fx: 0.5, fy: 0.62,
    balls: [
      ...PAIR(KIND_A),
      { dx: 0, dy: -TOUCH * 0.866, kind: KIND_A },
      { dx: 0, dy: TOUCH * 0.866, kind: KIND_A },
    ],
    bonds: [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3]],
  },
  // A pair in a colour the black is not, for it to stick to anyway.
  black: { fx: 0.5, fy: 0.62, balls: PAIR(KIND_LONE), bonds: [[0, 1]] },
  // The white booms what the black step built, glided back here. Laid out
  // only when entered directly: the same pair with a black already on it.
  white: {
    fx: 0.5, fy: 0.62,
    balls: [...PAIR(KIND_LONE), { dx: 0, dy: -TOUCH * 0.866, kind: -1, special: 'black' }],
    bonds: [[0, 1], [0, 2], [1, 2]],
  },
};

/** What each step deals: a colour, or a special ball. */
const DECKS: Record<TutorialStep, { kind: number; special: SpecialBallType }> = {
  aim: { kind: KIND_A, special: null },
  lock: { kind: KIND_A, special: null },
  boom: { kind: KIND_B, special: null },
  black: { kind: -1, special: 'black' },
  white: { kind: -1, special: 'white' },
};

/** The step each step hands on to, and whether it hands on the group it built. */
const NEXT: Record<TutorialStep, { step: TutorialStep | 'done'; keep: boolean }> = {
  aim: { step: 'lock', keep: false },
  lock: { step: 'boom', keep: true },
  boom: { step: 'black', keep: false },
  black: { step: 'white', keep: true },
  white: { step: 'done', keep: false },
};

/** What happened this frame that the page may want to say something about. */
export type TutorialEvent =
  | { type: 'step'; step: TutorialStep }
  | { type: 'touched' }
  | { type: 'firstLock' }
  | { type: 'tooHard' }
  | { type: 'peel' }
  | { type: 'again'; step: TutorialStep }
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
  /** The player has touched the field at least once. */
  touched: boolean;
  /**
   * The player has acted since the last throw, so the next one may fly.
   *
   * The launcher holds full until then, in every step. Left alone, it fired
   * every three seconds at whatever the aim was, and the default aim straight
   * up could win a step for a player who had done nothing. Now nothing happens
   * until the player acts, and a throw that misses waits for them to act again.
   */
  armed: boolean;
  /** The balls the current step is about, by id: what the page highlights. */
  targetIds: number[];
  /** Throws since the current step began. */
  throws: number;
  /** Counts down once a step is met; the next step starts at zero. */
  beat: number;
  /** Seconds since the last throw, while it is still waiting to show an effect; -1 when not. */
  sinceThrow: number;
  /** What the lock step paid, carried to the boom step's line. */
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

function deckCard(step: TutorialStep): BallOnDeck {
  const { kind, special } = DECKS[step];
  if (special) return { kind: -1, special, color: special === 'black' ? BLACK_HEX : WHITE_HEX };
  return { kind, color: colorOfKind(kind), special: null };
}

/**
 * Deal the step's ball into every slot of player 1's deck.
 *
 * Only a slot holding the wrong ball is replaced, so a correct card keeps its
 * identity and the strip's chips are not repainted every frame. `drawFor` is
 * never touched: the normal game's draw is exactly as it was.
 */
function enforceDeck(tut: Tutorial, game: Game) {
  if (tut.step === 'done') return;
  const want = DECKS[tut.step];
  const p = game.players[0];
  for (const slot of ['loaded', 'nextUp', 'then'] as const) {
    const c = p[slot];
    const right = c && c.special === want.special && (want.special || c.kind === want.kind);
    if (!right) p[slot] = deckCard(tut.step);
  }
}

/** Something happened that answers the last throw, so no "try again" is owed. */
function emit(tut: Tutorial, e: TutorialEvent) {
  if (e.type === 'firstLock' || e.type === 'tooHard' || e.type === 'peel' || e.type === 'stepDone') tut.sinceThrow = -1;
  tut.events.push(e);
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
    const special = b.special || null;
    const color = special === 'black' ? BLACK_HEX : special === 'white' ? WHITE_HEX : colorOfKind(b.kind);
    const ok = spawn(game, x, y, 0, 0, { dir: 0, speed: 0, kind: b.kind, color, special }, width, height);
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
    if (b && !b.ghost) return b.group;
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
  tut.sinceThrow = -1;
  tut.firstLockSeen = false;
  // A new board asks for a new action: nothing flies into it by itself.
  tut.armed = false;
  clearExcept(game, new Set(keep));
  tut.targetIds = keep.length ? keep : layOut(game, TUTORIAL_LAYOUTS[step], width, height);
  // A kept group glided here; it starts the step at rest, as a laid-out one does.
  for (const id of keep) {
    const g = game.byId.get(id)?.group;
    if (g) { g.vx = 0; g.vy = 0; g.av = 0; }
  }
  tut.base = counters(game);
  enforceDeck(tut, game);
  emit(tut, { type: 'step', step });
}

/**
 * Enter the tutorial on `game`: a solo field, the gameplay knobs at their
 * defaults, no match clock and no rain, and the first step laid out.
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
    armed: false,
    targetIds: [],
    throws: 0,
    beat: 0,
    sinceThrow: -1,
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
  // The normal draw would deal a black or white into the colour steps. The
  // special steps deal their own, through the scripted deck.
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

/**
 * The player touched or dragged on the field: the next throw may fly once the
 * ring fills. The page calls this for a press and for a drag while pressed.
 */
export function noteTouch(tut: Tutorial) {
  if (tut.step === 'done' || tut.beat > 0) return;
  tut.armed = true;
  if (tut.touched) return;
  tut.touched = true;
  emit(tut, { type: 'touched' });
}

/**
 * Run before `advanceFrame`.
 *
 * Holds the launcher full until the player has acted since the last throw, so
 * every ball that flies is one they aimed, and keeps the deck dealt.
 */
export function tutorialBeforeFrame(tut: Tutorial, game: Game) {
  const p = game.players[0];
  // Finished: the closing card is up, and a ball flying behind it every three
  // seconds would only pull the eye away from it.
  if (tut.step === 'done') { p.reload = game.reloadTime; return; }
  if (!tut.armed || tut.beat > 0) p.reload = game.reloadTime;
  enforceDeck(tut, game);
}

/**
 * Carry a group the player built back to where the next step was measured.
 *
 * Each ball that locks on pushes the group, and two locks can carry it from
 * 62% down the field to a quarter, up under the banner and far past where the
 * boom windows were measured. So during the beat after a building step the
 * same group, the same balls in the same shape, glides back to the next
 * layout's anchor. The steps themselves are left to the physics; only the
 * pause between them is scripted, which is the controller's job.
 */
function glideHome(tut: Tutorial, game: Game, home: Layout, width: number, height: number) {
  const g = targetGroup(tut, game);
  if (!g) return;
  const dx = home.fx * width - g.com.x, dy = home.fy * height - g.com.y;
  // Arrive a little before the beat ends, and settle the spin on the way.
  const t = Math.max(0.12, tut.beat - 0.25);
  g.vx = dx / t;
  g.vy = dy / t;
  g.av *= 0.85;
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
  const step = tut.step;

  if (tut.beat > 0) {
    tut.beat -= dt;
    const next = NEXT[step];
    if (next.keep && next.step !== 'done') glideHome(tut, game, TUTORIAL_LAYOUTS[next.step], width, height);
    if (tut.beat > 0) return;
    if (next.step === 'done') { tut.step = 'done'; emit(tut, { type: 'finished' }); return; }
    // Read the group again now rather than at the moment the step was met: a
    // ball still in flight during the beat may have locked on since, and it
    // belongs to what the player built. An empty list lays the next board out
    // fresh instead.
    const built = next.keep ? targetGroup(tut, game) : null;
    beginStep(tut, game, next.step, width, height, built ? built.members.map(m => m.id) : []);
    return;
  }

  if (threw > 0) {
    tut.throws += threw;
    // The throw has flown, so the next one waits for the player again.
    tut.armed = false;
    tut.sinceThrow = 0;
    if (step === 'lock' && boomsOnImpact(p, false)) emit(tut, { type: 'tooHard' });
  } else if (tut.sinceThrow >= 0) {
    tut.sinceThrow += dt;
    if (tut.sinceThrow >= AGAIN_AFTER) {
      tut.sinceThrow = -1;
      // Only if they have not already started the next try.
      if (!tut.armed) emit(tut, { type: 'again', step });
    }
  }

  const g = targetGroup(tut, game);

  if (step === 'aim') {
    if (!g) { respawn(tut, game, width, height); return; }
    if (Math.hypot(g.vx, g.vy) > STRUCK_SPEED) succeed(tut, now);
    return;
  }

  if (step === 'lock') {
    const size = g ? g.members.length : 0;
    if (size < 2) { respawn(tut, game, width, height); return; }
    if (size > 2 && !tut.firstLockSeen) { tut.firstLockSeen = true; emit(tut, { type: 'firstLock' }); }
    if (size >= LOCK_GOAL) {
      tut.lockPtsEarned = now.lockPts - tut.base.lockPts;
      succeed(tut, now);
    }
    return;
  }

  if (step === 'black') {
    if (!g) { respawn(tut, game, width, height); return; }
    if (g.members.some(m => m.special === 'black' && !m.ghost)) succeed(tut, now);
    return;
  }

  // boom and white: the group has to go.
  if (now.booms > tut.base.booms) { succeed(tut, now); return; }
  if (now.peels > tut.base.peels) { tut.base.peels = now.peels; emit(tut, { type: 'peel' }); }
  const size = g ? g.members.filter(m => !m.ghost).length : 0;
  if (size < 2) respawn(tut, game, width, height);
}

/** Lay the current step out again, and say so. */
function respawn(tut: Tutorial, game: Game, width: number, height: number) {
  if (tut.step === 'done') return;
  const step = tut.step;
  beginStep(tut, game, step, width, height);
  emit(tut, { type: 'respawn', step });
}

function succeed(tut: Tutorial, now: Counters) {
  if (tut.step === 'done') return;
  tut.beat = STEP_BEAT[tut.step];
  tut.armed = false;
  emit(tut, {
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
