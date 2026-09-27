import { describe, it, expect, beforeAll } from 'vitest';
import { createGame, Game } from '../../src/game/GameState';
import { advanceFrame, FALLBACK_DT } from '../../src/sim/Frame';
import { PhysicsConfig, recalcThresholds } from '../../src/physics/Config';
import { withSeed } from '../../src/sim/Rng';
import { snapshotConfig, restoreConfig, applyKnobs } from '../../src/sim/Knobs';
import { AudioStore } from '../../src/audio/SynthEngine';
import { SPECIALS } from '../../src/game/Rules';
import { aimAt, boomHeatOf, boomsOnImpact } from '../../src/physics/LauncherBays';
import {
  Tutorial, TutorialEvent, TutorialStep, LOCK_GOAL, TEACH_STRENGTH, TUTORIAL_LAYOUTS,
  startTutorial, endTutorial, noteTouch, tutorialBeforeFrame, tutorialAfterFrame, drainTutorialEvents,
} from '../../src/game/Tutorial';

/**
 * The tutorial is only worth shipping if every step can be won, on every
 * screen, with the throw it tells the player to make. These tests drive it on
 * the real `advanceFrame`, the way the page does, and measure that.
 */

const SCREENS: [number, number][] = [[380, 620], [768, 1024], [1280, 720]];

beforeAll(() => { AudioStore.soundOn = false; });

/** One frame, in the order the page runs it. */
function step(tut: Tutorial, game: Game, W: number, H: number, clock: number) {
  tutorialBeforeFrame(tut, game);
  const r = advanceFrame(game, FALLBACK_DT, W, H, clock);
  tutorialAfterFrame(tut, game, W, H, r.dt, r.threw);
  return r;
}

/** Run `fn` against a fresh tutorial and put every piece of config back after. */
function withTutorial<T>(W: number, H: number, first: TutorialStep, fn: (tut: Tutorial, game: Game) => T): T {
  const snap = snapshotConfig();
  try {
    return withSeed(1, () => {
      recalcThresholds(H);
      const game = createGame();
      const tut = startTutorial(game, W, H, first);
      try { return fn(tut, game); } finally { endTutorial(tut, game); }
    });
  } finally {
    restoreConfig(snap);
  }
}

function centreOf(tut: Tutorial, game: Game) {
  const bs = tut.targetIds.map(id => game.byId.get(id)!).filter(Boolean);
  return { x: bs.reduce((a, b) => a + b.x, 0) / bs.length, y: bs.reduce((a, b) => a + b.y, 0) / bs.length };
}

/** The aim angle that points straight at the step's target. */
function targetDeg(W: number, H: number, s: TutorialStep): number {
  return withTutorial(W, H, s, (tut, game) => {
    const c = centreOf(tut, game);
    aimAt(game.players[0], c.x, c.y, W, H, false);
    return game.players[0].aimDeg;
  });
}

/** The weakest strength at which the arrow turns red. */
function redStrength(W: number, H: number): number {
  return withTutorial(W, H, 'boom', (_tut, game) => {
    const p = game.players[0];
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; p.strength = m; if (boomsOnImpact(p, false)) hi = m; else lo = m; }
    return hi;
  });
}

/**
 * One throw at `aimDeg` and `strength` into a fresh copy of the step, and
 * whether it did what the step asks. For the lock step that is one lock, since
 * the step itself needs two.
 */
function oneThrow(W: number, H: number, s: TutorialStep, aimDeg: number, strength: number): boolean {
  return withTutorial(W, H, s, (tut, game) => {
    noteTouch(tut);
    const p = game.players[0];
    p.reload = 0;
    let clock = 0, thrownAt = -1;
    for (let f = 0; f < 60 * 6; f++) {
      if (thrownAt >= 0) p.reload = 99;
      p.aimDeg = aimDeg; p.strength = strength;
      const r = step(tut, game, W, H, clock);
      clock = r.clock;
      if (r.threw && thrownAt < 0) thrownAt = f;
      for (const e of drainTutorialEvents(tut)) {
        if (e.type === 'stepDone' && e.step === s) return true;
        if (s === 'lock' && e.type === 'firstLock') return true;
      }
      if (thrownAt >= 0 && f - thrownAt > 60 * 4) return false;
    }
    return false;
  });
}

