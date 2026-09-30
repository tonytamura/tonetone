import { describe, it, expect, beforeEach } from 'vitest';
import {
  mouthRadius,
  bayInset,
  launchPointOf,
  aimDirOf,
  aimMaxReach,
  aimReachOf,
  FINGER_CLEARANCE,
  aimAt,
  throwSpeedOf,
  boomHeatOf,
  launchSpeedOf,
  mouthNormalAt,
  clearExempt,
} from '../../src/physics/LauncherBays';
import { PhysicsConfig, recalcThresholds } from '../../src/physics/Config';
import { Ball, LauncherPlayer } from '../../src/physics/Types';
import { makeLauncher } from '../../src/game/GameState';

describe('LauncherBays module', () => {
  beforeEach(() => {
    recalcThresholds(620);
  });

  it('computes mouth radius and bay inset', () => {
    expect(mouthRadius()).toBe(PhysicsConfig.R * 2);
    expect(bayInset()).toBe(PhysicsConfig.R * 3 + 2);
  });

  describe('launchPointOf', () => {
    it('calculates launch point for bottom launcher (side > 0)', () => {
      const p = makeLauncher(1);
      const point = launchPointOf(p, 800, 600);
      expect(point.x).toBe(400);
      expect(point.y).toBe(600 - bayInset());
    });

    it('calculates launch point for top launcher (side < 0)', () => {
      const p = makeLauncher(-1);
      const point = launchPointOf(p, 800, 600);
      expect(point.x).toBe(400);
      expect(point.y).toBe(bayInset());
    });
  });

  describe('aimDirOf', () => {
    it('converts aim angle in degrees to radians for side > 0', () => {
      const p = makeLauncher(1);
      p.aimDeg = 0;
      expect(aimDirOf(p)).toBeCloseTo(-Math.PI / 2);

      p.aimDeg = 45;
      expect(aimDirOf(p)).toBeCloseTo(-Math.PI / 2 + (45 * Math.PI) / 180);
    });

    it('converts aim angle in degrees to radians for side < 0', () => {
      const p = makeLauncher(-1);
      p.aimDeg = 0;
      expect(aimDirOf(p)).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('aimMaxReach & aimReachOf', () => {
    it('calculates aimMaxReach to stay within the player playing area boundary', () => {
      // Wide enough that the height is the tighter of the two bounds.
      expect(aimMaxReach(2000, 600, true)).toBe(600 / 2 - bayInset()); // 300 - 38 = 262
      expect(aimMaxReach(2000, 600, false)).toBe(600 - bayInset()); // 600 - 38 = 562
    });

    it('caps aimMaxReach at half the width so the arrow stays on a portrait screen', () => {
      // A phone in portrait: the bay sits on the centre line and sweeps 180°, so
      // half the width, not the height, is what the arrow has to fit inside.
      expect(aimMaxReach(400, 900, false)).toBe(200); // 200 < 900 - 38
      expect(aimMaxReach(400, 900, true)).toBe(200); // 200 < 450 - 38
    });

    it('puts the arrow tip a fingertip past the finger, at every strength', () => {
      // The finger sits at strength x the round limit (aimAt). Continuous fire
      // keeps it on the screen, and the arrow used to end under it from two
      // thirds of the range up (Tony, 2026-09-30).
      // Screens where straight up the field leaves room past a full-power finger.
      for (const [W, H] of [[390, 780], [1200, 900]]) {
        const p = makeLauncher(1);
        const maxReach = aimMaxReach(W, H, false);
        for (const s of [0.1, 0.4, 0.67, 0.9, 1]) {
          p.strength = s;
          p.aimDeg = 0; // straight up the field, where there is room
          expect(aimReachOf(p, W, H, false)).toBeCloseTo(Math.min(s * maxReach + FINGER_CLEARANCE, H - bayInset()), 6);
          expect(aimReachOf(p, W, H, false)).toBeGreaterThan(s * maxReach);
        }
      }
    });

    it('grows with power over the whole range, not only the first two thirds', () => {
      const p = makeLauncher(1);
      p.strength = 0.67; const at67 = aimReachOf(p, 390, 780, false);
      p.strength = 1; const at100 = aimReachOf(p, 390, 780, false);
      expect(at100).toBeGreaterThan(at67);
    });

    it('caps reach in 2-player mode so arrow head does not cross the playing area boundary', () => {
      const p = makeLauncher(1);
      p.strength = 1.0;
      const reach = aimReachOf(p, 2000, 600, true);
      const expectedMaxReach = aimMaxReach(2000, 600, true); // 300 - 38 = 262
      expect(reach).toBe(expectedMaxReach);
      // Uncapped reach would be 1.0 * (600 * 0.40) * 1.75 = 420, which exceeds expectedMaxReach (262)
      expect(1.0 * (600 * 0.40) * 1.75).toBeGreaterThan(expectedMaxReach);
    });

    it('caps reach in 1-player mode so arrow head does not cross the top table boundary', () => {
      const p = makeLauncher(1);
      p.strength = 1.0;
      const reach = aimReachOf(p, 2000, 600, false);
      const expectedMaxReach = aimMaxReach(2000, 600, false); // 600 - 38 = 562
      expect(reach).toBe(expectedMaxReach);
    });

    it('keeps the arrow tip on screen at every aim angle a player can reach', () => {
      const W = 400, H = 900; // portrait, where the old height-only bound overshot
      for (const twoPlayer of [false, true]) {
        for (const side of [1, -1]) {
          const p = makeLauncher(side);
          p.strength = 1.0;
          const m = launchPointOf(p, W, H);
          for (let deg = -90; deg <= 90; deg += 5) {
            p.aimDeg = deg;
            // The reach depends on the angle now: it is kept on the field along the aim.
            const reach = aimReachOf(p, W, H, twoPlayer);
            const dir = aimDirOf(p);
            const tx = m.x + Math.cos(dir) * reach;
            const ty = m.y + Math.sin(dir) * reach;
            expect(tx).toBeGreaterThanOrEqual(0);
            expect(tx).toBeLessThanOrEqual(W);
            expect(ty).toBeGreaterThanOrEqual(0);
            expect(ty).toBeLessThanOrEqual(H);
          }
        }
      }
    });
  });

  describe('aimAt', () => {
    it('sets aimDeg and strength toward target coordinate', () => {
      const p = makeLauncher(1); // side > 0, bottom launcher at (400, 500)
      const width = 800, height = 538; // bay inset is 38, so launchPoint = (400, 500)
      aimAt(p, 400, 300, width, height, false);

      // Aiming straight up -> dx = 0, dy = -200 -> raw = atan2(0, 200) = 0
      expect(p.aimDeg).toBe(0);
      expect(p.strength).toBeGreaterThan(0);
    });

    it('reaches full strength at the edge of the round envelope, in every direction', () => {
      // A drag is scaled by the same bound the arrow is drawn to, so full power
      // sits at the edge of the player's area whichever way they drag.
      for (const [W, H] of [[412, 915], [1024, 768]]) {
        for (const twoPlayer of [false, true]) {
          const reach = aimMaxReach(W, H, twoPlayer);
          const p = makeLauncher(1);
          const m = launchPointOf(p, W, H);
          for (let deg = -90; deg <= 90; deg += 15) {
            const a = (deg * Math.PI) / 180;
            aimAt(p, m.x + Math.sin(a) * reach, m.y - Math.cos(a) * reach, W, H, twoPlayer);
            expect(p.strength).toBeCloseTo(1, 10);
            aimAt(p, m.x + Math.sin(a) * reach / 2, m.y - Math.cos(a) * reach / 2, W, H, twoPlayer);
            expect(p.strength).toBeCloseTo(0.5, 10);
          }
        }
      }
    });

    it('clamps aimDeg between -90 and +90', () => {
      const p = makeLauncher(1);
      aimAt(p, 10000, 500, 800, 600, false);
      expect(p.aimDeg).toBeLessThanOrEqual(90);

      aimAt(p, -10000, 500, 800, 600, false);
      expect(p.aimDeg).toBeGreaterThanOrEqual(-90);
    });
  });

  describe('throwSpeedOf', () => {
    it('calculates throw speed scaling with power curve and power multiplier', () => {
      const p = makeLauncher(1);
      p.strength = 1.0;
      const maxSpeed = throwSpeedOf(p, false);
      expect(maxSpeed).toBeCloseTo(PhysicsConfig.THROW_MAX * PhysicsConfig.DUEL_POWER);

      p.strength = 0.0;
      const minSpeed = throwSpeedOf(p, false);
      expect(minSpeed).toBeCloseTo(PhysicsConfig.THROW_MIN * PhysicsConfig.DUEL_POWER);
    });

    it('consistently applies power multiplier across 1P and 2P modes to enable booming', () => {
      const p = makeLauncher(1);
      p.strength = 1.0;
      const speed1P = throwSpeedOf(p, false);
      const speed2P = throwSpeedOf(p, true);
      expect(speed1P).toBe(speed2P);
      expect(speed1P).toBe(PhysicsConfig.THROW_MAX * PhysicsConfig.DUEL_POWER);
    });

    it('ensures single player shots at the boom threshold exceed boom speed', () => {
      const p = makeLauncher(1);
      p.strength = PhysicsConfig.BOOM_AT;
      const speedAtThreshold = throwSpeedOf(p, false);
      expect(speedAtThreshold).toBeGreaterThanOrEqual(PhysicsConfig.BOOM_SPEED);
    });
  });

  describe('boomHeatOf', () => {
    it('stays 0 for every throw that will not boom, and reaches 1 at full power', () => {
      const p = makeLauncher(1);

      p.strength = 0;
      expect((launchSpeedOf(p, false) >= PhysicsConfig.BOOM_SPEED)).toBe(false);
      expect(boomHeatOf(p, false)).toBe(0);

      // Full power is the hardest throw the bay can make, so it is the top of
      // the ramp by definition.
      p.strength = 1;
      expect((launchSpeedOf(p, false) >= PhysicsConfig.BOOM_SPEED)).toBe(true);
      expect(boomHeatOf(p, false)).toBe(1);
    });

    it('is 0 right up to the threshold and climbs from there, not before it', () => {
      // This is the whole shape of the cue, and it was the other way round for
      // a few hours on 2026-09-19: white while the throw is safe, red climbing
      // across every throw that booms.
      const p = makeLauncher(1);
      let lastHeat = -1;
      let sawClimb = false;
      for (let s = 0; s <= 1.0001; s += 0.01) {
        p.strength = Math.min(1, s);
        const heat = boomHeatOf(p, false);
        if (!(launchSpeedOf(p, false) >= PhysicsConfig.BOOM_SPEED)) {
          expect(heat).toBe(0);
        } else {
          expect(heat).toBeGreaterThanOrEqual(lastHeat);
          if (heat > lastHeat) sawClimb = true;
        }
        lastHeat = heat;
      }
      // It must actually be a ramp over the booming range, not a step.
      expect(sawClimb).toBe(true);
      expect(lastHeat).toBe(1);
    });

    it('spends the ramp on the throws a player is choosing between', () => {
      // Half the drag or more booms at the defaults, and that is the half the
      // colour has to report: the heat at the midpoint of the booming range
      // should be neither 0 nor 1.
      const p = makeLauncher(1);
      p.strength = 0.65;
      expect((launchSpeedOf(p, false) >= PhysicsConfig.BOOM_SPEED)).toBe(true);
      const mid = boomHeatOf(p, false);
      expect(mid).toBeGreaterThan(0.05);
      expect(mid).toBeLessThan(0.95);
    });

    it('measures the launched speed, KICK included, not the aim speed', () => {
      const p = makeLauncher(1);
      p.strength = 0.5;
      expect(launchSpeedOf(p, false)).toBeCloseTo(throwSpeedOf(p, false) * PhysicsConfig.KICK);

      // The old pink cue compared the aim speed against BOOM_SPEED, so at the
      // default 1.2x kick it called a booming throw safe.
      const before = PhysicsConfig.KICK;
      try {
        PhysicsConfig.KICK = 1.2;
        for (let s = 0; s <= 1; s += 0.01) {
          p.strength = s;
          expect((launchSpeedOf(p, false) >= PhysicsConfig.BOOM_SPEED)).toBe(
            throwSpeedOf(p, false) * PhysicsConfig.KICK >= PhysicsConfig.BOOM_SPEED
          );
        }
      } finally {
        PhysicsConfig.KICK = before;
      }
    });

    it('is the same in solo and in a duel, as the speed behind it is', () => {
      const p = makeLauncher(1);
      p.strength = 0.65;
      expect(boomHeatOf(p, false)).toBe(boomHeatOf(p, true));
    });

    it('stays 0 when the knobs put the threshold out of the bay\'s reach', () => {
      // `boom` 1.0 with `maxpower` 600 and `kick` 0.2 is a reachable set, and it
      // means nothing can boom at all. A white arrow throughout is the truth
      // about that combination, not a clamp artefact.
      const before = { at: PhysicsConfig.BOOM_AT, max: PhysicsConfig.THROW_MAX, kick: PhysicsConfig.KICK };
      try {
        PhysicsConfig.BOOM_AT = 1;
        PhysicsConfig.THROW_MAX = 600;
        PhysicsConfig.KICK = 0.2;
        recalcThresholds(620);
        const p = makeLauncher(1);
        p.strength = 1;
        expect((launchSpeedOf(p, false) >= PhysicsConfig.BOOM_SPEED)).toBe(false);
        expect(boomHeatOf(p, false)).toBe(0);
      } finally {
        PhysicsConfig.BOOM_AT = before.at;
        PhysicsConfig.THROW_MAX = before.max;
        PhysicsConfig.KICK = before.kick;
        recalcThresholds(620);
      }
    });
  });

  describe('mouthNormalAt', () => {
    it('detects penetration depth when ball is inside launcher mouth', () => {
      const m = { x: 400, y: 500 };
      const ball: Ball = { x: 400, y: 510 } as any; // distance = 10, mouth radius + R = 24 + 12 = 36
      const col = mouthNormalAt(ball, m, 600);
      expect(col).not.toBeNull();
      expect(col!.pen).toBe(36 - 10);
      expect(col!.nx).toBe(0);
      expect(col!.ny).toBe(1);
    });

    it('returns null when ball is outside mouth radius', () => {
      const m = { x: 400, y: 500 };
      const ball: Ball = { x: 400, y: 300 } as any; // distance = 200 > 36
      const col = mouthNormalAt(ball, m, 600);
      expect(col).toBeNull();
    });
  });

  describe('clearExempt', () => {
    it('decrements exempt timer and clears immunity when ball leaves launcher bay', () => {
      const p = makeLauncher(1);
      const players = [p];
      const ball: Ball = { x: 400, y: 100, exempt: 1.6 } as any; // far from bay
      const balls = [ball];

      clearExempt(balls, players, 0.1, 800, 600);
      expect(ball.exempt).toBe(0);
    });

    it('retains exempt status while inside bay if exempt timer > 0', () => {
      const p = makeLauncher(1); // bottom launcher at y = 562
      const lp = launchPointOf(p, 800, 600);
      const players = [p];
      const ball: Ball = { x: lp.x, y: lp.y, exempt: 1.6 } as any;
      const balls = [ball];

      clearExempt(balls, players, 0.1, 800, 600);
      expect(ball.exempt).toBeCloseTo(1.5);
    });
  });
});
