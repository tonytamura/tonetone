import { describe, it, expect, beforeAll } from 'vitest';
import { createGame, Game } from '../../src/game/GameState';
import { advanceFrame, FALLBACK_DT } from '../../src/sim/Frame';
import { PhysicsConfig, recalcThresholds } from '../../src/physics/Config';
import { withSeed } from '../../src/sim/Rng';
import { snapshotConfig, restoreConfig, applyKnobs } from '../../src/sim/Knobs';
import { AudioStore } from '../../src/audio/SynthEngine';
import { SPECIALS } from '../../src/game/Rules';
import { aimAt, boomHeatOf, boomsOnImpact, launchPointOf } from '../../src/physics/LauncherBays';
import { spawn } from '../../src/game/GameState';
import { shiftGroup } from '../../src/physics/RigidBody';
import {
  Tutorial, TutorialEvent, TutorialStep, LOCK_GOAL, TEACH_STRENGTH, TUTORIAL_LAYOUTS, TUTORIAL_STEPS, AGAIN_AFTER,
  HINT_AFTER, STRAY_CAP, BANNER_INSET,
  startTutorial, endTutorial, noteTouch, tutorialBeforeFrame, tutorialAfterFrame, drainTutorialEvents,
  targetGroupOf, tutorialHint,
} from '../../src/game/Tutorial';

/**
 * The tutorial is only worth shipping if every step can be won, on every
 * screen, with the throw it tells the player to make — and only by a player
 * who acts. These tests drive it on the real `advanceFrame`, the way the page
 * does, and measure that.
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
    const p = game.players[0];
    p.aimDeg = aimDeg; p.strength = strength;
    noteTouch(tut);
    p.reload = 0;
    let clock = 0, thrownAt = -1;
    for (let f = 0; f < 60 * 6; f++) {
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

/**
 * Play from `first` to the end the way an attentive player would: aim at the
 * ring at the strength the step teaches, and drag again after every throw.
 */
function playThrough(W: number, H: number, first: TutorialStep, until: (tut: Tutorial) => boolean) {
  return withTutorial(W, H, first, (tut, game) => {
    const events: TutorialEvent[] = [];
    let clock = 0;
    for (let f = 0; f < 60 * 180 && !until(tut); f++) {
      if (tut.step !== 'done' && tut.targetIds.length) {
        const c = centreOf(tut, game);
        const p = game.players[0];
        aimAt(p, c.x, c.y, W, H, false);
        p.strength = TEACH_STRENGTH[tut.step];
        if (!tut.armed) noteTouch(tut);
      }
      clock = step(tut, game, W, H, clock).clock;
      events.push(...drainTutorialEvents(tut));
    }
    return { tut, game, events };
  });
}