/** The width, in whole degrees, of the unbroken run of winning angles around the target. */
function windowWidth(W: number, H: number, s: TutorialStep, strength: number): number {
  const centre = Math.round(targetDeg(W, H, s));
  if (!oneThrow(W, H, s, centre, strength)) return 0;
  let lo = centre, hi = centre;
  while (lo - 1 >= centre - 30 && oneThrow(W, H, s, lo - 1, strength)) lo--;
  while (hi + 1 <= centre + 30 && oneThrow(W, H, s, hi + 1, strength)) hi++;
  return hi - lo + 1;
}

describe('every step can be won with the throw it teaches', () => {
  for (const [W, H] of SCREENS) {
    for (const s of ['aim', 'lock', 'boom'] as TutorialStep[]) {
      it(`${s} at ${W}x${H}: a window several degrees wide at strength ${TEACH_STRENGTH[s]}`, () => {
        const width = windowWidth(W, H, s, TEACH_STRENGTH[s]);
        // A few degrees is what a first-time player's drag can hold. Measured
        // at the time of writing (380x620 / 768x1024 / 1280x720): aim 13/8/8,
        // lock 21/11/17, boom 17/11/17. The tablet's are the tightest.
        expect(width, `${s} window at ${W}x${H}`).toBeGreaterThanOrEqual(5);
      });
    }
  }
});

describe('step 3 teaches deep red, not just red', () => {
  // The arrow turns red when a throw *leaves* fast enough to boom, and the ball
  // loses speed on its way to the group. If this ever starts booming, the arrow
  // has learned about distance and the step 3 wording can say "red" again.
  for (const [W, H] of SCREENS) {
    it(`a throw at the red threshold does not boom the group at ${W}x${H}`, () => {
      const red = redStrength(W, H);
      expect(oneThrow(W, H, 'boom', Math.round(targetDeg(W, H, 'boom')), red * 1.01)).toBe(false);
    });

    it(`a deep red throw does, well inside the strength the step teaches, at ${W}x${H}`, () => {
      const red = redStrength(W, H);
      // Measured: the weakest booming throw is 14-17% over the threshold here.
      // The step teaches 0.85, far past both.
      expect(TEACH_STRENGTH.boom).toBeGreaterThan(red * 1.5);
      expect(oneThrow(W, H, 'boom', Math.round(targetDeg(W, H, 'boom')), red * 1.3)).toBe(true);
    });
  }
});

describe('the words match the arrow', () => {
  it('shows a deep red arrow at the strength step 3 teaches', () => {
    // "Deep red" has to be what the player sees: the arrow runs from white at
    // the boom threshold (heat 0) to pure red at full strength (heat 1).
    withTutorial(380, 620, 'boom', (_tut, game) => {
      const p = game.players[0];
      p.strength = TEACH_STRENGTH.boom;
      expect(boomHeatOf(p, false)).toBeGreaterThanOrEqual(0.7);
    });
  });
});

describe('step 3 starts where it was measured', () => {
  for (const [W, H] of SCREENS) {
    it(`the group built in step 2 is carried back to the step 3 anchor at ${W}x${H}`, () => {
      withTutorial(W, H, 'lock', (tut, game) => {
        noteTouch(tut);
        let clock = 0;
        for (let f = 0; f < 60 * 60 && tut.step !== 'boom'; f++) {
          const c = centreOf(tut, game);
          aimAt(game.players[0], c.x, c.y, W, H, false);
          game.players[0].strength = TEACH_STRENGTH.lock;
          clock = step(tut, game, W, H, clock).clock;
        }
        expect(tut.step).toBe('boom');
        const c = centreOf(tut, game);
        const R = PhysicsConfig.R;
        expect(Math.abs(c.x - TUTORIAL_LAYOUTS.boom.fx * W), 'x').toBeLessThan(R * 1.5);
        expect(Math.abs(c.y - TUTORIAL_LAYOUTS.boom.fy * H), 'y').toBeLessThan(R * 1.5);
        const g = game.byId.get(tut.targetIds[0])!.group;
        expect(Math.hypot(g.vx, g.vy)).toBe(0);
      });
    });
  }
});

