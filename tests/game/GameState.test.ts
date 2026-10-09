import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeLauncher,
  createGame,
  resetField,
  fits,
  spawn,
  spawnRainBall,
  spawnBallGroup,
  getRainBallAlpha,
  isLowBallDensity,
  launchSpot,
  throwBall,
  toCollisionState,
  syncFromCollisionState,
} from '../../src/game/GameState';
import { PhysicsConfig, recalcThresholds } from '../../src/physics/Config';
import { stepPhysics } from '../../src/physics/CollisionSolver';

describe('GameState module', () => {
  beforeEach(() => {
    recalcThresholds(620);
  });

  describe('makeLauncher & createGame', () => {
    it('creates launcher with default attributes', () => {
      const launcher = makeLauncher(1);
      expect(launcher.side).toBe(1);
      expect(launcher.score).toBe(0);
      expect(launcher.loaded).toBeNull();
      expect(launcher.reload).toBe(0);
    });

    it('creates initial game state with 2 players', () => {
      const game = createGame();
      expect(game.players.length).toBe(2);
      expect(game.balls).toEqual([]);
      expect(game.groups).toEqual([]);
      expect(game.matchLen).toBe(120); // the `match` knob default; see the drift guard in Knobs.test.ts
      expect(game.matchRunning).toBe(false);
      expect(game.paused).toBe(false);
      expect(game.rainInterval).toBe(0);
      expect(game.rainTimer).toBe(0);
    });
  });

  describe('resetField & spawnBallGroup', () => {
    it('resets game field entities and populates launcher decks when dimensions not provided', () => {
      const game = createGame();
      game.rainTimer = 5;
      resetField(game);

      expect(game.balls.length).toBe(0);
      expect(game.groups.length).toBe(0);
      expect(game.rainTimer).toBe(0);
      for (const p of game.players) {
        expect(p.loaded).not.toBeNull();
        expect(p.nextUp).not.toBeNull();
        expect(p.then).not.toBeNull();
        expect(p.score).toBe(0);
      }
    });

    it('spawns a 9-row losange (diamond) pattern centered in the field where balls do not touch initially', () => {
      const game = createGame();
      resetField(game, 800, 600);

      // 1 + 2 + 3 + 4 + 5 + 4 + 3 + 2 + 1 = 25 balls
      expect(game.balls.length).toBe(25);

      // Verify no two balls touch (distance strictly > 2 * R)
      const R = PhysicsConfig.R;
      const minTouchDistance = 2 * R;

      for (let i = 0; i < game.balls.length; i++) {
        for (let j = i + 1; j < game.balls.length; j++) {
          const b1 = game.balls[i];
          const b2 = game.balls[j];
          const dist = Math.hypot(b1.x - b2.x, b1.y - b2.y);
          expect(dist).toBeGreaterThan(minTouchDistance);
        }
      }
    });
  });

  describe('fits & spawn', () => {
    it('validates ball placement within boundaries and clear of obstructions', () => {
      const game = createGame();
      resetField(game);

      // Outside bounds
      expect(fits(-10, 100, false, game, 800, 600)).toBe(false);
      // Valid center position
      expect(fits(400, 300, false, game, 800, 600)).toBe(true);
    });

    it('spawns ball in court if location fits', () => {
      const game = createGame();
      resetField(game);

      const success = spawn(game, 400, 300, 100, 200, null, 800, 600);
      expect(success).toBe(true);
      expect(game.balls.length).toBe(1);
      expect(game.byId.has(game.balls[0].id)).toBe(true);
      expect(game.groups.length).toBe(1);
    });

    it('rejects spawn if MAX_BALLS capacity reached', () => {
      const game = createGame();
      resetField(game);
      PhysicsConfig.MAX_BALLS = 0;

      const success = spawn(game, 400, 300, 100, 200, null, 800, 600);
      expect(success).toBe(false);
      PhysicsConfig.MAX_BALLS = 900;
    });
  });

  describe('spawnRainBall & rain untouchable behavior', () => {
    it('spawns rain ball with rainTime = 1.0', () => {
      const game = createGame();
      resetField(game);

      const success = spawnRainBall(game, 800, 600);
      expect(success).toBe(true);
      expect(game.balls.length).toBe(1);
      expect(game.balls[0].rainTime).toBe(1.0);
    });

    it('calculates rain ball alpha correctly (max 0.9, min 0.0, 1.0 when expired)', () => {
      expect(getRainBallAlpha(undefined)).toBe(1.0);
      expect(getRainBallAlpha(0)).toBe(1.0);
      expect(getRainBallAlpha(-1)).toBe(1.0);
      expect(getRainBallAlpha(1.0)).toBe(0.0); // at start (elapsed 0), cycle 0 => alpha 0
    });

    it('detects low ball density correctly', () => {
      const game = createGame();
      resetField(game);

      // Empty court -> low density
      expect(isLowBallDensity(game, 800, 600)).toBe(true);

      // Fill court with balls >= threshold (threshold for 800x600 is ~27-34)
      for (let i = 0; i < 35; i++) {
        spawn(game, 50 + (i % 6) * 30, 50 + Math.floor(i / 6) * 30, 0, 0, null, 800, 600);
      }
      expect(isLowBallDensity(game, 800, 600)).toBe(false);
    });

    it('decrements rainTime during stepPhysics and removes it at 0', () => {
      const game = createGame();
      resetField(game);
      spawnRainBall(game, 800, 600);

      const colState = toCollisionState(game);
      stepPhysics(colState, 0.5, 0, 800, 600);
      expect(colState.balls[0].rainTime).toBeCloseTo(0.5, 3);

      stepPhysics(colState, 0.6, 0.5, 800, 600);
      expect(colState.balls[0].rainTime).toBeUndefined();
    });

    it('prevents collision when a ball has rainTime > 0', () => {
      const game = createGame();
      resetField(game);

      // Spawn ball 1 (regular) and ball 2 (rain ball overlapping)
      spawn(game, 400, 300, 0, 0, null, 800, 600);
      spawnRainBall(game, 800, 600);
      game.balls[1].x = 400;
      game.balls[1].y = 300; // Overlapping completely

      const colState = toCollisionState(game);
      const initialBondsCount = game.balls[0].bonds.size;
      stepPhysics(colState, 0.1, 0, 800, 600);

      // No bonding should have occurred because rain ball is untouchable
      expect(colState.balls[0].bonds.size).toBe(initialBondsCount);
    });
  });

  describe('throwBall', () => {
    it('launches ball, advances launcher queue, and sets reload timer', () => {
      const game = createGame();
      resetField(game);
      const p = game.players[0];
      const initialLoaded = p.loaded;
      const initialNextUp = p.nextUp;

      const success = throwBall(p, game, 800, 600);
      expect(success).toBe(true);
      expect(p.reload).toBe(game.reloadTime);
      expect(p.loaded).toEqual(initialNextUp);
      expect(game.balls.length).toBe(1);
      expect(game.matchRunning).toBe(true);
    });

    it('prevents throwing when launcher is re-loading', () => {
      const game = createGame();
      resetField(game);
      const p = game.players[0];
      p.reload = 1.0;

      const success = throwBall(p, game, 800, 600);
      expect(success).toBe(false);
    });

    it('booms target ball groups when thrown with sufficient strength in single player mode', () => {
      const game = createGame();
      game.twoPlayer = false;
      resetField(game);

      // Create a bonded pair of green (kind = 1) balls at (400, 300)
      const b1 = { id: game.nextId++, x: 400, y: 300, kind: 1, color: '#3CB44B', credit: -1, bonds: new Set([2]), group: null as any };
      const b2 = { id: game.nextId++, x: 424, y: 300, kind: 1, color: '#3CB44B', credit: -1, bonds: new Set([1]), group: null as any };
      game.balls.push(b1 as any, b2 as any);
      game.byId.set(b1.id, b1 as any);
      game.byId.set(b2.id, b2 as any);

      // Load player 0 with a red (kind = 0) ball
      const p = game.players[0];
      p.loaded = { kind: 0, color: '#E6194B', special: null };
      p.strength = 0.8; // High strength above boom threshold
      p.aimDeg = 0; // Aiming straight up toward (400, 300)

      const success = throwBall(p, game, 800, 600);
      expect(success).toBe(true);

      // Run physics simulation until collision occurs
      const colState = toCollisionState(game);
      for (let t = 0; t < 20; t++) {
        stepPhysics(colState, 0.016, t * 0.016, 800, 600);
      }
      syncFromCollisionState(game, colState);

      // Verify player 0 successfully boom the target group
      expect(p.booms).toBe(1);
      expect(game.killGroups).toBe(1);
    });
  });

  describe('toCollisionState & syncFromCollisionState', () => {
    it('synchronizes state to and from collision state adapter', () => {
      const game = createGame();
      resetField(game);
      spawn(game, 400, 300, 100, 200, null, 800, 600);

      const colState = toCollisionState(game);
      expect(colState.balls.length).toBe(1);
      expect(colState.groups.length).toBe(1);

      colState.killBalls = 5;
      syncFromCollisionState(game, colState);
      expect(game.killBalls).toBe(5);
    });
  });
});
