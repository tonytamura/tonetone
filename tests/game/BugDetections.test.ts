import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drawFor, setColorsCount, colorOfKind } from '../../src/game/Rules';
import { BLACK_HEX, WHITE_HEX } from '../../src/graphics/Palette';
import { KNOB_IDS } from '../../src/game/Settings';
import { KNOBS } from '../../src/sim/Knobs';
import { PhysicsConfig, recalcThresholds } from '../../src/physics/Config';
import { installSeededRandom, restoreRandom, currentSeed, withSeed } from '../../src/sim/Rng';
import { createStrip } from '../../src/ui/ControlStrips';
import { createRenderContext, resizeRenderer } from '../../src/graphics/Renderer';
import { clearSpriteCache } from '../../src/graphics/Sprites';
import { createGame, resetField, toCollisionState, spawnRainBall } from '../../src/game/GameState';
import { advanceFrame } from '../../src/sim/Frame';
import { launchPointOf, bayInset } from '../../src/physics/LauncherBays';
import { setupTouchControls } from '../../src/ui/TouchControls';
import { LauncherPlayer, Ball, Group } from '../../src/physics/Types';
import { collide, boomGroup, RAIN_BLINK, stepPhysics } from '../../src/physics/CollisionSolver';
import { makeBall, weld, loose, withSandbox } from '../../src/sim/Scenarios';
import { makeGroup } from '../../src/physics/RigidBody';
import { playNote, playSwoosh } from '../../src/audio/Voices';
import * as Voices from '../../src/audio/Voices';
import { PlanJob, plannerStats } from '../../src/game/AIPlanner';
import { runSim } from '../../src/sim/Harness';
import { AI_LEVELS, levelIndex } from '../../src/game/AI';
import { startMatch, throwBall } from '../../src/game/GameState';
import { AudioStore } from '../../src/audio/SynthEngine';
import { startTutorial, endTutorial, tutorialAfterFrame, drainTutorialEvents } from '../../src/game/Tutorial';
import { rebuildGroups } from '../../src/physics/RigidBody';
import { snapshotConfig, restoreConfig } from '../../src/sim/Knobs';