describe('the whole tutorial, played by aiming at the target', () => {
  for (const [W, H] of SCREENS) {
    it(`finishes all three steps at ${W}x${H}`, () => {
      const seen = withTutorial(W, H, 'aim', (tut, game) => {
        const events: TutorialEvent[] = [];
        let clock = 0;
        noteTouch(tut);
        for (let f = 0; f < 60 * 90 && tut.step !== 'done'; f++) {
          if (tut.step !== 'done' && tut.targetIds.length) {
            const c = centreOf(tut, game);
            const p = game.players[0];
            aimAt(p, c.x, c.y, W, H, false);
            p.strength = TEACH_STRENGTH[tut.step];
          }
          clock = step(tut, game, W, H, clock).clock;
          events.push(...drainTutorialEvents(tut));
        }
        return { done: tut.step === 'done', events };
      });
      expect(seen.done).toBe(true);
      const kinds = seen.events.map(e => e.type);
      expect(kinds.filter(k => k === 'stepDone')).toHaveLength(3);
      expect(kinds[kinds.length - 1]).toBe('finished');
      // The card after step 3 quotes what building and booming really paid.
      const boom = seen.events.find(e => e.type === 'stepDone' && e.step === 'boom') as Extract<TutorialEvent, { type: 'stepDone' }>;
      expect(boom.lockPts).toBeGreaterThan(0);
      expect(boom.boomPts).toBeGreaterThan(boom.lockPts);
    });
  }
});

describe('the tutorial runs beside the game without changing it', () => {
  it('holds the first ball until the player touches the field', () => {
    withTutorial(380, 620, 'aim', (tut, game) => {
      let clock = 0, threw = 0;
      for (let f = 0; f < 60 * 10; f++) {
        const r = step(tut, game, 380, 620, clock); clock = r.clock; threw += r.threw;
      }
      expect(threw).toBe(0);
      noteTouch(tut);
      for (let f = 0; f < 60 * 4; f++) {
        const r = step(tut, game, 380, 620, clock); clock = r.clock; threw += r.threw;
      }
      expect(threw).toBe(1);
    });
  });

  it('deals the step colour into every slot, and never a special', () => {
    withTutorial(380, 620, 'lock', (tut, game) => {
      noteTouch(tut);
      let clock = 0;
      const kinds = new Set<number>();
      for (let f = 0; f < 60 * 12; f++) {
        clock = step(tut, game, 380, 620, clock).clock;
        const p = game.players[0];
        for (const c of [p.loaded, p.nextUp, p.then]) { expect(c!.special).toBeNull(); kinds.add(c!.kind); }
        if (tut.step !== 'lock') break;
      }
      expect(kinds.size).toBe(1);
    });
  });

  it('forces the gameplay knobs and puts every one back, without touching sound', () => {
    const snap = snapshotConfig();
    try {
      const game = createGame();
      applyKnobs({ boom: 1.0, specials: 1, vol: 0.4 }, { game, height: 620 });
      const boomAt = PhysicsConfig.BOOM_AT;
      const tut = startTutorial(game, 380, 620);
      // A boom threshold at 100% would make step 3 impossible, and specials
      // would deal a black or white into a step about colours.
      expect(PhysicsConfig.BOOM_AT).toBe(0.4);
      expect(SPECIALS).toBe(false);
      expect(AudioStore.volume).toBe(0.4);
      expect(game.matchLen).toBe(0);
      endTutorial(tut, game);
      expect(PhysicsConfig.BOOM_AT).toBe(boomAt);
      expect(SPECIALS).toBe(true);
      expect(AudioStore.volume).toBe(0.4);
      expect(game.matchLen).toBe(120);
    } finally {
      restoreConfig(snap);
    }
  });

  it('builds on the group from step 2 rather than laying a new one', () => {
    withTutorial(380, 620, 'lock', (tut, game) => {
      noteTouch(tut);
      let clock = 0;
      let built: number[] = [];
      for (let f = 0; f < 60 * 60 && tut.step !== 'boom'; f++) {
        const c = centreOf(tut, game);
        aimAt(game.players[0], c.x, c.y, 380, 620, false);
        game.players[0].strength = TEACH_STRENGTH.lock;
        clock = step(tut, game, 380, 620, clock).clock;
        if (tut.beat > 0) built = game.byId.get(tut.targetIds[0])!.group.members.map(m => m.id);
      }
      expect(tut.step).toBe('boom');
      expect(built.length).toBeGreaterThanOrEqual(LOCK_GOAL);
      for (const id of built) expect(tut.targetIds).toContain(id);
    });
  });
});