describe('every step can be won with the throw it teaches', () => {
  for (const [W, H] of SCREENS) {
    for (const s of TUTORIAL_STEPS) {
      it(`${s} at ${W}x${H}: a window several degrees wide at strength ${TEACH_STRENGTH[s]}`, () => {
        const width = windowWidth(W, H, s, TEACH_STRENGTH[s]);
        // A few degrees is what a first-time player's drag can hold. Measured
        // at the time of writing (380x620 / 768x1024 / 1280x720): aim 13/8/8,
        // lock 21/11/17, boom 17/11/17, black 21/11/17, white 21/11/17. The
        // tablet's are the tightest.
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

describe('nothing happens until the player acts', () => {
  for (const s of TUTORIAL_STEPS) {
    it(`${s}: no throw without a touch, and one touch is one throw`, () => {
      withTutorial(380, 620, s, (tut, game) => {
        let clock = 0, threw = 0;
        const run = (seconds: number) => {
          for (let f = 0; f < 60 * seconds; f++) { const r = step(tut, game, 380, 620, clock); clock = r.clock; threw += r.threw; }
        };
        // Left alone at the default aim, straight up, the launcher never fires.
        run(10);
        expect(threw).toBe(0);
        // Aim away from the target so the throw cannot end the step.
        game.players[0].aimDeg = -80;
        noteTouch(tut);
        run(4);
        expect(threw).toBe(1);
        // And having thrown, it waits for the player again.
        run(8);
        expect(threw).toBe(1);
      });
    });
  }

  it('a throw that misses says so, and the step waits', () => {
    withTutorial(380, 620, 'aim', (tut, game) => {
      const p = game.players[0];
      p.aimDeg = -80; p.strength = 0.3;
      noteTouch(tut);
      let clock = 0;
      const events: TutorialEvent[] = [];
      for (let f = 0; f < 60 * (3 + AGAIN_AFTER + 1); f++) {
        clock = step(tut, game, 380, 620, clock).clock;
        events.push(...drainTutorialEvents(tut));
      }
      expect(events.some(e => e.type === 'again' && e.step === 'aim')).toBe(true);
      expect(tut.step).toBe('aim');
    });
  });
});

describe('the whole tutorial, played by aiming at the ring', () => {
  for (const [W, H] of SCREENS) {
    it(`finishes all five steps at ${W}x${H}`, () => {
      const { tut, events } = playThrough(W, H, 'aim', t => t.step === 'done');
      expect(tut.step).toBe('done');
      const done = events.filter(e => e.type === 'stepDone') as Extract<TutorialEvent, { type: 'stepDone' }>[];
      expect(done.map(e => e.step)).toEqual(TUTORIAL_STEPS);
      expect(events[events.length - 1].type).toBe('finished');
      // The boom line quotes what building and booming really paid.
      const boom = done.find(e => e.step === 'boom')!;
      expect(boom.lockPts).toBeGreaterThan(0);
      expect(boom.boomPts).toBeGreaterThan(boom.lockPts);
    });
  }
});

describe('a built group carries into the next step, back where it was measured', () => {
  const cases: [TutorialStep, TutorialStep][] = [['lock', 'boom'], ['black', 'white']];
  for (const [from, to] of cases) {
    for (const [W, H] of SCREENS) {
      it(`${from} -> ${to} at ${W}x${H}`, () => {
        const { tut, game } = playThrough(W, H, from, t => t.step === to);
        expect(tut.step).toBe(to);
        const c = centreOf(tut, game);
        const R = PhysicsConfig.R;
        expect(Math.abs(c.x - TUTORIAL_LAYOUTS[to].fx * W), 'x').toBeLessThan(R * 1.5);
        expect(Math.abs(c.y - TUTORIAL_LAYOUTS[to].fy * H), 'y').toBeLessThan(R * 1.5);
        const g = game.byId.get(tut.targetIds[0])!.group;
        expect(Math.hypot(g.vx, g.vy)).toBe(0);
        if (to === 'boom') expect(tut.targetIds.length).toBeGreaterThanOrEqual(LOCK_GOAL);
        // The white booms the group the black step built, black and all.
        if (to === 'white') expect(g.members.some(m => m.special === 'black')).toBe(true);
      });
    }
  }
});

describe('the tutorial runs beside the game without changing it', () => {
  it('deals each step its own ball in every slot', () => {
    const want: Record<TutorialStep, (c: { kind: number; special: string | null }) => boolean> = {
      aim: c => c.special === null, lock: c => c.special === null, boom: c => c.special === null,
      black: c => c.special === 'black', white: c => c.special === 'white',
    };
    for (const s of TUTORIAL_STEPS) {
      withTutorial(380, 620, s, (tut, game) => {
        tutorialBeforeFrame(tut, game);
        const p = game.players[0];
        const cards = [p.loaded!, p.nextUp!, p.then!];
        for (const c of cards) expect(want[s](c), `${s}: ${JSON.stringify(c)}`).toBe(true);
        expect(new Set(cards.map(c => `${c.kind}/${c.special}`)).size).toBe(1);
      });
    }
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
});

/** Run `frames` frames, collecting events; `each` runs before every frame. */
function run(tut: Tutorial, game: Game, W: number, H: number, frames: number, events: TutorialEvent[], each?: () => void) {
  let threw = 0;
  for (let f = 0; f < frames; f++) {
    each?.();
    const r = step(tut, game, W, H, f / 60);
    threw += r.threw;
    events.push(...drainTutorialEvents(tut));
  }
  return threw;
}

/**
 * One throw that cannot reach the target: as soft as the bay throws, almost
 * sideways, on the side away from it. Then hands off until the step answers.
 */
function miss(tut: Tutorial, game: Game, W: number, H: number, events: TutorialEvent[]) {
  const p = game.players[0];
  const g = targetGroupOf(tut, game)!;
  const away = g.com.x > W / 2 ? -85 : 85;
  p.aimDeg = away; p.strength = 0;
  noteTouch(tut);
  // The ring takes a reload to fill once the player has acted.
  let threw = 0;
  for (let f = 0; f < 60 * 4 && !threw; f++) threw = run(tut, game, W, H, 1, events, () => { p.aimDeg = away; p.strength = 0; });
  expect(threw, 'the miss was thrown').toBe(1);
  run(tut, game, W, H, Math.ceil(AGAIN_AFTER * 60) + 10, events);
}

describe('after a few throws that get nowhere, a hint shows the throw that wins', () => {
  for (const [W, H] of SCREENS) {
    for (const s of TUTORIAL_STEPS) {
      it(`${s} at ${W}x${H}`, () => {
        withTutorial(W, H, s, (tut, game) => {
          const events: TutorialEvent[] = [];
          for (let i = 0; i < HINT_AFTER; i++) miss(tut, game, W, H, events);
          const said = events.filter(e => e.type === 'again' || e.type === 'hint').map(e => e.type);
          // "Not quite" for the first misses, then the hint instead.
          expect(said).toEqual([...Array(HINT_AFTER - 1).fill('again'), 'hint']);
          const hint = tutorialHint(tut, game, W, H);
          expect(hint).not.toBeNull();
          // It starts at the launcher.
          const mouth = launchPointOf(game.players[0], W, H);
          expect(hint!.from).toEqual(mouth);

          // Dragging to where it ends is the throw that wins, and touching
          // takes the hand away.
          const p = game.players[0];
          aimAt(p, hint!.to.x, hint!.to.y, W, H, false);
          expect(p.strength).toBeCloseTo(TEACH_STRENGTH[s], 6);
          noteTouch(tut);
          expect(tutorialHint(tut, game, W, H)).toBeNull();
          const aim = p.aimDeg, strength = p.strength;
          const after: TutorialEvent[] = [];
          run(tut, game, W, H, 60 * 7, after, () => { p.aimDeg = aim; p.strength = strength; });
          const won = after.some(e => (e.type === 'stepDone' && e.step === s) || (s === 'lock' && e.type === 'firstLock'));
          expect(won, `following the hint wins ${s}`).toBe(true);
        });
      });
    }
  }

  it('a throw that locks in step 2 starts the count again', () => {
    withTutorial(380, 620, 'lock', (tut, game) => {
      const events: TutorialEvent[] = [];
      miss(tut, game, 380, 620, events);
      miss(tut, game, 380, 620, events);
      expect(tut.misses).toBe(2);
      const g = targetGroupOf(tut, game)!;
      const p = game.players[0];
      aimAt(p, g.com.x, g.com.y, 380, 620, false);
      p.strength = TEACH_STRENGTH.lock;
      const aim = p.aimDeg;
      noteTouch(tut);
      run(tut, game, 380, 620, 60 * 6, events, () => { p.aimDeg = aim; p.strength = TEACH_STRENGTH.lock; });
      expect(events.some(e => e.type === 'firstLock')).toBe(true);
      expect(tut.misses).toBe(0);
    });
  });
});

describe('the board is kept playable', () => {
  it('takes a missed ball off once it has as good as stopped', () => {
    for (const [W, H] of SCREENS) {
      withTutorial(W, H, 'lock', (tut, game) => {
        const events: TutorialEvent[] = [];
        miss(tut, game, W, H, events);
        run(tut, game, W, H, 60 * 8, events);
        const ids = new Set(targetGroupOf(tut, game)!.members.map(m => m.id));
        expect(game.balls.filter(b => !ids.has(b.id)).length, `${W}x${H}`).toBe(0);
      });
    }
  });

  it(`keeps no more than ${STRAY_CAP} strays, even moving ones, and takes the oldest first`, () => {
    withTutorial(380, 620, 'aim', (tut, game) => {
      const made: number[] = [];
      for (let i = 0; i < STRAY_CAP + 2; i++) {
        const id = game.nextId;
        spawn(game, 60 + i * 50, 200, 0, 0, { dir: 0.3, speed: 400, kind: 0, color: '#fff', special: null }, 380, 620);
        made.push(id);
      }
      run(tut, game, 380, 620, 1, []);
      const left = made.filter(id => game.byId.has(id));
      expect(left).toEqual(made.slice(-STRAY_CAP));
    });
  });

  it('clears a ball stopped in the launcher mouth, so the next throw can leave', () => {
    withTutorial(380, 620, 'aim', (tut, game) => {
      const p = game.players[0];
      const m = launchPointOf(p, 380, 620);
      const R = PhysicsConfig.R;
      // Park a ball right where a throw straight up would appear.
      spawn(game, m.x, m.y - R * 1.2, 0, 0, null, 380, 620);
      for (const b of game.balls) b.group.vx = b.group.vy = 0;
      const events: TutorialEvent[] = [];
      p.aimDeg = 0; p.strength = 0.3;
      noteTouch(tut);
      const threw = run(tut, game, 380, 620, 60 * 4, events, () => { p.aimDeg = 0; p.strength = 0.3; });
      expect(threw).toBe(1);
    });
  });

  const spots: [string, (W: number, H: number) => { x: number; y: number }][] = [
    ['under the banner', (W) => ({ x: W * 0.3, y: BANNER_INSET * 0.6 })],
    ['against the launcher', (W, H) => ({ x: W / 2 + PhysicsConfig.R * 3, y: H - PhysicsConfig.R * 6 })],
  ];
  for (const [where, at] of spots) {
    for (const [W, H] of SCREENS) {
      it(`a group stopped ${where} glides back, whole, at ${W}x${H}`, () => {
        withTutorial(W, H, 'lock', (tut, game) => {
          // One untouched frame first, as on the page, so the ring starts full.
          run(tut, game, W, H, 1, []);
          const g = targetGroupOf(tut, game)!;
          const ids = g.members.map(m => m.id).sort();
          const to = at(W, H);
          shiftGroup(g, to.x - g.com.x, to.y - g.com.y);
          g.vx = g.vy = g.av = 0;
          // The player is dragging all through the glide: nothing may fly.
          const p = game.players[0];
          const threw = run(tut, game, W, H, 60 * 2, [], () => { noteTouch(tut); p.aimDeg = 60; p.strength = 0.3; });
          expect(threw, 'launcher held during the glide').toBe(0);
          const back = targetGroupOf(tut, game)!;
          expect(back.members.map(m => m.id).sort()).toEqual(ids);
          const home = TUTORIAL_LAYOUTS.lock;
          const R = PhysicsConfig.R;
          expect(Math.abs(back.com.x - home.fx * W), 'x').toBeLessThan(R * 1.5);
          expect(Math.abs(back.com.y - home.fy * H), 'y').toBeLessThan(R * 1.5);
        });
      });
    }
  }

  it('leaves a group alone where it can be played', () => {
    withTutorial(380, 620, 'lock', (tut, game) => {
      const g = targetGroupOf(tut, game)!;
      shiftGroup(g, 380 * 0.85 - g.com.x, 620 * 0.3 - g.com.y);
      g.vx = g.vy = g.av = 0;
      const x = g.com.x, y = g.com.y;
      run(tut, game, 380, 620, 60 * 2, []);
      expect(tut.homing).toBe(0);
      expect(targetGroupOf(tut, game)!.com.x).toBeCloseTo(x, 6);
      expect(targetGroupOf(tut, game)!.com.y).toBeCloseTo(y, 6);
    });
  });
});