describe('Bug Detection Test Suite', () => {
  describe('Bug 1: drawFor with unlisted player', () => {
    it('prevents TypeError when player is not in playersList', () => {
      const p1: LauncherPlayer = { side: 1, score: 10 } as any;
      const p2: LauncherPlayer = { side: -1, score: 5 } as any;
      const unlistedPlayer: LauncherPlayer = { side: 1, score: 2 } as any;

      expect(() => drawFor(unlistedPlayer, [p1, p2], true)).not.toThrow();
    });
  });

  describe('Bug 2: Special ball color corruption during colors setting update', () => {
    it('preserves special ball color (black/white) when updating color count', () => {
      const game = createGame();
      const blackBall: Ball = {
        id: 1, x: 100, y: 100, kind: -1, special: 'black', color: BLACK_HEX, credit: 0, bonds: new Set(), group: null as any
      };
      const whiteBall: Ball = {
        id: 2, x: 200, y: 200, kind: -1, special: 'white', color: WHITE_HEX, credit: 0, bonds: new Set(), group: null as any
      };
      game.balls.push(blackBall, whiteBall);

      const count = 4;
      setColorsCount(count);
      for (const b of game.balls) {
        if (!b.special) {
          b.kind = b.kind % count;
          b.color = colorOfKind(b.kind);
        }
      }

      expect(blackBall.color).toBe(BLACK_HEX);
      expect(whiteBall.color).toBe(WHITE_HEX);
      expect(blackBall.special).toBe('black');
      expect(whiteBall.special).toBe('white');
    });
  });

  describe('Bug 4: Empty group boom safety', () => {
    it('handles booming an empty group without NaN or TypeError', () => {
      const game = createGame();
      const state = toCollisionState(game);
      const emptyGroup = makeGroup([], 0, 0);

      expect(() => boomGroup(state, emptyGroup, 500, { credit: 0, width: 800 })).not.toThrow();
      expect(state.pops.some(p => Number.isNaN(p.x) || Number.isNaN(p.y))).toBe(false);
    });
  });

  describe('Bug 5: Audio counter bounds recovery', () => {
    it('ensures activeVoices and thuds stay non-negative', () => {
      AudioStore.activeVoices = 0;
      AudioStore.thuds = 0;

      expect(AudioStore.activeVoices).toBe(0);
      expect(AudioStore.thuds).toBe(0);
    });
  });

  describe('Bug 6: NaN relative value in playNote', () => {
    it('handles NaN relative values in playNote gracefully', () => {
      expect(() => playNote(NaN, 0, 'bond')).not.toThrow();
    });
  });

  describe('Bug 7: settings export drifting behind the knob registry', () => {
    it('exports every knob the registry declares', () => {
      // KNOB_IDS was a hand-kept copy of the registry and had fallen two knobs
      // behind it, so "Copy these settings" silently dropped them.
      expect([...KNOB_IDS].sort()).toEqual(Object.values(KNOBS).map(d => d.id).sort());
    });
  });

  describe('Bug 8: boom thresholds left behind by a field resize', () => {
    it('re-derives BOOM_SPEED and KICKOUT_MAX from the stage the renderer just sized', () => {
      // resizeRenderer used to assign PhysicsConfig.SC straight from the stage
      // height while the derived thresholds kept whatever height the tuning
      // panel last happened to pass, so the speed needed to boom drifted with
      // the screen and never updated on rotate.
      const prevWindow = (globalThis as any).window;
      const prevDocument = (globalThis as any).document;
      (globalThis as any).window = { devicePixelRatio: 1 };
      (globalThis as any).document = { getElementById: () => null, createElement: () => makeCanvas() };

      function makeCanvas(): any {
        return {
          width: 0, height: 0,
          getContext: () => ({ setTransform: () => {} }),
        };
      }

      try {
        const rc = createRenderContext(makeCanvas());
        for (const height of [460, 900, 1024]) {
          const stage: any = { getBoundingClientRect: () => ({ width: 380, height }) };
          // Start the thresholds off at a different height, as a stale tuning
          // panel reading would leave them.
          recalcThresholds(620);
          resizeRenderer(rc, stage);

          const sc = Math.max(0.5, Math.min(1.8, height / 620));
          expect(PhysicsConfig.SC).toBeCloseTo(sc, 10);
          expect(PhysicsConfig.BOOM_SPEED).toBeCloseTo(
            (PhysicsConfig.THROW_MIN +
              (PhysicsConfig.THROW_MAX - PhysicsConfig.THROW_MIN) * PhysicsConfig.BOOM_AT) * sc,
            10
          );
          expect(PhysicsConfig.KICKOUT_MAX).toBeCloseTo(
            PhysicsConfig.THROW_MAX * PhysicsConfig.KICKOUT_FRAC * sc,
            10
          );
        }
      } finally {
        (globalThis as any).window = prevWindow;
        (globalThis as any).document = prevDocument;
        recalcThresholds(620);
      }
    });
  });

  describe('Bug 9: seeded randomness lost when installs nest', () => {
    it('returns to the enclosing seeded stream, not the native one', () => {
      const native = Math.random;
      withSeed(1, () => {
        const outer = Math.random;
        expect(currentSeed()).toBe(1);

        // A nested install/restore pair, as runSim does inside its finally.
        installSeededRandom(99);
        expect(currentSeed()).toBe(99);
        restoreRandom();

        expect(Math.random).toBe(outer);
        expect(Math.random).not.toBe(native);
        expect(currentSeed()).toBe(1);
      });
      expect(Math.random).toBe(native);
      expect(currentSeed()).toBeNull();
    });
  });

  describe('Bug 10: next-ball chip not repainted when one special replaces another', () => {
    it('repaints the chip when the slot swaps black for white', () => {
      // Black and white balls both carry kind -1, so a cache key built from
      // kind alone could not tell them apart and the chip kept the old colour.
      const painted: string[] = [];
      const canvas = {
        width: 76,
        height: 76,
        style: {} as Record<string, string>,
        classList: { toggle: () => {} },
        getContext: () => ({
          clearRect: () => {},
          drawImage: (img: any) => painted.push(img.__color),
          fillText: () => {},
          textAlign: '', textBaseline: '', font: '', fillStyle: '',
        }),
      };
      const prevDocument = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: () => canvas,
        // ballSprite() caches per colour; tag each sprite so we can see which
        // colour actually reached the chip.
        createElement: () => ({
          width: 0, height: 0, __color: '',
          getContext: function (this: any) {
            const self = this;
            return {
              beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
              fillRect: () => {}, createRadialGradient: () => ({ addColorStop: () => {} }),
              set fillStyle(v: string) { if (v && v[0] === '#' && !self.__color) self.__color = v; },
              get fillStyle() { return self.__color; },
              globalCompositeOperation: '', strokeStyle: '', lineWidth: 0,
            };
          },
        }),
      };

      try {
        const p: any = { side: 1, nextUp: null, then: null };
        const game: any = { marks: 0 };
        const strip = createStrip(p, { chipNow: 'a', chipNext: 'b' }, () => game);

        p.nextUp = { kind: -1, special: 'black', color: BLACK_HEX };
        p.then = { kind: 1, special: null, color: colorOfKind(1) };
        strip.refresh();
        const afterBlack = painted.length;
        expect(afterBlack).toBeGreaterThan(0);

        // Same kinds in both slots, but the special itself changed.
        p.nextUp = { kind: -1, special: 'white', color: WHITE_HEX };
        strip.refresh();
        expect(painted.length).toBeGreaterThan(afterBlack);
      } finally {
        (globalThis as any).document = prevDocument;
      }
    });
  });

  describe('Bug 12: boom debris took credit off a live ball that rolled into it', () => {
    it('leaves a moving live ball its own credit when it runs into resting debris', () => {
      // Debris re-credited every live ball it touched, whichever one was moving,
      // so a ball the opponent had just thrown was handed to whoever boomed the
      // group the moment it crossed the wreckage. See the Scoring page in Notion.
      recalcThresholds(620);
      const state = toCollisionState(createGame());
      const debris: Ball = {
        id: 1, x: 118, y: 100, kind: 0, special: null, color: colorOfKind(0), credit: 1,
        bonds: new Set(), group: null as any, ghost: true, age: 0,
      };
      const live: Ball = {
        id: 2, x: 100, y: 100, kind: 0, special: null, color: colorOfKind(0), credit: 0,
        shot: { events: 0 }, bonds: new Set(), group: null as any,
      };
      debris.group = makeGroup([debris], 0, 0);
      live.group = makeGroup([live], 400, 0);
      state.balls = [live, debris];
      state.byId.set(1, debris);
      state.byId.set(2, live);
      state.groups = [live.group, debris.group];
      const shot = live.shot;

      collide(state, 1);

      expect(live.credit).toBe(0);
      expect(live.shot).toBe(shot);
    });
  });

  describe('Bug 13: a blocked bay went unrecorded whenever the other bay threw', () => {
    /**
     * `advanceFrame` reported the frame's firing as two booleans, and the
     * harness read them as `threw ? +1 throw : launched ? +1 blocked`. In a duel
     * both bays fire on the same frame, so one player throwing while the other
     * was jammed set `threw`, and the blocked bay was never counted. Every duel
     * measurement of launch blocking therefore read zero.
     */
    it('counts the jammed bay even on a frame where the other one throws', () => {
      const W = 380, H = 620;
      const game = createGame();
      game.twoPlayer = true;
      resetField(game, W, H);

      // Plug player 1's corridor. The balls have to be `exempt` — a freshly
      // thrown ball's grace period — because that is the only state the bay
      // mouth does not eject, and so the only way a bay is ever really blocked.
      // They are spaced just over a diameter apart so the relaxation pass has
      // nothing to push apart, and cover the six radii `launchSpot` probes.
      const R = PhysicsConfig.R;
      const mouth = launchPointOf(game.players[0], W, H);
      let id = 10_000;
      for (let d = 0; d <= R * 6 + 2 * R; d += 2 * R + 0.6) {
        const ball: Ball = {
          id: id++, x: mouth.x, y: mouth.y - d, kind: 0, special: null, color: '#888',
          credit: -1, exempt: 1.6, bonds: new Set(), group: null as any,
        };
        ball.group = makeGroup([ball], 0, 0);
        game.balls.push(ball);
        game.groups.push(ball.group);
      }

      for (const pl of game.players) { pl.reload = 0; pl.aimDeg = 0; pl.strength = 0.5; }
      const res = advanceFrame(game, 1 / 60, W, H, 0);

      // Two bays fired: a count, not a flag. A boolean could not say this.
      expect(res.fired).toBe(2);
      // Player 2's bay was clear, player 1's was not.
      expect(res.threw).toBe(1);
      expect(res.fired - res.threw).toBe(1);
    });

    it('records both bays on a frame where neither is blocked', () => {
      const W = 380, H = 620;
      const game = createGame();
      game.twoPlayer = true;
      resetField(game, W, H);
      for (const pl of game.players) { pl.reload = 0; pl.aimDeg = 0; pl.strength = 0.5; }

      const res = advanceFrame(game, 1 / 60, W, H, 0);
      expect(res.fired).toBe(2);
      expect(res.threw).toBe(2);
    });
  });

  describe('Bug 11: field shrinks to a quarter of the screen after returning to the tab', () => {
    // Chrome can drop a 2D canvas's backing store while the tab is hidden. The
    // restored context keeps its size but loses its DPR transform, and the
    // cached sprite canvases come back blank — so the game drew into the
    // top-left quarter with no balls and no liquid glow.
    it('re-applies the DPR transform when forced at an unchanged size', () => {
      const prevWindow = (globalThis as any).window;
      const prevDocument = (globalThis as any).document;
      (globalThis as any).window = { devicePixelRatio: 2 };
      const transforms: number[][] = [];
      function makeCanvas(): any {
        return {
          width: 0, height: 0,
          getContext: () => ({ setTransform: (...m: number[]) => transforms.push(m) }),
        };
      }
      (globalThis as any).document = { getElementById: () => null, createElement: () => makeCanvas() };

      try {
        const rc = createRenderContext(makeCanvas());
        const stage: any = { getBoundingClientRect: () => ({ width: 400, height: 800 }) };
        resizeRenderer(rc, stage);
        expect(transforms).toEqual([[2, 0, 0, 2, 0, 0]]);

        // Same size: an ordinary resize is a no-op, which is why it never fixed this.
        resizeRenderer(rc, stage);
        expect(transforms.length).toBe(1);

        resizeRenderer(rc, stage, true);
        expect(transforms).toEqual([[2, 0, 0, 2, 0, 0], [2, 0, 0, 2, 0, 0]]);
        expect(rc.cv.width).toBe(800);
        expect(rc.cv.height).toBe(1600);
      } finally {
        (globalThis as any).window = prevWindow;
        (globalThis as any).document = prevDocument;
        recalcThresholds(620);
      }
    });

    it('repaints the next-ball chips once the sprite cache is rebuilt', () => {
      let paints = 0;
      const canvas = {
        width: 76, height: 76, style: {} as Record<string, string>, classList: { toggle: () => {} },
        getContext: () => ({
          clearRect: () => {}, drawImage: () => { paints++; }, fillText: () => {},
          textAlign: '', textBaseline: '', font: '', fillStyle: '',
        }),
      };
      const prevDocument = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: () => canvas,
        createElement: () => ({
          width: 0, height: 0,
          getContext: () => ({
            beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
            fillRect: () => {}, createRadialGradient: () => ({ addColorStop: () => {} }),
            fillStyle: '', globalCompositeOperation: '', strokeStyle: '', lineWidth: 0,
          }),
        }),
      };

      try {
        const p: any = { side: 1, nextUp: { kind: 1, special: null, color: colorOfKind(1) },
                         then: { kind: 2, special: null, color: colorOfKind(2) } };
        const game: any = { marks: 0 };
        const strip = createStrip(p, { chipNow: 'a', chipNext: 'b' }, () => game);

        strip.refresh();
        const first = paints;
        strip.refresh();
        expect(paints).toBe(first); // unchanged balls do not repaint

        clearSpriteCache();
        strip.refresh();
        expect(paints).toBeGreaterThan(first);
      } finally {
        (globalThis as any).document = prevDocument;
      }
    });
  });

  describe('Rain landing', () => {
    // A rain ball passes through everything while it blinks in. One that turned
    // solid inside a rigid group could not be pushed out, because every way out
    // was blocked by another member of the same group: the harness measured
    // overlaps up to 12.6px lasting seconds. It now waits until it is clear.
    function ring(cx: number, cy: number) {
      const members: Ball[] = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        members.push(makeBall(k + 1, cx + 24 * Math.cos(a), cy + 24 * Math.sin(a), 1));
      }
      return members;
    }

    it('stays intangible while its grace ends inside a group, and blinks again', () => {
      const members = ring(500, 500);
      const drop = makeBall(7, 510, 500, 2);
      drop.rainTime = 0.001;
      const groups = [weld(members), loose(drop)];
      withSandbox([...members, drop], groups, {}, sb => {
        sb.step(1 / 240);
        expect(drop.rainTime).toBeCloseTo(RAIN_BLINK, 10);
        expect(drop.x).toBe(510); // not shoved: nothing touches it yet
      });
    });

    it('turns solid as soon as its grace ends in the clear', () => {
      const members = ring(500, 500);
      const drop = makeBall(7, 800, 500, 2);
      drop.rainTime = 0.001;
      const groups = [weld(members), loose(drop)];
      withSandbox([...members, drop], groups, {}, sb => {
        sb.step(1 / 240);
        expect(drop.rainTime).toBeUndefined();
      });
    });
  });

  describe('Aiming from the bottom corners', () => {
    // A drag used to be scaled by the height, which a drag only reaches going
    // forward. Sideways there is half the width to drag in, so on a tall phone a
    // touch at a bottom corner threw at 0.56 strength at best, and at 0.28 in
    // solo, which also scaled by twice the height the other modes did.
    function strengthFromDrag(twoPlayer: boolean, aiOn: boolean, x: number, y: number) {
      const W = 412, H = 915;
      const handlers: Record<string, (e: any) => void> = {};
      const canvas: any = {
        addEventListener: (type: string, fn: (e: any) => void) => { handlers[type] = fn; },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
        setPointerCapture: () => {},
      };
      const game = createGame();
      game.twoPlayer = twoPlayer;
      game.aiOn = aiOn;
      const prevCtx = AudioStore.actx;
      AudioStore.actx = { state: 'running' } as any;
      try {
        setupTouchControls(canvas, () => game, () => {});
        handlers.pointerdown({ pointerId: 1, clientX: x, clientY: y });
      } finally {
        AudioStore.actx = prevCtx;
      }
      return game.players[0].strength;
    }

    it('throws as hard in solo as against the AI for the same drag', () => {
      for (const [x, y] of [[206, 500], [0, 880], [412, 870], [120, 700]]) {
        expect(strengthFromDrag(false, false, x, y)).toBeCloseTo(strengthFromDrag(true, true, x, y), 10);
      }
    });

    it('throws at full strength from either bottom corner, in every mode', () => {
      for (const [twoPlayer, aiOn] of [[false, false], [true, true], [true, false]]) {
        expect(strengthFromDrag(twoPlayer, aiOn, 0, 900)).toBe(1);
        expect(strengthFromDrag(twoPlayer, aiOn, 412, 900)).toBe(1);
      }
    });
  });

  describe('Bug 14: the tutorial lost its group when the first target ball was knocked loose', () => {
    // The step found "its" group through the first target id that survived. A
    // soft mismatched hit that peeled exactly that ball off left the step
    // following a group of one, so it laid the board out again under a player
    // who still had three balls of it on the table.
    it('follows the biggest group the targets are in, not the first target', () => {
      const snap = snapshotConfig();
      try {
        withSeed(1, () => {
          const W = 380, H = 620;
          recalcThresholds(H);
          const game = createGame();
          const tut = startTutorial(game, W, H, 'boom');
          drainTutorialEvents(tut);
          const ids = [...tut.targetIds];
          expect(ids.length).toBe(4);
          const first = game.byId.get(ids[0])!;
          for (const o of first.bonds) game.byId.get(o)!.bonds.delete(first.id);
          first.bonds.clear();
          game.groups = rebuildGroups(game.balls, game.byId);
          tutorialAfterFrame(tut, game, W, H, 1 / 60, 0);
          const events = drainTutorialEvents(tut).map(e => e.type);
          expect(events).not.toContain('respawn');
          expect(tut.targetIds).toEqual(ids);
          endTutorial(tut, game);
        });
      } finally {
        restoreConfig(snap);
      }
    });
  });

  describe('Bug 15: the planning AI played a swoosh for every throw it only imagined', () => {
    // The top AI tries candidate throws on a copy of the table, and launched
    // them with the same throwBall the real frame uses. throwBall plays the
    // swoosh itself, so every imagined throw was heard. playSwoosh drops a
    // swoosh within 80ms of the last, which hid it where the planning finished
    // in a frame or two; on a slower phone the planning spreads over many
    // frames and they came out as a run of swooshes (Tony, 2026-09-29).
    it('plans in silence, while a real throw is still heard', () => {
      const spy = vi.spyOn(Voices, 'playSwoosh');
      try {
        withSeed(4, () => {
          const W = 380, H = 620;
          recalcThresholds(H);
          const game = createGame();
          game.twoPlayer = true;
          resetField(game, W, H);
          startMatch(game, 0);
          const cands = [-30, 0, 30].map(aimDeg => ({ aimDeg, strength: 1 }));
          new PlanJob(game, 1, cands, 1, 0.5, W, H, 42, 3).run();
          expect(spy).not.toHaveBeenCalled();
          game.players[0].reload = 0;
          expect(throwBall(game.players[0], game, W, H)).toBe(true);
          expect(spy).toHaveBeenCalledTimes(1);
        });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('Bug 16: solo play had an invisible wall where the top launcher would be', () => {
    // The bay mouths push balls away, and the solver took every player's mouth
    // from `players`, which always holds two. In solo the top launcher is not
    // drawn, balls may even spawn there (`fits` counts active launchers only),
    // yet balls bounced off its mouth (Tony, 2026-09-29).
    function pushedFromTopMouth(twoPlayer: boolean): number {
      return withSeed(2, () => {
        const W = 380, H = 620;
        recalcThresholds(H);
        const game = createGame();
        game.twoPlayer = twoPlayer;
        resetField(game, W, H);
        game.balls = []; game.byId.clear(); game.groups = [];
        const x = W / 2, y = bayInset() + PhysicsConfig.R * 0.5;
        const ball = makeBall(1, x, y, 0);
        game.balls.push(ball); game.byId.set(1, ball);
        game.groups = [makeGroup([ball], 0, 0)];
        ball.group = game.groups[0];
        stepPhysics(toCollisionState(game), 1 / 120, 1, W, H);
        return Math.hypot(ball.x - x, ball.y - y);
      });
    }

    it('lets a ball sit where the top mouth would be in solo, and pushes it out with two players', () => {
      expect(pushedFromTopMouth(false)).toBe(0);
      expect(pushedFromTopMouth(true)).toBeGreaterThan(1);
    });
  });

  describe('Bug 17: AGI stopped thinking when balls came two seconds apart or faster', () => {
    // The planner started a decision once the ring was 2s from full, and only
    // cleared it when the ring read more than 2s. With a reload of 2s or less
    // (Chaos 1.5s, Rally 2s, or the slider) it never read more, so AGI kept the
    // first decision of the match and aimed every throw at it (Tony, 2026-09-29).
    for (const reload of [3, 2, 1.5, 1]) {
      it(`decides afresh for every throw with a ${reload}s reload`, () => {
        const jobs = plannerStats.jobs;
        const r = runSim({ mode: 'duel', seconds: 12, invariants: false, knobs: { reload }, policies: ['fixed', 'agi'] });
        const decisions = plannerStats.jobs - jobs;
        const throws = Math.round(12 / reload);
        expect(r.throws).toBeGreaterThan(0);
        expect(decisions).toBeGreaterThanOrEqual(throws - 1);
      });
    }
  });

  describe('Bug 18: AI2 went careless for long stretches, and looked like it stopped', () => {
    // Careless-or-not was drawn once per target, not per throw. A group that
    // stayed the biggest kept AI2 careless for up to 16 throws (48s) at a time,
    // 60% of throws in all against the 50% it was then meant to be, and a careless
    // throw could be as weak as 0, dribbling out of the bay (Tony, 2026-09-29).
    it('decides careless or not for every throw, and never throws feebly', () => {
      let throws = 0, careless = 0, feeble = 0, run = 0, longest = 0;
      for (const seed of [1, 2, 3]) {
        let lastLoaded: unknown = null;
        runSim({
          mode: 'ai', aiLevel: levelIndex('ai2'), seconds: 120, invariants: false, knobs: { match: 120 }, seed,
          onFrame: g => {
            const p: any = g.players[1];
            if (p.loaded === lastLoaded) return;
            if (lastLoaded) {
              throws++;
              if (p.strength < 0.2) feeble++;
              if (p._ai?.wildDeg !== undefined) { careless++; longest = Math.max(longest, ++run); } else run = 0;
            }
            lastLoaded = p.loaded;
          },
        });
      }
      // Around AI2's own share, and never in the long runs a per-target draw made.
      const share = AI_LEVELS[levelIndex('ai2')].wild!;
      expect(feeble).toBe(0);
      expect(Math.abs(careless / throws - share)).toBeLessThan(0.15);
      expect(longest).toBeLessThanOrEqual(10);
    });
  });

  describe('Bug 19: AI3 threw one way only while the table held no group', () => {
    // AI3 aims at the biggest group of two or more. With only single balls on
    // the table — every match's opening, and after a big boom — it found no
    // target, fell to one fixed idle angle, and threw the same way at the same
    // strength until a group formed: "AI3 stops playing and leaves it in one
    // direction" (Tony, 2026-09-30). It now aims at a single of the loaded
    // colour, or the nearest single.
    it('always has a ball to aim at while there is one on the table', () => {
      let throws = 0, idle = 0;
      for (const seed of [1, 2, 3, 4]) {
        let lastLoaded: unknown = null;
        runSim({
          mode: 'ai', aiLevel: levelIndex('ai3'), seconds: 120, invariants: false, knobs: { match: 120 }, seed,
          onFrame: g => {
            const p: any = g.players[1];
            if (p.loaded === lastLoaded) return;
            if (lastLoaded) {
              throws++;
              if (p._ai?.key === -1 && g.balls.some(b => !b.ghost)) idle++;
            }
            lastLoaded = p.loaded;
          },
        });
      }
      expect(throws).toBeGreaterThan(100);
      expect(idle).toBe(0);
    });
  });

  describe('Bug 20: AI3 kept the last careless angle of an AI2 match, and threw one way for good', () => {
    // The AI's working state lives on the launcher, and the launcher outlives
    // the match. AI2 stores a careless throw's angle and strength there; AI3,
    // which never throws carelessly, never cleared them, so after a ladder match
    // against AI2 a match against AI3 threw every ball at that one angle and
    // strength: "AI3 stops playing and leaves it in one direction". Tony found
    // the steps on 2026-10-08: play the ladder once, leave, force AI3.
    it('starts every match with a fresh mind, whatever played the seat before', () => {
      const W = 390, H = 780;
      withSeed(7, () => {
        const game = createGame();
        game.twoPlayer = true; game.aiOn = true; game.matchLen = 0;
        game.aiLevel = levelIndex('ai2');
        resetField(game, W, H);
        startMatch(game, 0);
        const p: any = game.players[1];
        let clock = 0;
        for (let f = 0; f < 60 * 120 && p._ai?.wildDeg === undefined; f++) clock = advanceFrame(game, 1 / 60, W, H, clock).clock;
        expect(p._ai?.wildDeg).toBeDefined(); // a careless throw is in hand when the player leaves

        game.aiLevel = levelIndex('ai3');
        resetField(game, W, H);
        startMatch(game, 0);
        const aims = new Set<number>();
        let lastLoaded: unknown = p.loaded;
        for (let f = 0; f < 60 * 60; f++) {
          clock = advanceFrame(game, 1 / 60, W, H, clock).clock;
          if (p.loaded !== lastLoaded) { aims.add(Math.round(p.aimDeg)); lastLoaded = p.loaded; }
        }
        expect(p._ai?.wildDeg).toBeUndefined();
        expect(aims.size).toBeGreaterThan(3); // it follows the table, not one angle
      });
    });

    it('ignores a careless angle another level left, when the level changes mid-match', () => {
      const W = 390, H = 780;
      withSeed(7, () => {
        const game = createGame();
        game.twoPlayer = true; game.aiOn = true; game.matchLen = 0;
        game.aiLevel = levelIndex('ai2');
        resetField(game, W, H);
        startMatch(game, 0);
        const p: any = game.players[1];
        let clock = 0;
        for (let f = 0; f < 60 * 120 && p._ai?.wildDeg === undefined; f++) clock = advanceFrame(game, 1 / 60, W, H, clock).clock;
        game.aiLevel = levelIndex('ai3'); // the AI knob, turned with no new match
        const aims = new Set<number>();
        let lastLoaded: unknown = p.loaded;
        for (let f = 0; f < 60 * 60; f++) {
          clock = advanceFrame(game, 1 / 60, W, H, clock).clock;
          if (p.loaded !== lastLoaded) { aims.add(Math.round(p.aimDeg)); lastLoaded = p.loaded; }
        }
        expect(aims.size).toBeGreaterThan(3);
      });
    });
  });

  describe('Bug 21: a match inherited what the previous one left on the Game', () => {
    // The browser plays every match on one Game; the harness made a fresh one per
    // run and could not see this. resetField drew the opening deck before zeroing
    // the scores, so last match's winner opened with a black on 39.5% of cards
    // (the rule says none at 0), and the auto rain's on/off state survived.
    const W = 412, H = 915;
    const snapshot = (g: any) => JSON.stringify({
      players: g.players.map((p: any) => ({ ...p, loaded: p.loaded && [p.loaded.kind, p.loaded.special],
        nextUp: p.nextUp && [p.nextUp.kind, p.nextUp.special], then: p.then && [p.then.kind, p.then.special] })),
      raining: g.raining, balls: g.balls.length,
    });

    it('starts a reused Game exactly where a fresh one starts', () => {
      const fresh = withSeed(11, () => {
        const g = createGame(); g.twoPlayer = true; g.aiOn = true;
        resetField(g, W, H); return snapshot(g);
      });
      const reused = createGame(); reused.twoPlayer = true; reused.aiOn = true;
      withSeed(3, () => {
        resetField(reused, W, H); startMatch(reused, 0);
        let clock = 0;
        for (let f = 0; f < 60 * 30; f++) clock = advanceFrame(reused, 1 / 60, W, H, clock).clock;
      });
      // The leftovers the old resetField kept: a winner's score, rain on, AI state.
      reused.players[0].score = 300; reused.players[1].score = 200;
      reused.raining = true;
      (reused.players[1] as any)._ai = { key: 5, wildDeg: -5 };
      (reused.players[1] as any)._targetGroup = reused.groups[0];
      reused.players[1].aimDeg = 33;
      withSeed(11, () => resetField(reused, W, H));
      expect(snapshot(reused)).toBe(fresh);
    });

    it('never deals an opening black or white, whatever the last score was', () => {
      const game = createGame(); game.twoPlayer = true;
      let specials = 0;
      withSeed(5, () => {
        for (let i = 0; i < 400; i++) {
          game.players[0].score = 300; game.players[1].score = 200;
          resetField(game);
          for (const p of game.players) for (const c of [p.loaded, p.nextUp, p.then]) if (c?.special) specials++;
          game.players[0].score = 200; game.players[1].score = 300;
          resetField(game);
          for (const p of game.players) for (const c of [p.loaded, p.nextUp, p.then]) if (c?.special) specials++;
        }
      });
      expect(specials).toBe(0);
    });
  });

  describe('Bug 22: the spin knob compounded on every regroup', () => {
    // rebuildGroups applied SPIN to a regrouped body's angular momentum, which
    // collisions had already scaled: at spin 0.5 a spinning group halved its
    // spin on every spawn, lock or boom anywhere on the table.
    it('keeps a group spinning through regroups that change nothing', () => {
      const saved = snapshotConfig();
      try {
        PhysicsConfig.SPIN = 0.5;
        const a = makeBall(1, 100, 100), b = makeBall(2, 124, 100);
        a.bonds.add(2); b.bonds.add(1);
        const byId = new Map([[1, a], [2, b]]);
        let gs = rebuildGroups([a, b], byId);
        gs[0].av = 4;
        for (let i = 0; i < 4; i++) gs = rebuildGroups([a, b], byId);
        expect(gs[0].av).toBeCloseTo(4, 6);
      } finally { restoreConfig(saved); }
    });
  });

  describe('Bug 23: every failed rain spot drew a phantom blocked ring', () => {
    // A rain ball tries up to 30 random spots a tick, and each miss pushed a
    // 'blocked' flash, drawn as a ripple ring around whatever ball was in the
    // way, about 3.4 times a minute in a duel.
    it('rains silently when a spot is taken; only an aimed throw flashes', () => {
      const game = createGame();
      resetField(game, 200, 200);
      // Fill the board so that every random spot is taken.
      for (let x = 12; x < 200; x += 24) for (let y = 12; y < 200; y += 24) game.balls.push(makeBall(game.nextId++, x, y));
      game.flashes = [];
      withSeed(1, () => { for (let i = 0; i < 5; i++) spawnRainBall(game, 200, 200); });
      expect(game.flashes.filter(f => f.kind === 'blocked')).toHaveLength(0);
    });
  });

  describe('Guard: an AI aim that is not a number would stand the launcher still for good', () => {
    // Tony saw AI3 stop on 2026-09-30 and 432 harness runs never did. A NaN aim
    // is the one way it could stop for the rest of a match: easing from NaN stays
    // NaN, and a throw in a NaN direction finds no clear spot. It is reset now.
    it('recovers its aim, and never puts a ball where it cannot be', () => {
      let aimAtEnd = NaN, badBalls = 0;
      runSim({
        mode: 'ai', aiLevel: levelIndex('ai3'), seconds: 20, invariants: false, knobs: { match: 20 },
        onFrame: (g, f) => {
          const p: any = g.players[1];
          if (f === 300) { p.aimDeg = NaN; p.strength = NaN; }
          if (f > 300) badBalls += g.balls.filter(b => !Number.isFinite(b.x) || !Number.isFinite(b.y)).length;
          aimAtEnd = p.aimDeg;
        },
      });
      expect(Number.isFinite(aimAtEnd)).toBe(true);
      expect(badBalls).toBe(0);
    });
  });
});
